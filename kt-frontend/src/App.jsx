import React, { useState, useEffect, createContext, useContext, useRef } from 'react';
import {
  Home, CloudRain, Sprout, Bot, Activity, Settings,
  Droplets, Thermometer, Wind, Cloud, Sun, AlertTriangle,
  CheckCircle2, Languages, Moon, SunMedium, Send, Mic,
  Wifi, WifiOff, RefreshCw,
  Store, Users, Leaf, Award, Plus, Trash2, MapPin, Star,
  Gift, X, Wrench, Package, ShoppingBag, Phone, Calendar, Lock
} from 'lucide-react';

// ============================================================
// BACKEND CONFIG
// ============================================================

// By default the frontend talks to the backend on the same machine/host it was
// loaded from, port 8000. If your backend is elsewhere, set it here,
// e.g. 'http://192.168.1.50:8000'
const API_BASE_OVERRIDE = '';
const API_BASE = API_BASE_OVERRIDE || `${window.location.protocol}//${window.location.hostname}:8000`;
const POLL_MS = 5000;

// Soil thresholds (% moisture). Keep these in sync with SOIL_DRY_BELOW etc. in main.py
const SOIL_CRITICAL_BELOW = 15;
const SOIL_DRY_BELOW = 30;
const SOIL_COMFORTABLE_UPTO = 60;

const LOCALES = { en: 'en-IN', te: 'te-IN', hi: 'hi-IN', ja: 'ja-JP' };

// Safe number formatting (sensor values can be null while the Arduino is offline)
const fmt = (v, digits = 1) =>
  v === null || v === undefined || Number.isNaN(Number(v)) ? '--' : Number(v).toFixed(digits);

// Convert the backend's /api/data response into the shape the UI uses
const adaptBackendData = (raw) => {
  const sensors = raw.sensors || {};
  const cur = raw.weather && raw.weather.current ? raw.weather.current : null;
  const forecast = (raw.weather && raw.weather.forecast) || [];
  const online = !!sensors.online;

  return {
    timestamp: sensors.updated_at || raw.generated_at,
    farm: raw.farm || { name: 'Farm', crop: '' },
    online,
    weather: {
      available: !!cur,
      temperature: cur ? cur.temperature : null,
      humidity: cur ? cur.humidity : null,
      condition: cur ? cur.condition : '',
      code: cur ? cur.code : null,
      wind_speed: cur ? cur.wind_speed_kmh : null,
      rain_probability: forecast.length ? forecast[0].rain_chance_percent : null,
      forecast,
    },
    // If the Arduino is offline we show "unknown" rather than a stale value
    soil: { moisture: online ? sensors.soil_moisture_percent : null },
    // Last known raw values (shown on the Sensors page)
    sensors,
  };
};

// Logic to translate raw numbers into visual states
const VisualEngine = {
  getMoistureState: (val) => {
    if (val === null || val === undefined) return { color: 'bg-stone-300', text: 'unknown', icon: Droplets, ring: 'ring-stone-200' };
    if (val < SOIL_CRITICAL_BELOW) return { color: 'bg-red-500', text: 'critical_dry', icon: AlertTriangle, ring: 'ring-red-200' };
    if (val < SOIL_DRY_BELOW) return { color: 'bg-amber-500', text: 'dry', icon: Droplets, ring: 'ring-amber-200' };
    if (val <= SOIL_COMFORTABLE_UPTO) return { color: 'bg-green-500', text: 'comfortable', icon: Droplets, ring: 'ring-green-200' };
    return { color: 'bg-blue-500', text: 'wet', icon: Droplets, ring: 'ring-blue-200' };
  },
  getTempColor: (val) => {
    if (val === null || val === undefined) return 'text-stone-400';
    if (val < 15) return 'text-blue-500';
    if (val <= 30) return 'text-green-500';
    return 'text-amber-500';
  },
  // Open-Meteo / WMO weather codes -> icon
  getWeatherIcon: (code) => {
    if (code === null || code === undefined) return SunMedium;
    if (code <= 1) return Sun;
    if (code === 2) return SunMedium;
    if (code === 3 || code === 45 || code === 48) return Cloud;
    return CloudRain; // drizzle, rain, showers, thunderstorm...
  }
};

// ============================================================
// MARKETPLACE / HIRE / SDG STATIC DATA
// ============================================================

const LS_KEYS = {
  crops: 'kt_market_crop_listings',
  hireRequests: 'kt_hire_requests',
  sdgLog: 'kt_sdg_log',
};

// Categories farmers can buy from local businesses
const SUPPLY_CATEGORIES = ['manure', 'compost', 'seeds', 'tools'];
const CATEGORY_ICON = { manure: Package, compost: Leaf, seeds: Sprout, tools: Wrench };

// Seed data representing local businesses selling farm supplies
const SUPPLY_LISTINGS = [
  { id: 's1', category: 'manure', title: 'Organic Cow Manure', seller: 'Reddy Agro Supplies', price: 350, unit: 'per ton', location: 'Warangal', contact: '+91 98765 11111' },
  { id: 's2', category: 'compost', title: 'Vermicompost (Premium)', seller: 'Green Earth Traders', price: 12, unit: 'per kg', location: 'Karimnagar', contact: '+91 98765 22222' },
  { id: 's3', category: 'seeds', title: 'Hybrid Paddy Seeds', seller: 'Sri Sai Seed Store', price: 180, unit: 'per kg', location: 'Nizamabad', contact: '+91 98765 33333' },
  { id: 's4', category: 'seeds', title: 'Cotton Seeds (BT)', seller: 'Farmers Choice Agro', price: 850, unit: 'per packet', location: 'Adilabad', contact: '+91 98765 44444' },
  { id: 's5', category: 'tools', title: 'Power Tiller Rental', seller: 'Rural Equipment Hub', price: 900, unit: 'per day', location: 'Khammam', contact: '+91 98765 55555' },
  { id: 's6', category: 'compost', title: 'Neem Cake Compost', seller: 'Green Earth Traders', price: 25, unit: 'per kg', location: 'Karimnagar', contact: '+91 98765 22222' },
  { id: 's7', category: 'manure', title: 'Poultry Manure', seller: 'Reddy Agro Supplies', price: 280, unit: 'per ton', location: 'Warangal', contact: '+91 98765 11111' },
  { id: 's8', category: 'tools', title: 'Sprayer Pump (Battery)', seller: 'Rural Equipment Hub', price: 2200, unit: 'per unit', location: 'Khammam', contact: '+91 98765 55555' },
];

// Seed data representing local people available to watch fields
const FIELD_WATCHERS = [
  { id: 'w1', name: 'Ramesh Naik', rating: 4.8, rate: 400, experience: '6 yrs field watching', location: 'Warangal', contact: '+91 91234 10001' },
  { id: 'w2', name: 'Lakshmi Devi', rating: 4.9, rate: 350, experience: '4 yrs, also handles irrigation', location: 'Karimnagar', contact: '+91 91234 10002' },
  { id: 'w3', name: 'Suresh Yadav', rating: 4.6, rate: 380, experience: '8 yrs field watching & pest control', location: 'Nizamabad', contact: '+91 91234 10003' },
  { id: 'w4', name: 'Anjali Reddy', rating: 4.7, rate: 420, experience: '3 yrs, night watch specialist', location: 'Khammam', contact: '+91 91234 10004' },
];

// Sustainable practices a farmer can log, each worth eco points
const SDG_PRACTICES = [
  { id: 'organic_compost', points: 15 },
  { id: 'water_conservation', points: 20 },
  { id: 'crop_rotation', points: 15 },
  { id: 'reduced_pesticide', points: 20 },
  { id: 'rainwater_harvesting', points: 25 },
  { id: 'renewable_energy', points: 25 },
];

// Marketplace offers unlocked as the farmer accumulates eco points
const SDG_REWARDS = [
  { id: 'r1', threshold: 50, icon: Gift },
  { id: 'r2', threshold: 100, icon: Package },
  { id: 'r3', threshold: 150, icon: Wrench },
  { id: 'r4', threshold: 250, icon: Award },
];

const translations = {
  en: {
    app_name: "Kisan-Tomodachi",
    nav_home: "Home", nav_weather: "Weather", nav_crop: "Crop & Soil", nav_ai: "Assistant", nav_sensors: "Sensors", nav_settings: "Settings",
    status_connected: "Connected", status_offline: "Offline", status_updating: "Updating...", status_connecting: "Connecting to farm...",
    sensors_offline: "Sensors offline",
    hero_healthy: "Your farm looks good", hero_attention: "Needs Attention", hero_critical: "Action Required",
    moisture: "Soil Moisture", temp: "Temperature", humidity: "Humidity", wind: "Wind", rain_prob: "Rain Prob.",
    comfortable: "Comfortable", dry: "Dry", critical_dry: "Critically Dry", wet: "Wet", unknown: "Unknown",
    water_now: "Water Now", water_soon: "Water Soon", no_water_needed: "No Water Needed",
    ask_ai: "Ask Assistant...", ai_placeholder: "Type your question...",
    ai_greeting: "Hello! I'm your Kisan Assistant. Ask me about your soil, the weather, or when to water.",
    ai_error: "Sorry, I couldn't reach the assistant. Please try again.",
    ai_thinking: "Thinking...",
    q_water: "💧 Does it need water?", q_weather: "☀️ Weather tomorrow?", q_crop: "🌱 How is my field?",
    forecast: "5-Day Forecast", weather_unavailable: "Weather data unavailable", field_conditions: "Field Conditions",
    raw_data: "Raw Sensor Data", soil_raw: "Soil Raw ADC", last_updated: "Last updated",
    lang: "Language", theme: "Theme", light: "Light", dark: "Dark",

    nav_market: "Marketplace", nav_hire: "Field Watch", nav_sdg: "Sustainability",

    market_title: "Marketplace", market_subtitle: "Buy supplies from local businesses or sell your crop",
    market_buy_tab: "Buy Supplies", market_sell_tab: "Sell Your Crop",
    market_all: "All", market_manure: "Manure", market_compost: "Compost", market_seeds: "Seeds", market_tools: "Tools",
    market_contact_seller: "Contact Seller", market_your_listings: "Your Crop Listings",
    market_add_listing: "List Your Crop for Sale", market_crop_name: "Crop name", market_quantity: "Quantity",
    market_price: "Price", market_unit: "Unit (e.g. per kg)", market_location: "Location", market_post: "Post Listing",
    market_no_crop_listings: "You haven't listed any crops yet.", market_delete: "Remove",
    market_eco_offer: "Eco offer unlocked for you",

    hire_title: "Field Watch", hire_subtitle: "Hire trusted locals to watch your field while you're away",
    hire_find_tab: "Find a Watcher", hire_requests_tab: "My Requests",
    hire_per_day: "/ day", hire_hire_now: "Contact",
    hire_post_request: "Post a Field Watch Request", hire_location: "Field location",
    hire_start_date: "Start date", hire_end_date: "End date", hire_pay_offered: "Pay offered (per day)",
    hire_notes: "Notes (optional)", hire_submit: "Post Request",
    hire_no_requests: "You haven't posted any field watch requests yet.", hire_delete: "Cancel",
    hire_open: "Open", hire_status: "Status",

    sdg_title: "Sustainability", sdg_subtitle: "Log your sustainable practices and earn marketplace offers",
    sdg_eco_points: "Eco Points", sdg_log_practice: "Log a Sustainable Practice", sdg_add: "Log Practice",
    sdg_notes_placeholder: "Any notes (optional)", sdg_history: "Your Practice Log", sdg_no_logs: "No practices logged yet. Start earning eco points!",
    sdg_rewards: "Marketplace Offers", sdg_unlocked: "Unlocked", sdg_points_needed: "points needed",
    sdg_p_organic_compost: "Used organic compost/manure", sdg_p_water_conservation: "Water-efficient irrigation (drip/sprinkler)",
    sdg_p_crop_rotation: "Practiced crop rotation", sdg_p_reduced_pesticide: "Reduced chemical pesticide use",
    sdg_p_rainwater_harvesting: "Rainwater harvesting", sdg_p_renewable_energy: "Used solar/renewable energy on farm",
    sdg_r_r1: "10% off manure & compost", sdg_r_r2: "Free seed sample pack", sdg_r_r3: "20% off tool rentals", sdg_r_r4: "Free soil testing + priority buyer badge",
    pts: "pts"
  },
  te: { // Telugu
    app_name: "కిసాన్-తోమోడచి",
    nav_home: "హోమ్", nav_weather: "వాతావరణం", nav_crop: "పంట & నేల", nav_ai: "సహాయకుడు", nav_sensors: "సెన్సార్లు", nav_settings: "సెట్టింగ్‌లు",
    status_connected: "కనెక్ట్ చేయబడింది", status_offline: "ఆఫ్‌లైన్", status_updating: "నవీకరిస్తోంది...", status_connecting: "పొలానికి కనెక్ట్ అవుతోంది...",
    sensors_offline: "సెన్సార్లు ఆఫ్‌లైన్",
    hero_healthy: "మీ పొలం బాగుంది", hero_attention: "శ్రద్ధ అవసరం", hero_critical: "చర్య అవసరం",
    moisture: "నేల తేమ", temp: "ఉష్ణోగ్రత", humidity: "తేమ", wind: "గాలి", rain_prob: "వర్షం అవకాశం",
    comfortable: "సౌకర్యవంతంగా", dry: "పొడిగా", critical_dry: "చాలా పొడిగా", wet: "తడిగా", unknown: "తెలియదు",
    water_now: "నీరు పెట్టండి", water_soon: "త్వరలో నీరు పెట్టండి", no_water_needed: "నీరు అవసరం లేదు",
    ask_ai: "సహాయకుడిని అడగండి...", ai_placeholder: "మీ ప్రశ్నను టైప్ చేయండి...",
    ai_greeting: "నమస్కారం! నేను మీ కిసాన్ సహాయకుడిని. నేల, వాతావరణం లేదా నీరు ఎప్పుడు పెట్టాలో అడగండి.",
    ai_error: "క్షమించండి, సహాయకుడిని చేరుకోలేకపోయాను. మళ్ళీ ప్రయత్నించండి.",
    ai_thinking: "ఆలోచిస్తోంది...",
    q_water: "💧 నీరు పెట్టాలా?", q_weather: "☀️ రేపు వాతావరణం?", q_crop: "🌱 నా పొలం ఎలా ఉంది?",
    forecast: "5 రోజుల సూచన", weather_unavailable: "వాతావరణ సమాచారం అందుబాటులో లేదు", field_conditions: "పొలం పరిస్థితులు",
    raw_data: "ముడి డేటా", soil_raw: "నేల ముడి ADC", last_updated: "చివరి నవీకరణ",
    lang: "భాష", theme: "థీమ్", light: "లైట్", dark: "డార్క్",

    nav_market: "మార్కెట్‌ప్లేస్", nav_hire: "పొలం కాపలా", nav_sdg: "సుస్థిరత",

    market_title: "మార్కెట్‌ప్లేస్", market_subtitle: "స్థానిక వ్యాపారుల నుండి కొనండి లేదా మీ పంటను అమ్మండి",
    market_buy_tab: "సామాగ్రి కొనండి", market_sell_tab: "మీ పంట అమ్మండి",
    market_all: "అన్నీ", market_manure: "ఎరువు", market_compost: "కంపోస్ట్", market_seeds: "విత్తనాలు", market_tools: "పరికరాలు",
    market_contact_seller: "విక్రేతను సంప్రదించండి", market_your_listings: "మీ పంట లిస్టింగ్‌లు",
    market_add_listing: "మీ పంటను అమ్మకానికి పెట్టండి", market_crop_name: "పంట పేరు", market_quantity: "పరిమాణం",
    market_price: "ధర", market_unit: "యూనిట్ (ఉదా. కిలోకు)", market_location: "ప్రాంతం", market_post: "లిస్టింగ్ పోస్ట్ చేయండి",
    market_no_crop_listings: "మీరు ఇంకా ఏ పంటను లిస్ట్ చేయలేదు.", market_delete: "తీసివేయండి",
    market_eco_offer: "మీ కోసం ఎకో ఆఫర్ అన్‌లాక్ అయింది",

    hire_title: "పొలం కాపలా", hire_subtitle: "మీరు లేనప్పుడు పొలాన్ని కాపలా కాయడానికి విశ్వసనీయ స్థానికులను నియమించండి",
    hire_find_tab: "కాపలాదారుని కనుగొనండి", hire_requests_tab: "నా అభ్యర్థనలు",
    hire_per_day: "/ రోజుకు", hire_hire_now: "సంప్రదించండి",
    hire_post_request: "పొలం కాపలా అభ్యర్థన పోస్ట్ చేయండి", hire_location: "పొలం ప్రాంతం",
    hire_start_date: "ప్రారంభ తేదీ", hire_end_date: "ముగింపు తేదీ", hire_pay_offered: "ఇచ్చే వేతనం (రోజుకు)",
    hire_notes: "గమనికలు (ఐచ్ఛికం)", hire_submit: "అభ్యర్థన పోస్ట్ చేయండి",
    hire_no_requests: "మీరు ఇంకా ఏ కాపలా అభ్యర్థనను పోస్ట్ చేయలేదు.", hire_delete: "రద్దు చేయండి",
    hire_open: "తెరిచి ఉంది", hire_status: "స్థితి",

    sdg_title: "సుస్థిరత", sdg_subtitle: "మీ సుస్థిర పద్ధతులను నమోదు చేసి మార్కెట్‌ప్లేస్ ఆఫర్‌లు పొందండి",
    sdg_eco_points: "ఎకో పాయింట్లు", sdg_log_practice: "సుస్థిర పద్ధతిని నమోదు చేయండి", sdg_add: "నమోదు చేయండి",
    sdg_notes_placeholder: "గమనికలు (ఐచ్ఛికం)", sdg_history: "మీ పద్ధతుల చరిత్ర", sdg_no_logs: "ఇంకా ఏ పద్ధతులు నమోదు కాలేదు. ఎకో పాయింట్లు సంపాదించడం ప్రారంభించండి!",
    sdg_rewards: "మార్కెట్‌ప్లేస్ ఆఫర్‌లు", sdg_unlocked: "అన్‌లాక్ చేయబడింది", sdg_points_needed: "పాయింట్లు అవసరం",
    sdg_p_organic_compost: "సేంద్రియ కంపోస్ట్/ఎరువు వాడారు", sdg_p_water_conservation: "నీటి-సమర్థవంతమైన నీటిపారుదల (డ్రిప్/స్ప్రింక్లర్)",
    sdg_p_crop_rotation: "పంట మార్పిడి చేశారు", sdg_p_reduced_pesticide: "రసాయన పురుగుమందుల వాడకం తగ్గించారు",
    sdg_p_rainwater_harvesting: "వర్షపు నీటి సంరక్షణ", sdg_p_renewable_energy: "పొలంలో సౌర/పునరుత్పాదక శక్తి వాడారు",
    sdg_r_r1: "ఎరువు & కంపోస్ట్‌పై 10% తగ్గింపు", sdg_r_r2: "ఉచిత విత్తన నమూనా ప్యాక్", sdg_r_r3: "పరికరాల అద్దెపై 20% తగ్గింపు", sdg_r_r4: "ఉచిత నేల పరీక్ష + ప్రాధాన్యత కొనుగోలుదారు బ్యాడ్జ్",
    pts: "పాయింట్లు"
  },
  hi: { // Hindi
    app_name: "किसान-तोमोदाची",
    nav_home: "होम", nav_weather: "मौसम", nav_crop: "फसल और मिट्टी", nav_ai: "सहायक", nav_sensors: "सेंसर", nav_settings: "सेटिंग्स",
    status_connected: "जुड़ा हुआ", status_offline: "ऑफ़लाइन", status_updating: "अपडेट हो रहा है...", status_connecting: "खेत से जुड़ रहा है...",
    sensors_offline: "सेंसर ऑफ़लाइन",
    hero_healthy: "आपका खेत अच्छा दिख रहा है", hero_attention: "ध्यान दें", hero_critical: "कार्रवाई आवश्यक",
    moisture: "मिट्टी की नमी", temp: "तापमान", humidity: "नमी", wind: "हवा", rain_prob: "बारिश की संभावना",
    comfortable: "आरामदायक", dry: "सूखा", critical_dry: "बहुत सूखा", wet: "गीला", unknown: "अज्ञात",
    water_now: "पानी दें", water_soon: "जल्द पानी दें", no_water_needed: "पानी की आवश्यकता नहीं",
    ask_ai: "सहायक से पूछें...", ai_placeholder: "अपना प्रश्न टाइप करें...",
    ai_greeting: "नमस्ते! मैं आपका किसान सहायक हूँ। मिट्टी, मौसम या सिंचाई के बारे में पूछें।",
    ai_error: "क्षमा करें, सहायक से संपर्क नहीं हो सका। कृपया फिर कोशिश करें।",
    ai_thinking: "सोच रहा है...",
    q_water: "💧 क्या पानी देना है?", q_weather: "☀️ कल का मौसम?", q_crop: "🌱 मेरा खेत कैसा है?",
    forecast: "5 दिन का पूर्वानुमान", weather_unavailable: "मौसम की जानकारी उपलब्ध नहीं", field_conditions: "खेत की स्थिति",
    raw_data: "कच्चा डेटा", soil_raw: "मिट्टी का कच्चा ADC", last_updated: "अंतिम अपडेट",
    lang: "भाषा", theme: "थीम", light: "लाइट", dark: "डार्क",

    nav_market: "बाज़ार", nav_hire: "खेत की निगरानी", nav_sdg: "स्थिरता",

    market_title: "बाज़ार", market_subtitle: "स्थानीय व्यापारियों से सामान खरीदें या अपनी फसल बेचें",
    market_buy_tab: "सामान खरीदें", market_sell_tab: "अपनी फसल बेचें",
    market_all: "सभी", market_manure: "खाद", market_compost: "कम्पोस्ट", market_seeds: "बीज", market_tools: "औज़ार",
    market_contact_seller: "विक्रेता से संपर्क करें", market_your_listings: "आपकी फसल सूची",
    market_add_listing: "अपनी फसल बिक्री के लिए सूचीबद्ध करें", market_crop_name: "फसल का नाम", market_quantity: "मात्रा",
    market_price: "कीमत", market_unit: "इकाई (जैसे प्रति किलो)", market_location: "स्थान", market_post: "सूची पोस्ट करें",
    market_no_crop_listings: "आपने अभी तक कोई फसल सूचीबद्ध नहीं की है।", market_delete: "हटाएं",
    market_eco_offer: "आपके लिए इको ऑफर अनलॉक हुआ",

    hire_title: "खेत की निगरानी", hire_subtitle: "जब आप न हों तब खेत की निगरानी के लिए विश्वसनीय स्थानीय लोगों को नियुक्त करें",
    hire_find_tab: "निगरानीकर्ता खोजें", hire_requests_tab: "मेरे अनुरोध",
    hire_per_day: "/ प्रति दिन", hire_hire_now: "संपर्क करें",
    hire_post_request: "खेत निगरानी अनुरोध पोस्ट करें", hire_location: "खेत का स्थान",
    hire_start_date: "प्रारंभ तिथि", hire_end_date: "समाप्ति तिथि", hire_pay_offered: "प्रस्तावित मज़दूरी (प्रति दिन)",
    hire_notes: "नोट्स (वैकल्पिक)", hire_submit: "अनुरोध पोस्ट करें",
    hire_no_requests: "आपने अभी तक कोई निगरानी अनुरोध पोस्ट नहीं किया है।", hire_delete: "रद्द करें",
    hire_open: "खुला है", hire_status: "स्थिति",

    sdg_title: "स्थिरता", sdg_subtitle: "अपनी टिकाऊ प्रथाओं को दर्ज करें और बाज़ार ऑफर कमाएं",
    sdg_eco_points: "इको पॉइंट्स", sdg_log_practice: "टिकाऊ प्रथा दर्ज करें", sdg_add: "दर्ज करें",
    sdg_notes_placeholder: "कोई नोट्स (वैकल्पिक)", sdg_history: "आपका प्रथा लॉग", sdg_no_logs: "अभी तक कोई प्रथा दर्ज नहीं हुई। इको पॉइंट्स कमाना शुरू करें!",
    sdg_rewards: "बाज़ार ऑफर", sdg_unlocked: "अनलॉक हुआ", sdg_points_needed: "पॉइंट्स चाहिए",
    sdg_p_organic_compost: "जैविक खाद/कम्पोस्ट का उपयोग किया", sdg_p_water_conservation: "जल-कुशल सिंचाई (ड्रिप/स्प्रिंकलर)",
    sdg_p_crop_rotation: "फसल चक्रण अपनाया", sdg_p_reduced_pesticide: "रासायनिक कीटनाशक का उपयोग घटाया",
    sdg_p_rainwater_harvesting: "वर्षा जल संचयन", sdg_p_renewable_energy: "खेत में सौर/नवीकरणीय ऊर्जा का उपयोग किया",
    sdg_r_r1: "खाद व कम्पोस्ट पर 10% छूट", sdg_r_r2: "मुफ़्त बीज नमूना पैक", sdg_r_r3: "औज़ार किराए पर 20% छूट", sdg_r_r4: "मुफ़्त मिट्टी जांच + प्राथमिकता खरीदार बैज",
    pts: "पॉइंट्स"
  },
  ja: { // Japanese
    app_name: "農家の友",
    nav_home: "ホーム", nav_weather: "天気", nav_crop: "作物と土壌", nav_ai: "アシスタント", nav_sensors: "センサー", nav_settings: "設定",
    status_connected: "接続済み", status_offline: "オフライン", status_updating: "更新中...", status_connecting: "農場に接続中...",
    sensors_offline: "センサーオフライン",
    hero_healthy: "農場は良好です", hero_attention: "注意が必要", hero_critical: "対応が必要",
    moisture: "土壌水分", temp: "気温", humidity: "湿度", wind: "風", rain_prob: "降水確率",
    comfortable: "快適", dry: "乾燥", critical_dry: "非常に乾燥", wet: "湿潤", unknown: "不明",
    water_now: "水やりが必要", water_soon: "もうすぐ水やり", no_water_needed: "水やり不要",
    ask_ai: "質問する...", ai_placeholder: "質問を入力...",
    ai_greeting: "こんにちは!農家アシスタントです。土壌、天気、水やりのタイミングについて聞いてください。",
    ai_error: "アシスタントに接続できませんでした。もう一度お試しください。",
    ai_thinking: "考え中...",
    q_water: "💧 水やりは必要?", q_weather: "☀️ 明日の天気は?", q_crop: "🌱 畑の状態は?",
    forecast: "5日間の予報", weather_unavailable: "天気データがありません", field_conditions: "圃場の状態",
    raw_data: "生データ", soil_raw: "土壌ADC", last_updated: "最終更新",
    lang: "言語", theme: "テーマ", light: "ライト", dark: "ダーク",

    nav_market: "マーケット", nav_hire: "畑の見守り", nav_sdg: "サステナビリティ",

    market_title: "マーケット", market_subtitle: "地元業者から資材を購入、または作物を販売",
    market_buy_tab: "資材を購入", market_sell_tab: "作物を売る",
    market_all: "すべて", market_manure: "堆肥", market_compost: "コンポスト", market_seeds: "種子", market_tools: "農具",
    market_contact_seller: "販売者に連絡", market_your_listings: "あなたの出品",
    market_add_listing: "作物を出品する", market_crop_name: "作物名", market_quantity: "数量",
    market_price: "価格", market_unit: "単位(例: kgあたり)", market_location: "場所", market_post: "出品する",
    market_no_crop_listings: "まだ作物を出品していません。", market_delete: "削除",
    market_eco_offer: "エコ特典が利用可能です",

    hire_title: "畑の見守り", hire_subtitle: "不在時に畑を見守ってくれる地元の人を雇う",
    hire_find_tab: "見守り人を探す", hire_requests_tab: "自分の依頼",
    hire_per_day: "/ 日", hire_hire_now: "連絡する",
    hire_post_request: "畑の見守り依頼を投稿", hire_location: "畑の場所",
    hire_start_date: "開始日", hire_end_date: "終了日", hire_pay_offered: "提示する日給",
    hire_notes: "メモ(任意)", hire_submit: "依頼を投稿",
    hire_no_requests: "まだ見守り依頼を投稿していません。", hire_delete: "キャンセル",
    hire_open: "募集中", hire_status: "状態",

    sdg_title: "サステナビリティ", sdg_subtitle: "持続可能な取り組みを記録してマーケットの特典を獲得",
    sdg_eco_points: "エコポイント", sdg_log_practice: "取り組みを記録", sdg_add: "記録する",
    sdg_notes_placeholder: "メモ(任意)", sdg_history: "記録履歴", sdg_no_logs: "まだ記録がありません。エコポイントを貯めましょう!",
    sdg_rewards: "マーケット特典", sdg_unlocked: "解除済み", sdg_points_needed: "ポイント必要",
    sdg_p_organic_compost: "有機堆肥を使用した", sdg_p_water_conservation: "節水灌漑(ドリップ/スプリンクラー)",
    sdg_p_crop_rotation: "輪作を実施した", sdg_p_reduced_pesticide: "化学農薬の使用を削減した",
    sdg_p_rainwater_harvesting: "雨水を利用した", sdg_p_renewable_energy: "太陽光/再生可能エネルギーを利用した",
    sdg_r_r1: "堆肥・コンポスト10%オフ", sdg_r_r2: "無料種子サンプルパック", sdg_r_r3: "農具レンタル20%オフ", sdg_r_r4: "無料土壌検査+優先購入者バッジ",
    pts: "ポイント"
  }
};

const AppContext = createContext();

export const AppProvider = ({ children }) => {
  const [lang, setLang] = useState('en');
  const [theme, setTheme] = useState('light');
  const [view, setView] = useState('home');
  const [data, setData] = useState(null);          // null until first successful fetch
  const [isUpdating, setIsUpdating] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  // Marketplace: crop listings the farmer has posted for sale
  const [cropListings, setCropListings] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_KEYS.crops)) || []; } catch { return []; }
  });
  // Hire: field-watch requests the farmer has posted
  const [hireRequests, setHireRequests] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_KEYS.hireRequests)) || []; } catch { return []; }
  });
  // SDG: log of sustainable practices the farmer has recorded
  const [sdgLog, setSdgLog] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_KEYS.sdgLog)) || []; } catch { return []; }
  });

  useEffect(() => { localStorage.setItem(LS_KEYS.crops, JSON.stringify(cropListings)); }, [cropListings]);
  useEffect(() => { localStorage.setItem(LS_KEYS.hireRequests, JSON.stringify(hireRequests)); }, [hireRequests]);
  useEffect(() => { localStorage.setItem(LS_KEYS.sdgLog, JSON.stringify(sdgLog)); }, [sdgLog]);

  const ecoPoints = sdgLog.reduce((sum, entry) => sum + (entry.points || 0), 0);

  const addCropListing = (listing) => setCropListings(prev => [{ id: `c${Date.now()}`, ...listing }, ...prev]);
  const removeCropListing = (id) => setCropListings(prev => prev.filter(l => l.id !== id));

  const addHireRequest = (req) => setHireRequests(prev => [{ id: `h${Date.now()}`, status: 'open', ...req }, ...prev]);
  const removeHireRequest = (id) => setHireRequests(prev => prev.filter(r => r.id !== id));

  const addSdgEntry = (practiceId, notes) => {
    const practice = SDG_PRACTICES.find(p => p.id === practiceId);
    if (!practice) return;
    setSdgLog(prev => [{ id: `g${Date.now()}`, practiceId, points: practice.points, notes: notes || '', date: new Date().toISOString() }, ...prev]);
  };

  const t = (key) => translations[lang][key] || key;

  // Poll the backend for live sensor + weather data
  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      setIsUpdating(true);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      try {
        const res = await fetch(`${API_BASE}/api/data`, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = await res.json();
        if (!cancelled) {
          setData(adaptBackendData(raw));
          setIsConnected(true);
        }
      } catch (e) {
        if (!cancelled) setIsConnected(false);
      } finally {
        clearTimeout(timer);
        if (!cancelled) setIsUpdating(false);
      }
    };

    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  return (
    <AppContext.Provider value={{
      lang, setLang, theme, setTheme, view, setView, data, isUpdating, isConnected, t,
      cropListings, addCropListing, removeCropListing,
      hireRequests, addHireRequest, removeHireRequest,
      sdgLog, addSdgEntry, ecoPoints
    }}>
      <div className={`${theme === 'dark' ? 'dark bg-stone-900 text-stone-100' : 'bg-stone-50 text-stone-900'} min-h-screen font-sans transition-colors duration-300`}>
        {children}
      </div>
    </AppContext.Provider>
  );
};

const MoistureMeter = ({ value, label }) => {
  const state = VisualEngine.getMoistureState(value);
  const Icon = state.icon;
  const heightStr = `${Math.min(Math.max(value || 0, 0), 100)}%`;

  return (
    <div className="flex flex-col items-center">
      <div className={`relative w-24 h-48 md:h-64 rounded-full bg-stone-200 dark:bg-stone-800 overflow-hidden shadow-inner flex items-end ring-4 ${state.ring} mb-4`}>
        {/* Animated Fill */}
        <div
          className={`w-full ${state.color} transition-all duration-1000 ease-in-out`}
          style={{ height: heightStr }}
        />
        {/* Overlay Icon */}
        <div className="absolute inset-0 flex items-center justify-center">
           <Icon size={40} className="text-white opacity-80 drop-shadow-md" />
        </div>
      </div>
      <div className="text-center">
        <h3 className="font-bold text-xl md:text-2xl capitalize">{label}</h3>
        {/* Number is secondary, smaller */}
        <p className="text-stone-500 dark:text-stone-400 font-medium mt-1">{fmt(value)}%</p>
      </div>
    </div>
  );
};

const ConnectingView = () => {
  const { t, isConnected } = useContext(AppContext);
  return (
    <div className="p-8 flex flex-col items-center justify-center min-h-[60vh] text-center">
      {isConnected ? <RefreshCw size={48} className="animate-spin text-green-600 mb-6" /> : <WifiOff size={48} className="text-red-500 mb-6" />}
      <h1 className="text-2xl font-bold mb-2">{isConnected ? t('status_updating') : t('status_connecting')}</h1>
      <p className="text-stone-500 font-mono text-sm">{API_BASE}</p>
    </div>
  );
};

const HomeView = () => {
  const { data, t } = useContext(AppContext);
  const moisture = data.soil.moisture;
  const mState = VisualEngine.getMoistureState(moisture);
  const WeatherIcon = VisualEngine.getWeatherIcon(data.weather.code);

  const needsWater = moisture !== null && moisture < SOIL_DRY_BELOW;
  const isHealthy = data.online && moisture !== null && !needsWater;
  const heroColor = !data.online ? 'bg-stone-500' : isHealthy ? 'bg-green-600' : 'bg-amber-600';
  const heroTitle = !data.online ? t('sensors_offline') : isHealthy ? t('hero_healthy') : t('hero_attention');

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6 md:space-y-8 animate-in fade-in duration-500">

      {/* Farm Status Hero */}
      <div className={`p-6 md:p-10 rounded-3xl text-white shadow-lg flex flex-col md:flex-row items-center justify-between transition-colors duration-700 ${heroColor}`}>
        <div className="flex items-center space-x-6 mb-4 md:mb-0">
          <div className="bg-white/20 p-4 rounded-full">
            {isHealthy ? <CheckCircle2 size={64} /> : <AlertTriangle size={64} />}
          </div>
          <div>
            <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight mb-2">
              {heroTitle}
            </h1>
            <p className="text-lg md:text-xl opacity-90 flex items-center">
              <Sprout className="mr-2" /> {data.farm.crop} • {data.farm.name}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">

        {/* Primary Action / Visual: Soil */}
        <div className="bg-white dark:bg-stone-800 p-8 rounded-3xl shadow-sm border border-stone-100 dark:border-stone-700 flex flex-col items-center justify-center">
          <h2 className="text-2xl font-bold mb-8 text-stone-800 dark:text-stone-100">{t('moisture')}</h2>
          <MoistureMeter value={moisture} label={t(mState.text)} />

          <div className="mt-8 flex items-center justify-center p-4 rounded-2xl bg-stone-50 dark:bg-stone-900 w-full">
            {moisture === null ? (
              <span className="text-stone-500 font-bold text-xl flex items-center">
                <WifiOff className="mr-2" /> {t('sensors_offline')}
              </span>
            ) : needsWater ? (
              <span className="text-amber-600 dark:text-amber-400 font-bold text-xl flex items-center">
                <AlertTriangle className="mr-2" /> {t('water_now')}
              </span>
            ) : (
              <span className="text-green-600 dark:text-green-400 font-bold text-xl flex items-center">
                <CheckCircle2 className="mr-2" /> {t('no_water_needed')}
              </span>
            )}
          </div>
        </div>

        {/* Secondary Visuals: Weather & Crop */}
        <div className="space-y-6 md:space-y-8">

          {/* Quick Weather */}
          <div className="bg-white dark:bg-stone-800 p-6 rounded-3xl shadow-sm border border-stone-100 dark:border-stone-700">
            <h2 className="text-xl font-bold mb-4 flex items-center"><SunMedium className="mr-2"/> {t('nav_weather')}</h2>
            {data.weather.available ? (
              <div className="flex items-center justify-around">
                <WeatherIcon size={80} className="text-stone-400 drop-shadow" />
                <div className="text-center">
                  <div className={`text-5xl font-extrabold ${VisualEngine.getTempColor(data.weather.temperature)}`}>
                    {fmt(data.weather.temperature, 0)}°
                  </div>
                  <div className="text-stone-500 font-medium mt-1 flex items-center justify-center">
                    <Droplets size={16} className="mr-1" /> {fmt(data.weather.humidity, 0)}%
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-stone-500">{t('weather_unavailable')}</p>
            )}
          </div>

          {/* Quick Crop / field conditions */}
          <div className="bg-white dark:bg-stone-800 p-6 rounded-3xl shadow-sm border border-stone-100 dark:border-stone-700">
             <h2 className="text-xl font-bold mb-4 flex items-center"><Sprout className="mr-2"/> {t('nav_crop')}</h2>
             <div className="flex items-center space-x-4">
                <div className="p-4 rounded-full bg-green-500/10">
                  <Sprout size={48} className="text-green-500" />
                </div>
                <div>
                  <div className="text-2xl font-bold capitalize text-green-600 dark:text-green-400">{data.farm.crop}</div>
                  <div className="text-stone-500 text-lg flex items-center space-x-3">
                    <span className="flex items-center"><Thermometer size={16} className="mr-1" />{fmt(data.sensors.temperature)}°C</span>
                    <span className="flex items-center"><Droplets size={16} className="mr-1" />{fmt(data.sensors.humidity)}%</span>
                  </div>
                </div>
             </div>
          </div>

        </div>
      </div>
    </div>
  );
};

const WeatherView = () => {
  const { data, t, lang } = useContext(AppContext);
  const WeatherIcon = VisualEngine.getWeatherIcon(data.weather.code);

  if (!data.weather.available) {
    return (
      <div className="p-4 md:p-8 max-w-5xl mx-auto animate-in fade-in">
        <h1 className="text-4xl font-extrabold mb-8 flex items-center"><Cloud className="mr-4" size={40} /> {t('nav_weather')}</h1>
        <p className="text-stone-500 text-xl">{t('weather_unavailable')}</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto animate-in fade-in">
      <h1 className="text-4xl font-extrabold mb-8 flex items-center"><Cloud className="mr-4" size={40} /> {t('nav_weather')}</h1>

      <div className="bg-sky-100 dark:bg-sky-900/30 p-10 rounded-3xl flex flex-col md:flex-row items-center justify-around shadow-sm mb-8">
        <WeatherIcon size={160} className="text-sky-500 dark:text-sky-300 drop-shadow-xl mb-6 md:mb-0" />
        <div className="text-center md:text-left">
          <div className="text-8xl font-black text-stone-800 dark:text-white">
            {fmt(data.weather.temperature, 0)}°C
          </div>
          <div className="text-2xl text-stone-600 dark:text-stone-300 font-medium capitalize mt-2">
            {data.weather.condition}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[
          { icon: Droplets, label: t('humidity'), val: `${fmt(data.weather.humidity, 0)}%`, color: 'text-blue-500' },
          { icon: Wind, label: t('wind'), val: `${fmt(data.weather.wind_speed)} km/h`, color: 'text-teal-500' },
          { icon: CloudRain, label: t('rain_prob'), val: `${fmt(data.weather.rain_probability, 0)}%`, color: 'text-indigo-500' },
          { icon: Thermometer, label: t('temp'), val: `${fmt(data.weather.temperature)}°C`, color: 'text-amber-500' },
        ].map((item, i) => (
          <div key={i} className="bg-white dark:bg-stone-800 p-6 rounded-3xl shadow-sm text-center border border-stone-100 dark:border-stone-700">
            <item.icon size={48} className={`mx-auto mb-4 ${item.color} opacity-80`} />
            <div className="text-xl font-bold">{item.val}</div>
            <div className="text-stone-500 mt-1">{item.label}</div>
          </div>
        ))}
      </div>

      {/* Forecast */}
      {data.weather.forecast.length > 0 && (
        <>
          <h2 className="text-2xl font-bold mb-4">{t('forecast')}</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {data.weather.forecast.map((d) => {
              const DayIcon = VisualEngine.getWeatherIcon(d.code);
              const day = new Date(`${d.date}T00:00:00`).toLocaleDateString(LOCALES[lang] || 'en-IN', { weekday: 'short', day: 'numeric' });
              return (
                <div key={d.date} className="bg-white dark:bg-stone-800 p-5 rounded-3xl shadow-sm text-center border border-stone-100 dark:border-stone-700">
                  <div className="font-bold text-stone-600 dark:text-stone-300">{day}</div>
                  <DayIcon size={44} className="mx-auto my-3 text-sky-500 opacity-90" />
                  <div className="text-lg font-bold">
                    {fmt(d.temp_max, 0)}° <span className="text-stone-400 font-medium">/ {fmt(d.temp_min, 0)}°</span>
                  </div>
                  <div className="text-sm text-indigo-500 mt-2 flex items-center justify-center">
                    <CloudRain size={14} className="mr-1" /> {fmt(d.rain_chance_percent, 0)}% · {fmt(d.rain_mm)} mm
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

const CropSoilView = () => {
  const { data, t } = useContext(AppContext);
  const mState = VisualEngine.getMoistureState(data.soil.moisture);

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto animate-in fade-in">
       <h1 className="text-4xl font-extrabold mb-8 flex items-center"><Sprout className="mr-4" size={40} /> {t('nav_crop')}</h1>

       <div className="grid md:grid-cols-2 gap-8">
          {/* Soil Detail */}
          <div className="bg-white dark:bg-stone-800 p-8 rounded-3xl shadow-sm border border-stone-100 dark:border-stone-700">
            <h2 className="text-2xl font-bold mb-6 text-stone-800 dark:text-stone-100 flex items-center"><Activity className="mr-2"/> Soil Profile</h2>

            <div className="mb-10 flex justify-center">
              <MoistureMeter value={data.soil.moisture} label={t(mState.text)} />
            </div>

            <div className="pt-6 border-t border-stone-100 dark:border-stone-700 flex justify-between items-center">
              <span className="text-stone-500 font-bold uppercase text-sm tracking-wider">{t('soil_raw')}</span>
              <span className="text-3xl font-black">{data.sensors.soil_raw ?? '--'}</span>
            </div>
          </div>

          {/* Crop + field conditions */}
          <div className="space-y-8">
            <div className="bg-stone-800 text-white p-8 rounded-3xl shadow-sm flex flex-col items-center justify-center relative overflow-hidden">
              <Sprout size={120} className="text-green-400 mb-4 drop-shadow-lg z-10" />
              <div className="absolute -bottom-10 -right-10 opacity-10"><Sprout size={300} /></div>
              <h2 className="text-3xl font-extrabold z-10">{data.farm.crop}</h2>
              <p className="text-xl text-stone-300 mt-2 z-10">{data.farm.name}</p>
            </div>

            <div className="bg-white dark:bg-stone-800 p-8 rounded-3xl shadow-sm border border-stone-100 dark:border-stone-700">
              <h3 className="text-xl font-bold mb-6">{t('field_conditions')}</h3>
              <div className="grid grid-cols-2 gap-6">
                <div className="text-center">
                  <Thermometer size={40} className={`mx-auto mb-2 ${VisualEngine.getTempColor(data.sensors.temperature)}`} />
                  <div className="text-3xl font-black">{fmt(data.sensors.temperature)}°C</div>
                  <div className="text-stone-500 mt-1">{t('temp')}</div>
                </div>
                <div className="text-center">
                  <Droplets size={40} className="mx-auto mb-2 text-blue-500" />
                  <div className="text-3xl font-black">{fmt(data.sensors.humidity)}%</div>
                  <div className="text-stone-500 mt-1">{t('humidity')}</div>
                </div>
              </div>
            </div>
          </div>
       </div>
    </div>
  );
};

const MarketplaceView = () => {
  const { t, cropListings, addCropListing, removeCropListing, ecoPoints } = useContext(AppContext);
  const [tab, setTab] = useState('buy');
  const [category, setCategory] = useState('all');
  const [form, setForm] = useState({ crop: '', quantity: '', price: '', unit: '', location: '' });

  const hasEcoOffer = ecoPoints >= SDG_REWARDS[0].threshold;
  const filtered = category === 'all' ? SUPPLY_LISTINGS : SUPPLY_LISTINGS.filter(l => l.category === category);

  const submit = (e) => {
    e.preventDefault();
    if (!form.crop || !form.quantity || !form.price) return;
    addCropListing(form);
    setForm({ crop: '', quantity: '', price: '', unit: '', location: '' });
  };

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto animate-in fade-in">
      <h1 className="text-4xl font-extrabold mb-2 flex items-center"><Store className="mr-4" size={40} /> {t('market_title')}</h1>
      <p className="text-stone-500 mb-8">{t('market_subtitle')}</p>

      {/* Tabs */}
      <div className="flex space-x-2 mb-8 bg-stone-100 dark:bg-stone-800 p-1.5 rounded-2xl w-fit">
        {[['buy', t('market_buy_tab')], ['sell', t('market_sell_tab')]].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-6 py-3 rounded-xl font-bold transition-colors ${tab === key ? 'bg-white dark:bg-stone-700 text-green-700 dark:text-green-400 shadow-sm' : 'text-stone-500'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'buy' && (
        <>
          <div className="flex space-x-2 mb-6 overflow-x-auto pb-2">
            {['all', ...SUPPLY_CATEGORIES].map(cat => (
              <button key={cat} onClick={() => setCategory(cat)}
                className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-bold border-2 transition-colors ${category === cat ? 'bg-green-50 border-green-500 text-green-700 dark:bg-green-900/30 dark:border-green-500 dark:text-green-300' : 'border-transparent bg-stone-100 dark:bg-stone-700'}`}>
                {cat === 'all' ? t('market_all') : t(`market_${cat}`)}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {filtered.map(item => {
              const Icon = CATEGORY_ICON[item.category] || Package;
              return (
                <div key={item.id} className="bg-white dark:bg-stone-800 p-6 rounded-3xl shadow-sm border border-stone-100 dark:border-stone-700">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center space-x-4">
                      <div className="p-3 rounded-2xl bg-green-500/10"><Icon size={28} className="text-green-600 dark:text-green-400" /></div>
                      <div>
                        <h3 className="font-bold text-lg">{item.title}</h3>
                        <p className="text-stone-500 text-sm flex items-center"><MapPin size={14} className="mr-1" /> {item.location}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xl font-black text-green-700 dark:text-green-400">₹{item.price}</div>
                      <div className="text-stone-400 text-xs">{item.unit}</div>
                    </div>
                  </div>
                  {hasEcoOffer && (
                    <div className="mb-4 flex items-center text-xs font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 rounded-xl">
                      <Gift size={14} className="mr-2" /> {t('market_eco_offer')}
                    </div>
                  )}
                  <div className="pt-4 border-t border-stone-100 dark:border-stone-700 flex items-center justify-between">
                    <span className="text-stone-500 text-sm">{item.seller}</span>
                    <a href={`tel:${item.contact}`} className="flex items-center px-4 py-2 bg-green-600 text-white rounded-full font-bold text-sm hover:bg-green-700 transition-colors">
                      <Phone size={14} className="mr-2" /> {t('market_contact_seller')}
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {tab === 'sell' && (
        <div className="grid md:grid-cols-2 gap-8">
          <form onSubmit={submit} className="bg-white dark:bg-stone-800 p-8 rounded-3xl shadow-sm border border-stone-100 dark:border-stone-700 space-y-4 h-fit">
            <h2 className="text-xl font-bold mb-2 flex items-center"><ShoppingBag className="mr-2" /> {t('market_add_listing')}</h2>
            <input value={form.crop} onChange={e => setForm({ ...form, crop: e.target.value })} placeholder={t('market_crop_name')} className="w-full bg-stone-100 dark:bg-stone-700 p-4 rounded-2xl outline-none" />
            <div className="grid grid-cols-2 gap-4">
              <input value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} placeholder={t('market_quantity')} className="w-full bg-stone-100 dark:bg-stone-700 p-4 rounded-2xl outline-none" />
              <input value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} placeholder={t('market_unit')} className="w-full bg-stone-100 dark:bg-stone-700 p-4 rounded-2xl outline-none" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <input value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} placeholder={t('market_price')} type="number" className="w-full bg-stone-100 dark:bg-stone-700 p-4 rounded-2xl outline-none" />
              <input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder={t('market_location')} className="w-full bg-stone-100 dark:bg-stone-700 p-4 rounded-2xl outline-none" />
            </div>
            <button type="submit" className="w-full flex items-center justify-center p-4 bg-green-600 text-white rounded-2xl font-bold hover:bg-green-700 transition-colors">
              <Plus size={20} className="mr-2" /> {t('market_post')}
            </button>
          </form>

          <div>
            <h2 className="text-xl font-bold mb-4">{t('market_your_listings')}</h2>
            {cropListings.length === 0 ? (
              <p className="text-stone-500">{t('market_no_crop_listings')}</p>
            ) : (
              <div className="space-y-4">
                {cropListings.map(l => (
                  <div key={l.id} className="bg-white dark:bg-stone-800 p-5 rounded-3xl shadow-sm border border-stone-100 dark:border-stone-700 flex items-center justify-between">
                    <div>
                      <h3 className="font-bold text-lg capitalize">{l.crop}</h3>
                      <p className="text-stone-500 text-sm">{l.quantity} {l.unit} • ₹{l.price} • {l.location}</p>
                    </div>
                    <button onClick={() => removeCropListing(l.id)} className="p-3 rounded-full bg-red-50 dark:bg-red-900/20 text-red-600 hover:bg-red-100 transition-colors">
                      <Trash2 size={18} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const HireView = () => {
  const { t, hireRequests, addHireRequest, removeHireRequest } = useContext(AppContext);
  const [tab, setTab] = useState('find');
  const [form, setForm] = useState({ location: '', startDate: '', endDate: '', pay: '', notes: '' });

  const submit = (e) => {
    e.preventDefault();
    if (!form.location || !form.startDate || !form.endDate) return;
    addHireRequest(form);
    setForm({ location: '', startDate: '', endDate: '', pay: '', notes: '' });
  };

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto animate-in fade-in">
      <h1 className="text-4xl font-extrabold mb-2 flex items-center"><Users className="mr-4" size={40} /> {t('hire_title')}</h1>
      <p className="text-stone-500 mb-8">{t('hire_subtitle')}</p>

      <div className="flex space-x-2 mb-8 bg-stone-100 dark:bg-stone-800 p-1.5 rounded-2xl w-fit">
        {[['find', t('hire_find_tab')], ['requests', t('hire_requests_tab')]].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-6 py-3 rounded-xl font-bold transition-colors ${tab === key ? 'bg-white dark:bg-stone-700 text-green-700 dark:text-green-400 shadow-sm' : 'text-stone-500'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'find' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {FIELD_WATCHERS.map(w => (
            <div key={w.id} className="bg-white dark:bg-stone-800 p-6 rounded-3xl shadow-sm border border-stone-100 dark:border-stone-700">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center space-x-4">
                  <div className="p-3 rounded-full bg-green-500/10"><Users size={28} className="text-green-600 dark:text-green-400" /></div>
                  <div>
                    <h3 className="font-bold text-lg">{w.name}</h3>
                    <p className="text-stone-500 text-sm flex items-center"><MapPin size={14} className="mr-1" /> {w.location}</p>
                  </div>
                </div>
                <div className="flex items-center text-amber-500 font-bold"><Star size={16} className="mr-1 fill-amber-500" /> {w.rating}</div>
              </div>
              <p className="text-stone-500 text-sm mb-4">{w.experience}</p>
              <div className="pt-4 border-t border-stone-100 dark:border-stone-700 flex items-center justify-between">
                <span className="text-xl font-black text-green-700 dark:text-green-400">₹{w.rate}<span className="text-sm text-stone-400 font-medium">{t('hire_per_day')}</span></span>
                <a href={`tel:${w.contact}`} className="flex items-center px-4 py-2 bg-green-600 text-white rounded-full font-bold text-sm hover:bg-green-700 transition-colors">
                  <Phone size={14} className="mr-2" /> {t('hire_hire_now')}
                </a>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'requests' && (
        <div className="grid md:grid-cols-2 gap-8">
          <form onSubmit={submit} className="bg-white dark:bg-stone-800 p-8 rounded-3xl shadow-sm border border-stone-100 dark:border-stone-700 space-y-4 h-fit">
            <h2 className="text-xl font-bold mb-2 flex items-center"><Calendar className="mr-2" /> {t('hire_post_request')}</h2>
            <input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder={t('hire_location')} className="w-full bg-stone-100 dark:bg-stone-700 p-4 rounded-2xl outline-none" />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-stone-500 font-bold uppercase ml-2">{t('hire_start_date')}</label>
                <input value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} type="date" className="w-full bg-stone-100 dark:bg-stone-700 p-4 rounded-2xl outline-none mt-1" />
              </div>
              <div>
                <label className="text-xs text-stone-500 font-bold uppercase ml-2">{t('hire_end_date')}</label>
                <input value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })} type="date" className="w-full bg-stone-100 dark:bg-stone-700 p-4 rounded-2xl outline-none mt-1" />
              </div>
            </div>
            <input value={form.pay} onChange={e => setForm({ ...form, pay: e.target.value })} placeholder={t('hire_pay_offered')} type="number" className="w-full bg-stone-100 dark:bg-stone-700 p-4 rounded-2xl outline-none" />
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder={t('hire_notes')} rows={3} className="w-full bg-stone-100 dark:bg-stone-700 p-4 rounded-2xl outline-none resize-none" />
            <button type="submit" className="w-full flex items-center justify-center p-4 bg-green-600 text-white rounded-2xl font-bold hover:bg-green-700 transition-colors">
              <Plus size={20} className="mr-2" /> {t('hire_submit')}
            </button>
          </form>

          <div>
            {hireRequests.length === 0 ? (
              <p className="text-stone-500">{t('hire_no_requests')}</p>
            ) : (
              <div className="space-y-4">
                {hireRequests.map(r => (
                  <div key={r.id} className="bg-white dark:bg-stone-800 p-5 rounded-3xl shadow-sm border border-stone-100 dark:border-stone-700">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-bold text-lg flex items-center"><MapPin size={16} className="mr-1 text-green-600" /> {r.location}</h3>
                        <p className="text-stone-500 text-sm mt-1">{r.startDate} → {r.endDate}</p>
                        {r.notes && <p className="text-stone-400 text-sm mt-1 italic">"{r.notes}"</p>}
                      </div>
                      <button onClick={() => removeHireRequest(r.id)} className="p-3 rounded-full bg-red-50 dark:bg-red-900/20 text-red-600 hover:bg-red-100 transition-colors">
                        <Trash2 size={18} />
                      </button>
                    </div>
                    <div className="mt-4 pt-4 border-t border-stone-100 dark:border-stone-700 flex items-center justify-between text-sm">
                      <span className="px-3 py-1 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 font-bold">{t('hire_open')}</span>
                      {r.pay && <span className="font-bold">₹{r.pay}{t('hire_per_day')}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const SDGView = () => {
  const { t, sdgLog, addSdgEntry, ecoPoints } = useContext(AppContext);
  const [practiceId, setPracticeId] = useState(SDG_PRACTICES[0].id);
  const [notes, setNotes] = useState('');

  const submit = (e) => {
    e.preventDefault();
    addSdgEntry(practiceId, notes);
    setNotes('');
  };

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto animate-in fade-in">
      <h1 className="text-4xl font-extrabold mb-2 flex items-center"><Leaf className="mr-4" size={40} /> {t('sdg_title')}</h1>
      <p className="text-stone-500 mb-8">{t('sdg_subtitle')}</p>

      {/* Eco points hero */}
      <div className="p-6 md:p-10 rounded-3xl text-white shadow-lg flex items-center justify-between bg-green-600 mb-8">
        <div className="flex items-center space-x-6">
          <div className="bg-white/20 p-4 rounded-full"><Award size={56} /></div>
          <div>
            <p className="text-lg opacity-90">{t('sdg_eco_points')}</p>
            <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight">{ecoPoints} <span className="text-2xl font-bold opacity-80">{t('pts')}</span></h2>
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-8 mb-8">
        {/* Log practice form */}
        <form onSubmit={submit} className="bg-white dark:bg-stone-800 p-8 rounded-3xl shadow-sm border border-stone-100 dark:border-stone-700 space-y-4 h-fit">
          <h2 className="text-xl font-bold mb-2">{t('sdg_log_practice')}</h2>
          <div className="grid grid-cols-1 gap-2">
            {SDG_PRACTICES.map(p => (
              <button type="button" key={p.id} onClick={() => setPracticeId(p.id)}
                className={`text-left p-4 rounded-2xl font-medium flex items-center justify-between border-2 transition-colors ${practiceId === p.id ? 'bg-green-50 border-green-500 text-green-700 dark:bg-green-900/30 dark:border-green-500 dark:text-green-300' : 'border-transparent bg-stone-100 dark:bg-stone-700'}`}>
                <span>{t(`sdg_p_${p.id}`)}</span>
                <span className="text-sm font-bold whitespace-nowrap ml-2">+{p.points} {t('pts')}</span>
              </button>
            ))}
          </div>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('sdg_notes_placeholder')} rows={2} className="w-full bg-stone-100 dark:bg-stone-700 p-4 rounded-2xl outline-none resize-none" />
          <button type="submit" className="w-full flex items-center justify-center p-4 bg-green-600 text-white rounded-2xl font-bold hover:bg-green-700 transition-colors">
            <Plus size={20} className="mr-2" /> {t('sdg_add')}
          </button>
        </form>

        {/* Rewards */}
        <div>
          <h2 className="text-xl font-bold mb-4 flex items-center"><Gift className="mr-2" /> {t('sdg_rewards')}</h2>
          <div className="space-y-4">
            {SDG_REWARDS.map(r => {
              const unlocked = ecoPoints >= r.threshold;
              const Icon = r.icon;
              return (
                <div key={r.id} className={`p-5 rounded-3xl shadow-sm border flex items-center justify-between ${unlocked ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800' : 'bg-white dark:bg-stone-800 border-stone-100 dark:border-stone-700'}`}>
                  <div className="flex items-center space-x-4">
                    <div className={`p-3 rounded-2xl ${unlocked ? 'bg-amber-500/20 text-amber-600' : 'bg-stone-200 dark:bg-stone-700 text-stone-400'}`}>
                      {unlocked ? <Icon size={24} /> : <Lock size={24} />}
                    </div>
                    <div>
                      <h3 className="font-bold">{t(`sdg_r_${r.id}`)}</h3>
                      <p className="text-stone-500 text-sm">{r.threshold} {t('pts')}</p>
                    </div>
                  </div>
                  {unlocked ? (
                    <span className="px-3 py-1 rounded-full bg-amber-500 text-white text-xs font-bold">{t('sdg_unlocked')}</span>
                  ) : (
                    <span className="text-xs text-stone-400 font-bold text-right">{r.threshold - ecoPoints} {t('sdg_points_needed')}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* History */}
      <h2 className="text-xl font-bold mb-4">{t('sdg_history')}</h2>
      {sdgLog.length === 0 ? (
        <p className="text-stone-500">{t('sdg_no_logs')}</p>
      ) : (
        <div className="space-y-3">
          {sdgLog.map(entry => (
            <div key={entry.id} className="bg-white dark:bg-stone-800 p-5 rounded-3xl shadow-sm border border-stone-100 dark:border-stone-700 flex items-center justify-between">
              <div>
                <h3 className="font-bold">{t(`sdg_p_${entry.practiceId}`)}</h3>
                <p className="text-stone-500 text-sm">{new Date(entry.date).toLocaleDateString()} {entry.notes && `• ${entry.notes}`}</p>
              </div>
              <span className="font-bold text-green-600 dark:text-green-400">+{entry.points} {t('pts')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const AssistantView = () => {
  const { t, lang } = useContext(AppContext);
  const [msgs, setMsgs] = useState([]);       // conversation (the greeting is rendered separately so it follows the language)
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    if (bottomRef.current) bottomRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [msgs, loading]);

  const send = async (text) => {
    const question = (text || '').trim();
    if (!question || loading) return;

    setMsgs(prev => [...prev, { role: 'user', text: question }]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, language: lang }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setMsgs(prev => [...prev, { role: 'ai', text: json.answer || t('ai_error') }]);
    } catch (e) {
      setMsgs(prev => [...prev, { role: 'ai', text: t('ai_error') }]);
    } finally {
      setLoading(false);
    }
  };

  const bubble = (m, i) => (
    <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] p-4 rounded-2xl text-lg whitespace-pre-wrap ${m.role === 'user' ? 'bg-green-600 text-white rounded-br-sm' : 'bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-bl-sm'}`}>
        {m.text}
      </div>
    </div>
  );

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto h-[calc(100vh-100px)] md:h-[calc(100vh-40px)] flex flex-col animate-in fade-in">
       <div className="bg-white dark:bg-stone-800 rounded-t-3xl p-6 shadow-sm border-b border-stone-100 dark:border-stone-700 flex items-center">
         <div className="bg-green-100 dark:bg-green-900/50 p-3 rounded-full mr-4"><Bot size={32} className="text-green-600 dark:text-green-400" /></div>
         <h1 className="text-2xl font-bold">Kisan Assistant</h1>
       </div>

       <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-stone-50 dark:bg-stone-900/50">
          {bubble({ role: 'ai', text: t('ai_greeting') }, 'greeting')}
          {msgs.map((m, i) => bubble(m, i))}
          {loading && (
            <div className="flex justify-start">
              <div className="p-4 rounded-2xl text-lg bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-bl-sm text-stone-500 flex items-center">
                <RefreshCw size={18} className="mr-2 animate-spin" /> {t('ai_thinking')}
              </div>
            </div>
          )}
          <div ref={bottomRef} />
       </div>

       <div className="p-4 bg-white dark:bg-stone-800 rounded-b-3xl shadow-lg border-t border-stone-100 dark:border-stone-700">
          <div className="flex space-x-2 mb-4 overflow-x-auto pb-2">
            {['q_water', 'q_weather', 'q_crop'].map(key => (
              <button key={key} onClick={() => send(t(key))} disabled={loading} className="whitespace-nowrap px-4 py-2 bg-stone-100 dark:bg-stone-700 rounded-full text-sm font-medium hover:bg-stone-200 dark:hover:bg-stone-600 transition-colors disabled:opacity-50">
                {t(key)}
              </button>
            ))}
          </div>
          <div className="flex items-center space-x-2">
            <button className="p-4 bg-stone-100 dark:bg-stone-700 rounded-full hover:bg-stone-200 transition-colors"><Mic size={24} /></button>
            <input
              type="text"
              value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send(input)}
              placeholder={t('ai_placeholder')}
              className="flex-1 bg-stone-100 dark:bg-stone-700 p-4 rounded-full outline-none text-lg"
            />
            <button onClick={() => send(input)} disabled={loading} className="p-4 bg-green-600 text-white rounded-full hover:bg-green-700 transition-colors disabled:opacity-50"><Send size={24} /></button>
          </div>
       </div>
    </div>
  );
};

const SensorsView = () => {
  const { data, t } = useContext(AppContext);

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto animate-in fade-in">
       <h1 className="text-4xl font-extrabold mb-8 flex items-center"><Activity className="mr-4" size={40} /> {t('nav_sensors')}</h1>

       <div className="bg-stone-800 text-green-400 p-6 rounded-2xl font-mono text-sm md:text-base shadow-xl overflow-x-auto mb-8">
          <div className="flex justify-between items-center mb-4 pb-2 border-b border-stone-700">
             <span className="text-stone-300">/api/data → sensors (Live)</span>
             <span className="flex items-center"><RefreshCw size={14} className="mr-2 animate-spin" /> Polling: {POLL_MS / 1000}s</span>
          </div>
          <pre>{JSON.stringify(data.sensors, null, 2)}</pre>
       </div>

       <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white dark:bg-stone-800 p-6 rounded-3xl border border-stone-200 dark:border-stone-700">
             <div className="text-stone-500 mb-2 font-bold uppercase text-sm tracking-wider">{t('soil_raw')}</div>
             <div className="text-5xl font-black">{data.sensors.soil_raw ?? '--'}</div>
             <div className="mt-4 pt-4 border-t border-stone-100 dark:border-stone-700 text-sm text-stone-500 flex justify-between">
                <span>ADC Value</span>
                <span>≈ {fmt(data.sensors.soil_moisture_percent)}%</span>
             </div>
          </div>
          <div className="bg-white dark:bg-stone-800 p-6 rounded-3xl border border-stone-200 dark:border-stone-700">
             <div className="text-stone-500 mb-2 font-bold uppercase text-sm tracking-wider">Raw Temp</div>
             <div className="text-5xl font-black">{fmt(data.sensors.temperature, 2)}</div>
             <div className="mt-4 pt-4 border-t border-stone-100 dark:border-stone-700 text-sm text-stone-500">Celsius</div>
          </div>
          <div className="bg-white dark:bg-stone-800 p-6 rounded-3xl border border-stone-200 dark:border-stone-700">
             <div className="text-stone-500 mb-2 font-bold uppercase text-sm tracking-wider">Raw Humidity</div>
             <div className="text-5xl font-black">{fmt(data.sensors.humidity, 2)}</div>
             <div className="mt-4 pt-4 border-t border-stone-100 dark:border-stone-700 text-sm text-stone-500">Percentage</div>
          </div>
       </div>
    </div>
  );
};

const SettingsView = () => {
  const { lang, setLang, theme, setTheme, t } = useContext(AppContext);

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto animate-in fade-in">
       <h1 className="text-4xl font-extrabold mb-8 flex items-center"><Settings className="mr-4" size={40} /> {t('nav_settings')}</h1>

       <div className="space-y-6 bg-white dark:bg-stone-800 p-6 md:p-10 rounded-3xl shadow-sm border border-stone-100 dark:border-stone-700">

          <div>
            <h2 className="text-xl font-bold mb-4 flex items-center"><Languages className="mr-2"/> {t('lang')}</h2>
            <div className="grid grid-cols-2 gap-4">
               {['en', 'te', 'hi', 'ja'].map(l => (
                 <button
                  key={l}
                  onClick={() => setLang(l)}
                  className={`p-4 rounded-2xl font-bold text-lg transition-colors border-2 ${lang === l ? 'bg-green-50 border-green-500 text-green-700 dark:bg-green-900/30 dark:border-green-500 dark:text-green-300' : 'border-transparent bg-stone-100 dark:bg-stone-700 hover:bg-stone-200'}`}
                 >
                   {l === 'en' ? 'English' : l === 'te' ? 'తెలుగు' : l === 'hi' ? 'हिन्दी' : '日本語'}
                 </button>
               ))}
            </div>
          </div>

          <div className="pt-6 border-t border-stone-100 dark:border-stone-700">
            <h2 className="text-xl font-bold mb-4 flex items-center"><Moon className="mr-2"/> {t('theme')}</h2>
            <div className="flex space-x-4">
              <button onClick={() => setTheme('light')} className={`flex-1 p-4 rounded-2xl font-bold flex justify-center items-center ${theme === 'light' ? 'bg-stone-800 text-white' : 'bg-stone-100 text-stone-800'}`}>
                <SunMedium className="mr-2" /> {t('light')}
              </button>
              <button onClick={() => setTheme('dark')} className={`flex-1 p-4 rounded-2xl font-bold flex justify-center items-center ${theme === 'dark' ? 'bg-white text-stone-800' : 'bg-stone-700 text-white'}`}>
                <Moon className="mr-2" /> {t('dark')}
              </button>
            </div>
          </div>

       </div>
    </div>
  );
};

const Navigation = () => {
  const { view, setView, t } = useContext(AppContext);
  const items = [
    { id: 'home', icon: Home, label: t('nav_home') },
    { id: 'weather', icon: CloudRain, label: t('nav_weather') },
    { id: 'crop', icon: Sprout, label: t('nav_crop') },
    { id: 'market', icon: Store, label: t('nav_market') },
    { id: 'hire', icon: Users, label: t('nav_hire') },
    { id: 'sdg', icon: Leaf, label: t('nav_sdg') },
    { id: 'ai', icon: Bot, label: t('nav_ai') },
    { id: 'sensors', icon: Activity, label: t('nav_sensors') },
    { id: 'settings', icon: Settings, label: t('nav_settings') },
  ];

  return (
    <>
      {/* Desktop Sidebar */}
      <nav className="hidden md:flex flex-col w-64 h-screen fixed left-0 top-0 bg-white dark:bg-stone-900 border-r border-stone-200 dark:border-stone-800 p-6 z-50">
        <div className="flex items-center space-x-3 mb-10 text-green-600 dark:text-green-500">
          <Sprout size={32} />
          <span className="font-black text-xl tracking-tight leading-tight">Kisan<br/>Tomodachi</span>
        </div>
        <div className="space-y-2 flex-1 overflow-y-auto pr-1">
          {items.map(item => (
            <button
              key={item.id} onClick={() => setView(item.id)}
              className={`w-full flex items-center space-x-4 p-4 rounded-2xl font-bold text-lg transition-all ${view === item.id ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-400' : 'text-stone-500 hover:bg-stone-50 dark:hover:bg-stone-800'}`}
            >
              <item.icon size={24} /> <span>{item.label}</span>
            </button>
          ))}
        </div>
      </nav>

      {/* Mobile Bottom Bar (horizontally scrollable to fit every section) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-stone-900 border-t border-stone-200 dark:border-stone-800 p-2 pb-safe flex items-center overflow-x-auto z-50">
        {items.map(item => (
          <button
            key={item.id} onClick={() => setView(item.id)}
            className={`shrink-0 flex flex-col items-center p-2 rounded-xl transition-all mx-1 ${view === item.id ? 'text-green-600 dark:text-green-500' : 'text-stone-400'}`}
          >
            <div className={`${view === item.id ? 'bg-green-100 dark:bg-green-900/50' : ''} p-1.5 rounded-full mb-1`}>
              <item.icon size={24} />
            </div>
            <span className="text-[10px] font-bold truncate max-w-[60px]">{item.label}</span>
          </button>
        ))}
      </nav>
    </>
  );
};

const Header = () => {
  const { isConnected, isUpdating, t, data } = useContext(AppContext);

  // Time of the last sensor reading (falls back to server time)
  let timeStr = '--:--:--';
  if (data && data.timestamp) {
    const d = new Date(data.timestamp);
    timeStr = `${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
  }

  const sensorsOffline = isConnected && data && !data.online;

  let badgeClass = 'bg-green-100 text-green-700';
  let badgeContent = <><Wifi size={16} className="mr-2" /> {t('status_connected')}</>;
  if (!isConnected) {
    badgeClass = 'bg-red-100 text-red-700';
    badgeContent = <><WifiOff size={16} className="mr-2" /> {t('status_offline')}</>;
  } else if (sensorsOffline) {
    badgeClass = 'bg-amber-100 text-amber-700';
    badgeContent = <><WifiOff size={16} className="mr-2" /> {t('sensors_offline')}</>;
  } else if (isUpdating) {
    badgeClass = 'bg-blue-100 text-blue-700';
    badgeContent = <><RefreshCw size={16} className="mr-2 animate-spin" /> {t('status_updating')}</>;
  }

  return (
    <header className="sticky top-0 z-40 bg-white/80 dark:bg-stone-900/80 backdrop-blur-md border-b border-stone-200 dark:border-stone-800 p-4 md:px-8 flex justify-between items-center">
      <div className="md:hidden flex items-center text-green-600 font-black text-lg">
        <Sprout className="mr-2" size={24}/> Kisan
      </div>
      <div className="hidden md:block"></div> {/* Spacer for desktop */}

      <div className="flex items-center space-x-4">
        <div className="hidden md:flex flex-col items-end mr-4">
          <span className="text-xs text-stone-500 font-medium">{t('last_updated')}</span>
          <span className="text-sm font-bold font-mono">{timeStr}</span>
        </div>
        <div className={`flex items-center px-3 py-1.5 rounded-full text-sm font-bold transition-colors ${badgeClass} dark:bg-opacity-20`}>
          {badgeContent}
        </div>
      </div>
    </header>
  );
};

const AppContent = () => {
  const { view, data } = useContext(AppContext);
  const needsData = ['home', 'weather', 'crop', 'sensors'].includes(view);

  return (
    <div className="flex h-screen overflow-hidden">
      <Navigation />
      <div className="flex-1 flex flex-col md:ml-64 relative pb-20 md:pb-0 overflow-y-auto">
        <Header />
        <main className="flex-1 relative">
          {needsData && !data && <ConnectingView />}
          {view === 'home' && data && <HomeView />}
          {view === 'weather' && data && <WeatherView />}
          {view === 'crop' && data && <CropSoilView />}
          {view === 'market' && <MarketplaceView />}
          {view === 'hire' && <HireView />}
          {view === 'sdg' && <SDGView />}
          {view === 'ai' && <AssistantView />}
          {view === 'sensors' && data && <SensorsView />}
          {view === 'settings' && <SettingsView />}
        </main>
      </div>
    </div>
  );
};

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}