# ChainSight — Supply Chain Data Analytics System

A web + mobile platform for tracking Rwanda's agricultural supply chain end-to-end — from
cooperative dispatch through transport, distribution, and market sale — with QR-code batch
traceability, IoT cold-chain monitoring, rule-based loss risk scoring, and an AI Insights
Engine that generates a national intelligence brief automatically every night.

Final Year Project, Adventist University of Central Africa (AUCA), Faculty of Information
Technology, Department of Software Engineering. Case study: Ministry of Agriculture and
Animal Resources (MINAGRI).

## Repo layout

```
agrichain/
├── backend/        Django REST Framework API (Python 3.12)
├── frontend/        React + Vite web dashboard (8 role-based interfaces)
├── mobile/          React Native + Expo app (Transporter and Market Agent roles)
├── iot-firmware/     ESP32/ESP8266 + DHT22 sensor firmware (Arduino)
└── diagrams/         UML and architecture diagrams
```

## Prerequisites

- Python 3.12
- Node.js 18+
- Docker (for Postgres + Redis) — or your own local instances
- A free [Mapbox](https://account.mapbox.com/access-tokens/) public token (for live map views)

## Quick start

### 1. Start the database and cache

```bash
docker-compose up -d
```

This starts Postgres (`chainsight_db`) and Redis, matching the defaults already in
`backend/.env.example`.

### 2. Backend

```bash
cd agrichain/backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env            # fill in real values — .env is gitignored, never commit it
python manage.py migrate
python manage.py runserver
```

The API runs at `http://localhost:8000/api/v1`.

### 3. Seed demo data

```bash
python manage.py seed_demo_data
```

This is **deterministic** (`random.seed(42)`) — everyone who runs it gets the same 4
cooperatives, 2 transport companies + drivers, 2 distributors, 3 market agents, 1 MINAGRI
officer, 1 admin, and 48 batches of 6 months of realistic history. Every seeded account
uses the same password: **`Demo1234!`** (e.g. `admin@chainsight.demo`).

If the database already has demo data and you want to start over:

```bash
python manage.py seed_demo_data --reset
```

Before presenting/demoing the app, run this to put pending requests back to pending and
restore sample active trips (with GPS/temperature telemetry and an open incident) so Fleet
Monitoring and similar live-data pages aren't empty:

```bash
python manage.py reset_demo_state
```

### 4. Frontend

```bash
cd agrichain/frontend
npm install
cp .env.example .env
# edit .env — set VITE_MAPBOX_TOKEN to your own Mapbox public token
npm run dev
```

Runs at `http://localhost:5173`. Log in with any seeded demo account and `Demo1234!`.

### 5. Mobile (Transporter and Market Agent roles only)

```bash
cd agrichain/mobile
npm install
npm start
```

Opens Expo's dev tools — scan the QR code with Expo Go on a phone, or press `a`/`i` for an
Android/iOS emulator. The API base URL is auto-detected from the same host Expo is served
from; set `EXPO_PUBLIC_API_URL` in `mobile/.env` to override it (e.g. for a tunnel URL when
testing on a phone off your LAN).

### 6. Background jobs (optional)

Nightly KPI aggregation and the MINAGRI "Daily Intelligence Brief" run as scheduled Celery
tasks. Not required to explore the app — `seed_demo_data` already seeds representative
data — but to run them live:

```bash
celery -A config worker -l info
celery -A config beat -l info
```

## IoT firmware

`iot-firmware/` contains the Arduino sketches for the cold-chain sensors (ESP32/ESP8266 +
DHT22), which post temperature/humidity readings directly to the backend's REST API. See
the comments at the top of each `.ino` file for the WiFi and API endpoint configuration to
change before flashing a device.

## Team

Ingabire Esther · Tsenge Siviholya Anastasie · Mugisha Julien · Bahizi Rugema Arsene ·
Ntuyenabo Uwayezu

Supervisor: Mr. Ishimwe Prince
