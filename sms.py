"""
sms.py — Twilio safety contact SMS
Sends a neutral, non-alarming nudge to the user's trusted contact.
Never mentions the app, the crisis, or any details.
Respects a 24-hour cooldown so contacts aren't spammed.
"""

import os
from datetime import datetime, timedelta
from typing import Optional

TWILIO_SID   = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_FROM  = os.getenv("TWILIO_PHONE_NUMBER", "")

# Cooldown: don't ping the same contact more than once every 24 hours
_ping_cache: dict[str, datetime] = {}


def _is_on_cooldown(user_id: str) -> bool:
    last = _ping_cache.get(user_id)
    if last and datetime.utcnow() - last < timedelta(hours=24):
        return True
    return False


async def ping_safety_contact(
    user_id: str,
    contact_name: Optional[str],
    contact_phone: str,
) -> dict:
    """
    Sends a gentle, vague SMS to the safety contact.
    Returns {"sent": bool, "reason": str}
    """
    if not contact_phone:
        return {"sent": False, "reason": "no_phone"}

    if _is_on_cooldown(user_id):
        return {"sent": False, "reason": "cooldown"}

    if not all([TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM]):
        # Twilio not configured — log for dev visibility
        name_str = contact_name or "someone"
        print(f"[SMS] Would ping {name_str} at {contact_phone}: "
              f"'Hey — someone who cares about you might appreciate a gentle check-in today.'")
        _ping_cache[user_id] = datetime.utcnow()
        return {"sent": False, "reason": "twilio_not_configured"}

    try:
        from twilio.rest import Client
        client = Client(TWILIO_SID, TWILIO_TOKEN)

        # The message is deliberately vague — no details, no diagnosis, no alarm
        body = (
            "Hey — someone who cares about you might appreciate "
            "a gentle check-in today. No need to mention this message."
        )

        client.messages.create(to=contact_phone, from_=TWILIO_FROM, body=body)
        _ping_cache[user_id] = datetime.utcnow()
        return {"sent": True, "reason": "ok"}

    except Exception as e:
        print(f"[SMS] Twilio error: {e}")
        return {"sent": False, "reason": str(e)}
