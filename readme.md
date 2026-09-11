# ⛳ Virtual Golf Caddie PWA

A lightweight, hands-free, voice-activated Progressive Web App (PWA) designed to give real-time golf club recommendations based on GPS distance, live elevation changes, and real-time wind speed and vector direction.

---

## 📌 Features

* 📍 **Real-Time GPS Tracking:** Uses high-accuracy device geolocation to calculate exact yardage to the target pin.
* 🏔 **Elevation Adjustment:** Fetches elevation data for both your location and the green using the **Open-Elevation API** to compute "plays-like" yardage for uphill and downhill shots.
* 💨 **Wind Vector Calculation:** Connects to the **Open-Meteo API** to get real-time wind speeds and directions, converting them into headwind and tailwind distance adjustments relative to your shooting trajectory.
* 🎙 **Hands-Free Voice Assistant:** Uses the **Web Speech API** to continuously listen for keywords like `"caddie"`, `"club"`, or `"distance"` and verbally responds through your device's speaker or Bluetooth earpiece.
* 🎨 **Clean, High-Contrast UI:** Designed specifically for outdoors and sunlight readability on mobile devices and smartwatches.

---

## 📁 Project Structure

```text
virtual-golf-caddie/
├── index.html   # Application DOM layout and component structure
├── styles.css   # Dark-mode styled UI optimized for high contrast
└── script.js    # Core app logic: GPS, APIs, Wind Math, Speech Engine
