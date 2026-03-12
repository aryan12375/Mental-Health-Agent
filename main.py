"""
main.py — Companion Backend
FastAPI server exposing all endpoints the React frontend needs.

Run with:
    uvicorn main:app --reload --port 8000

Endpoints:
    POST /gatekeeper          — risk score for a message
    POST /chat                — LLM response
    POST /session/score       — log daily risk score
    GET  /session/trend       — 7-day trend data
    POST /contact/save        — save safety contact
    POST /contact/ping        — trigger SMS to safety contact
    GET  /location            — resolve IP to state/resources
    GET  /health              — health check
"""

import os
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, Request, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

from database import (
    init_db, AsyncSessionLocal,
    upsert_daily_score, get_trend_data, check_trend_rising,
    save_safety_contact, get_safety_contact,
    log_session_hour, get_late_night_count,
)
from gatekeeper import compute_risk_score, detect_absolute_hopelessness, detect_solo_goodbye
from llm import get_llm_response
from location import get_location, get_resources_for_state
from sms import ping_safety_contact


# ─── App lifecycle ─────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    print("✓ Database initialised")
    print(f"✓ Gatekeeper mode: {os.getenv('GATEKEEPER_MODE', 'keyword')}")
    print(f"✓ Groq API: {'configured' if os.getenv('GROQ_API_KEY') else 'NOT SET — using fallback responses'}")
    print(f"✓ Twilio: {'configured' if os.getenv('TWILIO_ACCOUNT_SID') else 'NOT SET — SMS will log only'}")
    yield

app = FastAPI(title="Companion API", version="1.0.0", lifespan=lifespan)

# ─── CORS — allow the React frontend ──────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        os.getenv("FRONTEND_URL", "http://localhost:3000"),
        "http://localhost:5173",   # Vite default
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── DB dependency ─────────────────────────────────────────────────────────────
async def get_db():
    async with AsyncSessionLocal() as session:
        yield session


# ─── Request/Response models ───────────────────────────────────────────────────
class GatekeeperRequest(BaseModel):
    text: str
    user_id: str
    behavior_bonus: float = 0.0   # from frontend phenotyping
    drift_delta: float = 0.0      # from frontend semantic drift


class GatekeeperResponse(BaseModel):
    risk_score: float
    label: str                    # "safe" | "moderate" | "high_anxiety" | "crisis"
    is_absolute_hopelessness: bool
    is_solo_goodbye: bool
    mode: str


class ChatMessage(BaseModel):
    role: str    # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    text: str
    user_id: str
    history: list[ChatMessage] = []
    is_absolute_hopelessness: bool = False


class ChatResponse(BaseModel):
    reply: str


class ScoreRequest(BaseModel):
    user_id: str
    score: float


class ContactSaveRequest(BaseModel):
    user_id: str
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None


class ContactPingRequest(BaseModel):
    user_id: str


# ─── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "time": datetime.utcnow().isoformat()}


@app.post("/gatekeeper", response_model=GatekeeperResponse)
async def gatekeeper(
    body: GatekeeperRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Evaluates the risk level of a user message.
    Called BEFORE every LLM request — the gatekeeper never sleeps.
    """
    result = compute_risk_score(
        text=body.text,
        behavior_bonus=body.behavior_bonus,
        drift_delta=body.drift_delta,
    )

    # Log the session hour for 3am pattern detection
    await log_session_hour(db, body.user_id, datetime.now().hour)

    return GatekeeperResponse(
        risk_score=result["risk_score"],
        label=result["label"],
        is_absolute_hopelessness=detect_absolute_hopelessness(body.text),
        is_solo_goodbye=detect_solo_goodbye(body.text),
        mode=result["mode"],
    )


@app.post("/chat", response_model=ChatResponse)
async def chat(
    body: ChatRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Returns a Llama-3 response via Groq.
    Only called when risk_score < 0.85 (crisis bypasses this entirely).
    """
    late_night_count = await get_late_night_count(db, body.user_id)

    history = [{"role": m.role, "content": m.content} for m in body.history]

    reply = await get_llm_response(
        user_message=body.text,
        history=history,
        is_absolute_hopelessness=body.is_absolute_hopelessness,
        late_night_count=late_night_count,
    )

    return ChatResponse(reply=reply)


@app.post("/session/score")
async def log_score(
    body: ScoreRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Logs a risk score for the user's daily average.
    Called after every gatekeeper evaluation.
    """
    today_avg = await upsert_daily_score(db, body.user_id, body.score)
    return {"today_avg": today_avg}


@app.get("/session/trend")
async def get_trend(
    user_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Returns 7-day daily average risk scores + trend analysis.
    Frontend uses this to populate the TrendPanel chart.
    """
    trend = await check_trend_rising(db, user_id)
    return trend


@app.post("/contact/save")
async def save_contact(
    body: ContactSaveRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Saves or updates the user's trusted safety contact.
    Called from the InlineSafetyContact component in the frontend.
    """
    await save_safety_contact(db, body.user_id, body.contact_name or "", body.contact_phone or "")
    return {"saved": True}


@app.post("/contact/ping")
async def contact_ping(
    body: ContactPingRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Sends a gentle SMS to the user's safety contact.
    Only fires on crisis (risk_score >= 0.85), respects 24hr cooldown.
    """
    contact = await get_safety_contact(db, body.user_id)
    if not contact or not contact.contact_phone:
        return {"sent": False, "reason": "no_contact_saved"}

    result = await ping_safety_contact(
        user_id=body.user_id,
        contact_name=contact.contact_name,
        contact_phone=contact.contact_phone,
    )
    return result


@app.get("/location")
async def location(request: Request):
    """
    Resolves the user's IP to a state and returns the correct
    crisis resources for that region.
    """
    # Get real IP, respecting proxies
    forwarded = request.headers.get("X-Forwarded-For")
    ip = forwarded.split(",")[0].strip() if forwarded else request.client.host

    loc = await get_location(ip)
    resources = get_resources_for_state(loc["state"])

    return {
        "state": loc["state"],
        "city": loc["city"],
        "resources": resources,
    }


@app.get("/session/late-night")
async def late_night_count(
    user_id: str,
    db: AsyncSession = Depends(get_db),
):
    count = await get_late_night_count(db, user_id)
    return {"count": count}
