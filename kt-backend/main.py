"""
KISAN-TOMODACHI backend

- Reads Arduino sensor values over serial (auto-reconnects)
- Fetches current weather + forecast from Open-Meteo (free, no API key)
- Writes everything to a JSON file (atomically) for the frontend
- Serves the same data over HTTP and lets the LLM (koboldcpp) answer
  farmer questions using sensors + weather
- Pre-computes soil status and rain outlook so the small LLM doesn't
  have to interpret raw numbers

Install:  pip install fastapi uvicorn httpx pyserial pydantic
Run:      python main.py
"""

import copy
import json
import math
import os
import re
import threading
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

import httpx
import serial
from serial.tools import list_ports
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field


# ============================================================
# CONFIGURATION
# ============================================================

# --- Arduino ---
# Set ARDUINO_PORT to a device path to pin the connection. With "auto", the
# reader discovers common Arduino/USB-serial device names after reconnects.
ARDUINO_PORT = os.getenv("ARDUINO_PORT", "auto").strip() or "auto"
ARDUINO_BAUD = 115200
ARDUINO_RECONNECT_DELAY = 5      # seconds between reconnect attempts
SENSOR_STALE_AFTER = 12          # allow several 2.5-second Arduino cycles to be missed

# Soil calibration:
# sensor in dry air -> raw value -> SOIL_DRY
# sensor in water   -> raw value -> SOIL_WET
SOIL_DRY = 1023
SOIL_WET = 174

# Soil status thresholds (% moisture). Tune for your crop / soil type.
SOIL_DRY_BELOW = 30
SOIL_ADEQUATE_BELOW = 60
SOIL_WET_BELOW = 85          # above this = saturated

# Rain considered "heavy" in the forecast (mm per day)
HEAVY_RAIN_MM = 10

# --- Farm info shown in the frontend (EDIT THESE) ---
FARM_NAME = "My Farm"
CROP = "My Crop"

# Languages the frontend can request for assistant answers
LANG_NAMES = {"en": "English", "te": "Telugu", "hi": "Hindi", "ja": "Japanese"}

# --- LLM (koboldcpp on the other laptop) ---
LLM_BASE_URL = "http://172.16.23.9:5001"
LLM_GENERATE_URL = f"{LLM_BASE_URL}/api/v1/generate"
LLM_MODEL_URL = f"{LLM_BASE_URL}/api/v1/model"
LLM_TIMEOUT = 300        # seconds to wait for the answer (slow laptops need this)
LLM_MAX_TOKENS = 300     # max length of an answer

# --- Weather (Open-Meteo, no key needed) ---
LATITUDE = 17.598
LONGITUDE = 78.4867
WEATHER_REFRESH_SECONDS = 30 * 60   # every 30 min
FORECAST_DAYS = 5

# --- Output ---
DATA_DIR = Path("data")
JSON_FILE = DATA_DIR / "field_data.json"
JSON_WRITE_INTERVAL = 2             # seconds

# --- Server ---
HOST = "0.0.0.0"
PORT = 8000


# ============================================================
# SHARED STATE (thread-safe)
# ============================================================

state_lock = threading.Lock()
stop_event = threading.Event()

state = {
    "sensors": {
        "soil_raw": None,
        "soil_moisture_percent": None,
        "soil_status": None,
        "temperature": None,
        "humidity": None,
        "updated_at": None,     # ISO timestamp of last valid reading
        "last_seen_at": None,   # ISO timestamp of the latest serial packet
    },
    "weather": {
        "current": None,
        "forecast": [],
        "rain_outlook": None,
        "updated_at": None,
        "error": None,
    },
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def age_seconds(iso: str | None) -> float | None:
    if not iso:
        return None
    return (datetime.now(timezone.utc) - datetime.fromisoformat(iso)).total_seconds()


def snapshot() -> dict:
    """Return a copy of the full state plus live status flags."""
    with state_lock:
        data = copy.deepcopy(state)

    # A serial packet is an Arduino heartbeat. A bad DHT sample should not make
    # the connected board appear offline; valid measurement freshness remains
    # available separately through updated_at.
    s_age = age_seconds(data["sensors"]["last_seen_at"])
    data["sensors"]["online"] = s_age is not None and s_age <= SENSOR_STALE_AFTER
    data["farm"] = {"name": FARM_NAME, "crop": CROP}
    data["generated_at"] = now_iso()
    return data


# ============================================================
# INTERPRETATION HELPERS (so the LLM gets facts, not raw numbers)
# ============================================================

def soil_to_percent(raw: int) -> float:
    """Convert raw ADC value to 0-100 % moisture (100 = fully wet)."""
    pct = (SOIL_DRY - raw) / (SOIL_DRY - SOIL_WET) * 100
    return round(max(0.0, min(100.0, pct)), 1)


def soil_label(pct: float | None) -> str:
    if pct is None:
        return "UNKNOWN"
    if pct < SOIL_DRY_BELOW:
        return "DRY - irrigation needed"
    if pct < SOIL_ADEQUATE_BELOW:
        return "ADEQUATE - no irrigation needed yet"
    if pct < SOIL_WET_BELOW:
        return "WET - do not irrigate"
    return "SATURATED - do not irrigate"


def rain_outlook(forecast: list[dict]) -> str:
    if not forecast:
        return "Forecast unavailable."
    heavy = [d["date"] for d in forecast if (d["rain_mm"] or 0) >= HEAVY_RAIN_MM]
    if heavy:
        return f"Heavy rain ({HEAVY_RAIN_MM} mm or more) expected on: {', '.join(heavy)}."
    total = round(sum((d["rain_mm"] or 0) for d in forecast), 1)
    return f"No heavy rain expected. Total forecast rain over {len(forecast)} days: {total} mm."


# ============================================================
# ARDUINO SERIAL READER
# ============================================================

def parse_line(line: str) -> tuple[int, float, float]:
    """
    Expected format: SOIL=170,TEMP=26.80,HUM=57.80
    (key names don't matter, only the order: soil, temperature, humidity)
    """
    values = {}
    for part in line.split(","):
        key, separator, value = part.partition("=")
        if separator:
            values[key.strip().upper()] = value.strip()

    if not {"SOIL", "TEMP", "HUM"}.issubset(values):
        raise ValueError("missing sensor fields")

    soil = int(values["SOIL"])
    temperature = float(values["TEMP"])
    humidity = float(values["HUM"])

    # DHT sensors can report NaN or infinity during a transient failed read.
    if not math.isfinite(temperature) or not math.isfinite(humidity):
        raise ValueError("non-finite value from sensor")

    return soil, temperature, humidity


def find_arduino_port() -> str | None:
    """Return the configured port or the most likely connected USB serial port."""
    if ARDUINO_PORT.lower() != "auto":
        return ARDUINO_PORT

    candidates = []
    for port in list_ports.comports():
        text = f"{port.device} {port.description} {port.manufacturer}".lower()
        score = 0
        if "arduino" in text:
            score += 100
        if "usb" in text or "serial" in text or "ch340" in text or "cp210" in text:
            score += 50
        if port.device.startswith("/dev/ttyACM"):
            score += 20
        elif port.device.startswith("/dev/ttyUSB"):
            score += 10
        if score:
            candidates.append((score, port.device))

    return max(candidates, default=(0, None))[1]


def read_arduino():
    """Runs forever in a background thread; reconnects if the cable drops."""
    while not stop_event.is_set():
        port = find_arduino_port()
        if not port:
            print("[arduino] no USB serial device found - retrying")
            stop_event.wait(ARDUINO_RECONNECT_DELAY)
            continue

        try:
            arduino = serial.Serial(port, ARDUINO_BAUD, timeout=1)
            arduino.reset_input_buffer()
            print(f"[arduino] connected on {port}")
        except Exception as e:
            print(f"[arduino] connect failed: {e} - retrying in {ARDUINO_RECONNECT_DELAY}s")
            stop_event.wait(ARDUINO_RECONNECT_DELAY)
            continue

        try:
            while not stop_event.is_set():
                line = arduino.readline().decode("utf-8", errors="ignore").strip()
                if not line:
                    continue

                with state_lock:
                    state["sensors"]["last_seen_at"] = now_iso()

                try:
                    soil, temperature, humidity = parse_line(line)
                except (ValueError, IndexError):
                    print(f"[arduino] invalid data: {line!r}")
                    continue

                pct = soil_to_percent(soil)
                with state_lock:
                    state["sensors"].update(
                        soil_raw=soil,
                        soil_moisture_percent=pct,
                        soil_status=soil_label(pct),
                        temperature=temperature,
                        humidity=humidity,
                        updated_at=now_iso(),
                    )
        except Exception as e:
            print(f"[arduino] serial error: {e} - reconnecting")
        finally:
            try:
                arduino.close()
            except Exception:
                pass
            stop_event.wait(ARDUINO_RECONNECT_DELAY)


# ============================================================
# WEATHER (Open-Meteo)
# ============================================================

# WMO weather interpretation codes -> plain text
WMO_CODES = {
    0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Fog", 48: "Depositing rime fog",
    51: "Light drizzle", 53: "Moderate drizzle", 55: "Dense drizzle",
    56: "Freezing drizzle", 57: "Heavy freezing drizzle",
    61: "Light rain", 63: "Moderate rain", 65: "Heavy rain",
    66: "Freezing rain", 67: "Heavy freezing rain",
    71: "Light snow", 73: "Moderate snow", 75: "Heavy snow", 77: "Snow grains",
    80: "Light rain showers", 81: "Moderate rain showers", 82: "Violent rain showers",
    85: "Light snow showers", 86: "Heavy snow showers",
    95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Severe thunderstorm with hail",
}


def fetch_weather() -> dict:
    params = {
        "latitude": LATITUDE,
        "longitude": LONGITUDE,
        "current": "temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m",
        "daily": (
            "weather_code,temperature_2m_max,temperature_2m_min,"
            "precipitation_sum,precipitation_probability_max,wind_speed_10m_max"
        ),
        "forecast_days": FORECAST_DAYS,
        "timezone": "auto",
    }
    r = httpx.get("https://api.open-meteo.com/v1/forecast", params=params, timeout=15)
    r.raise_for_status()
    raw = r.json()

    cur = raw["current"]
    current = {
        "temperature": cur["temperature_2m"],
        "humidity": cur["relative_humidity_2m"],
        "precipitation_mm": cur["precipitation"],
        "wind_speed_kmh": cur["wind_speed_10m"],
        "condition": WMO_CODES.get(cur["weather_code"], "Unknown"),
        "code": cur["weather_code"],
    }

    d = raw["daily"]
    forecast = []
    for i, date in enumerate(d["time"]):
        forecast.append({
            "date": date,
            "condition": WMO_CODES.get(d["weather_code"][i], "Unknown"),
            "code": d["weather_code"][i],
            "temp_max": d["temperature_2m_max"][i],
            "temp_min": d["temperature_2m_min"][i],
            "rain_mm": d["precipitation_sum"][i],
            "rain_chance_percent": d["precipitation_probability_max"][i],
            "wind_max_kmh": d["wind_speed_10m_max"][i],
        })

    return {"current": current, "forecast": forecast}


def weather_loop():
    while not stop_event.is_set():
        try:
            result = fetch_weather()
            with state_lock:
                state["weather"].update(
                    current=result["current"],
                    forecast=result["forecast"],
                    rain_outlook=rain_outlook(result["forecast"]),
                    updated_at=now_iso(),
                    error=None,
                )
            print("[weather] updated")
            wait = WEATHER_REFRESH_SECONDS
        except Exception as e:
            print(f"[weather] error: {e}")
            with state_lock:
                # keep the old data, just flag the error
                state["weather"]["error"] = str(e)
            wait = 60   # retry sooner after a failure
        stop_event.wait(wait)


# ============================================================
# JSON FILE WRITER (atomic so the frontend never reads half a file)
# ============================================================

def write_json_file():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = JSON_FILE.with_suffix(".json.tmp")

    while not stop_event.is_set():
        try:
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(snapshot(), f, indent=2, ensure_ascii=False)
            os.replace(tmp, JSON_FILE)   # atomic on Linux/macOS/Windows
        except Exception as e:
            print(f"[json] write error: {e}")
        stop_event.wait(JSON_WRITE_INTERVAL)


# ============================================================
# LLM (koboldcpp)
# ============================================================

def clean_llm_response(answer: str) -> str:
    """Strip Qwen <think> blocks if they leak through."""
    answer = re.sub(r"<think>.*?</think>", "", answer, flags=re.DOTALL)
    answer = answer.split("<think>", 1)[0]          # unterminated block
    return answer.replace("<|im_end|>", "").strip()


def build_context(data: dict) -> str:
    """Compact text summary of sensors + weather for the LLM prompt."""
    s = data["sensors"]
    w = data["weather"]

    if s["online"]:
        sensors_txt = (
            f"- Soil moisture: {s['soil_moisture_percent']}% "
            f"(raw sensor value {s['soil_raw']}; higher raw = drier)\n"
            f"- SOIL STATUS: {s['soil_status']}\n"
            f"- Field temperature: {s['temperature']} °C\n"
            f"- Field humidity: {s['humidity']} %"
        )
    else:
        sensors_txt = "- Field sensors are OFFLINE. No live readings available."

    if w["current"]:
        c = w["current"]
        weather_txt = (
            f"Now: {c['condition']}, {c['temperature']} °C, humidity {c['humidity']}%, "
            f"wind {c['wind_speed_kmh']} km/h, rain now {c['precipitation_mm']} mm\n"
            f"RAIN OUTLOOK: {w['rain_outlook']}\n"
            "Daily forecast:\n"
            + "\n".join(
                f"- {d['date']}: {d['condition']}, {d['temp_min']}-{d['temp_max']} °C, "
                f"rain {d['rain_mm']} mm ({d['rain_chance_percent']}% chance)"
                for d in w["forecast"]
            )
        )
    else:
        weather_txt = "Weather data unavailable."

    return f"FIELD SENSORS:\n{sensors_txt}\n\nWEATHER:\n{weather_txt}"


def build_prompt(question: str, data: dict, language: str = "English") -> str:
    return f"""<|im_start|>system
You are KISAN-TOMODACHI, an agricultural field assistant.
Help farmers understand their field and make practical decisions.

{build_context(data)}

Rules:
- Be concise and practical, in simple language.
- Use ONLY the readings above. Never invent sensor values or weather.
- Trust the SOIL STATUS and RAIN OUTLOOK lines; do not claim heavy rain unless RAIN OUTLOOK says so.
- If a sensor is offline or data is missing, say so.
- Do not advise irrigating when the soil is wet/saturated or heavy rain is expected.
- Give actionable advice. Do not show your reasoning.
- Keep answers short: under 100 words.
- Reply in {language}.
<|im_end|>
<|im_start|>user
{question}<|im_end|>
<|im_start|>assistant
<think>

</think>

"""


async def ask_llm(prompt: str) -> str:
    payload = {
        "prompt": prompt,
        "max_context_length": 4096,
        "max_length": LLM_MAX_TOKENS,
        "temperature": 0.7,
        "top_p": 0.9,
        "stop_sequence": ["<|im_end|>", "<|im_start|>"],
        "chat_template_kwargs": {"enable_thinking": False},
    }

    async with httpx.AsyncClient(timeout=LLM_TIMEOUT) as client:
        r = await client.post(LLM_GENERATE_URL, json=payload)
        r.raise_for_status()
        raw_text = r.json()["results"][0]["text"]

    answer = clean_llm_response(raw_text)
    if not answer:
        print(f"[llm] empty answer after cleaning. Raw output was: {raw_text!r}")
        raise ValueError("empty answer from LLM")
    return answer


async def llm_online() -> bool:
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            r = await client.get(LLM_MODEL_URL)
            return r.status_code == 200
    except Exception:
        return False


# ============================================================
# FASTAPI
# ============================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Start background workers (works with `python main.py` AND `uvicorn main:app`)
    for target in (read_arduino, weather_loop, write_json_file):
        threading.Thread(target=target, daemon=True).start()
    yield
    stop_event.set()


app = FastAPI(
    title="KISAN-TOMODACHI",
    description="Agricultural field monitoring and AI assistant",
    lifespan=lifespan,
)

# Lets a browser frontend on another origin/port call this API.
# Restrict allow_origins to your frontend's address for production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_DIR.mkdir(parents=True, exist_ok=True)
# The frontend can also fetch the file directly: http://<host>:8000/files/field_data.json
app.mount("/files", StaticFiles(directory=DATA_DIR), name="files")


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=1000)
    language: str = "en"


@app.get("/")
def root():
    return {"name": "KISAN-TOMODACHI", "status": "online"}


@app.get("/api/status")
async def get_status():
    data = snapshot()
    return {
        "system": True,
        "arduino": data["sensors"]["online"],
        "weather": data["weather"]["current"] is not None,
        "llm": await llm_online(),
    }


@app.get("/api/data")
def get_all_data():
    """Everything the frontend needs in one call (same content as the JSON file)."""
    return snapshot()


@app.get("/api/sensors")
def get_sensors():
    return snapshot()["sensors"]


@app.get("/api/weather")
def get_weather():
    return snapshot()["weather"]


@app.post("/api/ask")
async def ask_question(request: AskRequest):
    data = snapshot()
    prompt = build_prompt(request.question, data, LANG_NAMES.get(request.language, "English"))

    try:
        answer = await ask_llm(prompt)
    except Exception as e:
        print(f"[llm] error: {e}")
        raise HTTPException(status_code=503, detail="AI assistant is unreachable right now.")

    return {
        "question": request.question,
        "answer": answer,
        "sensors": data["sensors"],
        "weather": data["weather"]["current"],
    }


# ============================================================
# START SERVER
# ============================================================

if __name__ == "__main__":
    uvicorn.run(app, host=HOST, port=PORT)