#include <DHT.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

#define SOIL_PIN A0
#define DHT_PIN 2
#define DHT_TYPE DHT11

DHT dht(DHT_PIN, DHT_TYPE);
LiquidCrystal_I2C lcd(0x27, 16, 2);

const unsigned long SENSOR_INTERVAL_MS = 2500;
const unsigned long LCD_INTERVAL_MS = 2000;
unsigned long lastSensorRead = 0;
unsigned long lastLcdUpdate = 0;
bool showHumidity = false;
float lastTemperature = NAN;
float lastHumidity = NAN;

void setup() {
  Serial.begin(115200);
  dht.begin();

  lcd.init();
  lcd.backlight();
  lcd.clear();
}

void loop() {
  const unsigned long now = millis();

  // Publish sensor data at the DHT11-safe rate without blocking the loop.
  if (now - lastSensorRead >= SENSOR_INTERVAL_MS) {
    lastSensorRead = now;
    const int soil = analogRead(SOIL_PIN);
    const float temperature = dht.readTemperature();
    const float humidity = dht.readHumidity();

    if (!isnan(temperature) && !isnan(humidity)) {
      lastTemperature = temperature;
      lastHumidity = humidity;
    }

    Serial.print("SOIL=");
    Serial.print(soil);
    Serial.print(",TEMP=");
    // Keep the last valid DHT values when a transient read fails.
    Serial.print(lastTemperature);
    Serial.print(",HUM=");
    Serial.println(lastHumidity);
  }

  // Refresh the LCD independently so it never delays sensor publication.
  if (now - lastLcdUpdate >= LCD_INTERVAL_MS) {
    lastLcdUpdate = now;
    lcd.clear();
    if (showHumidity) {
      lcd.setCursor(0, 0);
      lcd.print("Humidity:");
      lcd.setCursor(0, 1);
      if (isnan(lastHumidity)) lcd.print("Reading...");
      else { lcd.print(lastHumidity, 1); lcd.print("%"); }
    } else {
      lcd.setCursor(0, 0);
      lcd.print("Soil: ");
      lcd.print(analogRead(SOIL_PIN));
      lcd.setCursor(0, 1);
      lcd.print("Temp:");
      if (isnan(lastTemperature)) lcd.print("Reading...");
      else { lcd.print(lastTemperature, 1); lcd.print((char)223); lcd.print("C "); }
    }
    showHumidity = !showHumidity;
  }
}