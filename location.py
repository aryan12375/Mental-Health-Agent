"""
location.py — IP-API geolocation
Maps user's region to the correct mental health resources.
Free tier: 45 req/min, no API key needed.
"""

import httpx
from typing import Optional

# ─── Resource database by Indian state ────────────────────────────────────────
RESOURCES_BY_STATE = {
    "karnataka": {
        "primary":  {"name": "NIMHANS Helpline",       "number": "080-46110007",   "available": "24/7",              "type": "Hospital"},
        "national": {"name": "Tele-MANAS",              "number": "14416",          "available": "24/7",              "type": "National"},
        "local":    {"name": "Vandrevala Foundation",   "number": "1860-2662-345",  "available": "24/7",              "type": "Counselling"},
    },
    "maharashtra": {
        "primary":  {"name": "iCall (TISS Mumbai)",     "number": "9152987821",     "available": "Mon–Sat 8am–10pm",  "type": "Counselling"},
        "national": {"name": "Tele-MANAS",              "number": "14416",          "available": "24/7",              "type": "National"},
        "local":    {"name": "Vandrevala Foundation",   "number": "1860-2662-345",  "available": "24/7",              "type": "Counselling"},
    },
    "tamil nadu": {
        "primary":  {"name": "SNEHI Tamil Nadu",        "number": "044-24640050",   "available": "24/7",              "type": "Crisis Line"},
        "national": {"name": "Tele-MANAS",              "number": "14416",          "available": "24/7",              "type": "National"},
        "local":    {"name": "Vandrevala Foundation",   "number": "1860-2662-345",  "available": "24/7",              "type": "Counselling"},
    },
    "delhi": {
        "primary":  {"name": "NIMHANS Delhi",           "number": "011-40769099",   "available": "24/7",              "type": "Hospital"},
        "national": {"name": "Tele-MANAS",              "number": "14416",          "available": "24/7",              "type": "National"},
        "local":    {"name": "iCall (TISS)",             "number": "9152987821",     "available": "Mon–Sat 8am–10pm",  "type": "Counselling"},
    },
    "west bengal": {
        "primary":  {"name": "SNEHI Kolkata",           "number": "033-24637401",   "available": "24/7",              "type": "Crisis Line"},
        "national": {"name": "Tele-MANAS",              "number": "14416",          "available": "24/7",              "type": "National"},
        "local":    {"name": "Vandrevala Foundation",   "number": "1860-2662-345",  "available": "24/7",              "type": "Counselling"},
    },
}

# Default for unrecognized states
DEFAULT_RESOURCES = {
    "primary":  {"name": "iCall (TISS)",           "number": "9152987821",    "available": "Mon–Sat 8am–10pm",  "type": "Counselling"},
    "national": {"name": "Tele-MANAS",             "number": "14416",         "available": "24/7",              "type": "National"},
    "local":    {"name": "Vandrevala Foundation",  "number": "1860-2662-345", "available": "24/7",              "type": "Counselling"},
}


async def get_location(ip: str) -> dict:
    """
    Calls ip-api.com to resolve IP → state/city.
    Falls back gracefully if the call fails.
    """
    # Skip for localhost/private IPs
    if ip in ("127.0.0.1", "localhost", "::1") or ip.startswith("192.168") or ip.startswith("10."):
        return {"state": "Karnataka", "city": "Bengaluru", "country": "IN"}

    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            res = await client.get(f"http://ip-api.com/json/{ip}?fields=status,regionName,city,countryCode")
            data = res.json()
            if data.get("status") == "success":
                return {
                    "state": data.get("regionName", "Unknown"),
                    "city": data.get("city", "Unknown"),
                    "country": data.get("countryCode", "IN"),
                }
    except Exception as e:
        print(f"[Location] IP lookup failed: {e}")

    return {"state": "Unknown", "city": "Unknown", "country": "IN"}


def get_resources_for_state(state: str) -> dict:
    key = state.lower().strip()
    return RESOURCES_BY_STATE.get(key, DEFAULT_RESOURCES)
