#include <DHT.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

#define SOIL_PIN A0
#define DHT_PIN 2
#define DHT_TYPE DHT11

DHT dht(DHT_PIN, DHT_TYPE);
LiquidCrystal_I2C lcd(0x27, 16, 2);

void setup() {
  Serial.begin(115200);
  dht.begin();

  lcd.init();
  lcd.backlight();
  lcd.clear();
}

void loop() {
  int soil = analogRead(SOIL_PIN);
  float temperature = dht.readTemperature();
  float humidity = dht.readHumidity();

  // ---------- Serial output ----------
  Serial.print("SOIL=");
  Serial.print(soil);

  Serial.print(",TEMP=");
  Serial.print(temperature);

  Serial.print(",HUM=");
  Serial.println(humidity);

  // ---------- LCD ----------
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Soil: ");
  lcd.print(soil);

  lcd.setCursor(0, 1);
  lcd.print("Temp:");
  lcd.print(temperature, 1);
  lcd.print((char)223);
  lcd.print("C ");

  delay(2000);

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Humidity:");

  lcd.setCursor(0, 1);
  lcd.print(humidity, 1);
  lcd.print("%");

  delay(2000);
}