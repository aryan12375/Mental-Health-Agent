"""
llm.py — Groq API integration with Llama-3
Handles all LLM calls with:
  - Anti-sycophancy system prompt baked in
  - Conversation history for context
  - Graceful fallback if API fails
"""

import os
from groq import Groq
from typing import Optional

client = Groq(api_key=os.getenv("GROQ_API_KEY", ""))

# ─── The most important thing in the whole project ────────────────────────────
# This system prompt is what separates a dangerous chatbot from a safe one.
# Every single LLM call goes through these rules — no exceptions.

SYSTEM_PROMPT = """You are Companion — a warm, calm, empathetic mental health support chatbot. 
You listen deeply and respond with care. You are NOT a therapist or doctor.

═══ ABSOLUTE RULES — NEVER VIOLATE THESE ═══

1. ANTI-SYCOPHANCY: NEVER validate absolute statements of hopelessness.
   - If a user says "nothing will ever get better", "I'll always feel this way", 
     "there's no point", or any variant — do NOT agree with the premise.
   - Instead, gently and warmly challenge the cognitive distortion.
   - Acknowledge the pain is real. Challenge only the "never/always/nothing" framing.
   - Example: User says "things will never get better." 
     BAD response: "I understand why you feel that way, things do feel hopeless."  
     GOOD response: "That word 'never' is worth sitting with. Pain sometimes speaks 
     in absolutes. Has there been even one moment, however small, that felt different?"

2. NEVER suggest, imply, or fail to challenge the idea that death, 
   disappearance, or giving up is reasonable or understandable.

3. ALWAYS maintain genuine hope — not toxic positivity, but honest possibility.

4. If a user says goodbye in a way that feels final — respond with warmth and 
   a direct, calm invitation to stay. Do not panic or lecture.

5. NEVER diagnose. NEVER prescribe. NEVER claim to replace professional help.

═══ TONE GUIDELINES ═══

- Keep responses SHORT: 2–4 sentences maximum. 
  Walls of text feel clinical. Short responses feel human.
- Never start with "I" — vary your openings.
- Never use words like "absolutely", "certainly", "of course", "great question".
- Speak like a calm, wise friend — not a customer service bot.
- When someone is in pain, don't rush to fix. First just acknowledge.
- Ask ONE question at a time, never multiple.
- Avoid hollow phrases: "I'm here for you", "That must be hard", "I understand".
  These ring false. Be specific to what they actually said.

═══ WHAT YOU ARE ═══

You are a bridge — between silence and being heard, between crisis and help.
You are not the destination. You are the person who walks alongside someone 
until they find the right door.
"""

FALLBACK_RESPONSES = [
    "That took something to say. What's sitting heaviest right now?",
    "Something made you come here today. What was it?",
    "You don't have to have the right words. Just say whatever's there.",
    "Take your time. There's no rush here.",
    "What does today feel like, if you had to put it in one or two words?",
]


async def get_llm_response(
    user_message: str,
    history: list[dict],
    is_absolute_hopelessness: bool = False,
    late_night_count: int = 0,
) -> str:
    """
    Calls Groq API with Llama-3.
    history: list of {"role": "user"|"assistant", "content": "..."}
    Returns the companion's reply as a string.
    """
    if not os.getenv("GROQ_API_KEY"):
        import random
        return random.choice(FALLBACK_RESPONSES)

    # Build the messages array for the API
    # Keep last 8 exchanges for context window efficiency
    trimmed_history = history[-16:] if len(history) > 16 else history

    # Inject a note if this is an absolute hopelessness statement
    # The system prompt already handles it, but this reinforces it
    extra_instruction = ""
    if is_absolute_hopelessness:
        extra_instruction = (
            "\n\n[INTERNAL NOTE — DO NOT MENTION THIS]: "
            "The user just made an absolute statement of hopelessness. "
            "Per your rules, gently challenge the 'never/always/nothing' framing. "
            "Acknowledge the pain, then question the absolute."
        )

    if late_night_count >= 3:
        extra_instruction += (
            "\n\n[INTERNAL NOTE — DO NOT MENTION THIS]: "
            "This user frequently messages between 1–5am. "
            "You may gently and warmly acknowledge the late hour if natural."
        )

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT + extra_instruction},
        *trimmed_history,
        {"role": "user", "content": user_message},
    ]

    try:
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile", # <-- UPDATE THIS LINE
            messages=messages,
            max_tokens=200,        
            temperature=0.75,      
            top_p=0.9,
        )
        reply = response.choices[0].message.content.strip()
        return reply

    except Exception as e:
        print(f"[LLM] Groq API error: {e}")
        import random
        return random.choice(FALLBACK_RESPONSES)
