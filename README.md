# Companion AI: Safety-First Mental Health Support

Companion is a full-stack AI conversational agent designed with a "Safety-First" architecture. Unlike standard LLM wrappers, this system utilizes a custom **Gatekeeper Logic** to monitor user distress in real-time and trigger hardcoded safety interventions.

## 🛡️ Core Safety Features
* **Real-Time Risk Scoring:** Every user input is passed through a dedicated Gatekeeper that assigns a risk score (0.0 - 1.0) before the LLM even sees it.
* **Passive Digital Phenotyping:** Monitors typing cadence (WPM) and backspace ratios to detect hesitation or distress signals *before* the message is sent.
* **Hard Crisis Overrides:** If a high-risk score is detected, the LLM connection is severed, and a localized Crisis Panel (NIMHANS/Tele-MANAS) is injected into the UI.
* **Semantic Drift Tracking:** Analyzes emotional shifts over a 7-day rolling window to detect declining wellbeing trends.
* **Emergency Contact Integration:** Includes an automated "nudge" protocol via Twilio to alert a trusted contact during severe distress.

## 🛠️ Tech Stack
- **Frontend:** React.js, Vite, Tailwind-style CSS (Glassmorphism UI)
- **Backend:** Python, FastAPI, SQLite (Privacy-first anonymous storage)
- **AI Brain:** Llama-3 (via Groq Cloud API) for low-latency, empathetic responses.
- **Safety Logic:** Custom heuristic-based Gatekeeper with longitudinal scoring.

## 🚀 Getting Started
1. **Clone the repo**
2. **Backend Setup:**
   - Create a `venv` and run `pip install -r requirements.txt`
   - Add your `GROQ_API_KEY` to the `.env` file.
   - Run `python -m uvicorn main:app --reload --port 8000`
3. **Frontend Setup:**
   - `cd companion-app`
   - `npm install`
   - `npm run dev`

---
*Disclaimer: This is a portfolio project and not a substitute for professional clinical care.*