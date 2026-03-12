"""
gatekeeper.py — Risk classifier
Two modes controlled by GATEKEEPER_MODE env var:
  "keyword"    — fast, no GPU, good for dev/demo (~85% accuracy)
  "distilbert" — transformer-based, much more accurate for production

To switch to distilbert mode:
  1. Set GATEKEEPER_MODE=distilbert in .env
  2. The model auto-downloads from HuggingFace on first run (~250MB)
  3. For best results, fine-tune on the Suicidal Ideation Reddit Dataset:
     https://huggingface.co/datasets/vibhorag101/suicide-watch
"""

import os
import re
import math
from datetime import datetime
from typing import Optional

MODE = os.getenv("GATEKEEPER_MODE", "keyword")

# ─── Lazy-load transformer only if needed ─────────────────────────────────────
_tokenizer = None
_model = None

def _load_model():
    global _tokenizer, _model
    if _tokenizer is None:
        from transformers import AutoTokenizer, AutoModelForSequenceClassification
        import torch
        # Using a zero-shot mental health classifier
        # For production: fine-tune on suicide-watch dataset and replace model name
        MODEL_NAME = "raynardj/xtreme-distil-l6-h256-uncased"
        _tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
        _model = AutoModelForSequenceClassification.from_pretrained(MODEL_NAME)
        _model.eval()
    return _tokenizer, _model


# ─── Keyword lists ─────────────────────────────────────────────────────────────
CRISIS_KW = [
    "kill myself", "want to die", "end my life", "suicide", "suicidal",
    "no reason to live", "can't go on", "better off dead", "hurt myself",
    "self harm", "cutting myself", "overdose", "don't want to exist",
    "disappear forever", "ending it", "nothing to live for",
    "not worth living", "final goodbye", "last message", "won't be here",
    "end it all", "take my life", "rather be dead", "planning to die",
]

MODERATE_KW = [
    "hopeless", "empty", "numb", "exhausted", "alone", "nobody cares",
    "can't do this", "falling apart", "breaking down", "lost", "pointless",
    "give up", "no hope", "so tired", "disappear", "invisible", "burden",
    "no one would miss", "what's the point", "hollow", "worthless",
    "broken", "dark thoughts", "can't cope",
]

FAREWELL_CRISIS = [
    "goodbye forever", "goodbye everyone", "this is goodbye",
    "final goodbye", "last time talking", "won't need this anymore",
    "farewell", "bye forever",
]


def _time_bonus() -> float:
    h = datetime.now().hour
    if 1 <= h <= 5:
        return 0.18
    if h >= 22:
        return 0.08
    return 0.0


def _keyword_score(text: str, behavior_bonus: float = 0.0, drift_delta: float = 0.0) -> float:
    lower = text.lower()

    # Hard crisis keywords → immediate high score
    for kw in CRISIS_KW:
        if kw in lower:
            return min(0.93 + 0.06 * (CRISIS_KW.index(kw) / len(CRISIS_KW)), 0.99)

    # Farewell crisis patterns
    for kw in FAREWELL_CRISIS:
        if kw in lower:
            return 0.91

    # Moderate accumulation
    score = 0.0
    for kw in MODERATE_KW:
        if kw in lower:
            score += 0.17

    score += _time_bonus()
    score += behavior_bonus * 0.5
    score += max(0, drift_delta) * 0.4

    return min(score, 0.84)


def _distilbert_score(text: str, behavior_bonus: float = 0.0, drift_delta: float = 0.0) -> float:
    import torch
    tokenizer, model = _load_model()
    inputs = tokenizer(text, return_tensors="pt", truncation=True, max_length=256)
    with torch.no_grad():
        logits = model(**inputs).logits
        probs = torch.softmax(logits, dim=-1)
        # Assume label 1 = crisis/positive class
        base_score = probs[0][1].item() if probs.shape[1] > 1 else probs[0][0].item()

    base_score += _time_bonus()
    base_score += behavior_bonus * 0.3
    base_score += max(0, drift_delta) * 0.25
    return min(base_score, 0.99)


def compute_risk_score(
    text: str,
    behavior_bonus: float = 0.0,
    drift_delta: float = 0.0
) -> dict:
    """
    Returns:
      { risk_score: float, label: str, mode: str }
    Labels: "safe" | "moderate" | "high_anxiety" | "crisis"
    """
    if MODE == "distilbert":
        try:
            score = _distilbert_score(text, behavior_bonus, drift_delta)
        except Exception as e:
            print(f"[Gatekeeper] DistilBERT failed, falling back to keyword: {e}")
            score = _keyword_score(text, behavior_bonus, drift_delta)
    else:
        score = _keyword_score(text, behavior_bonus, drift_delta)

    if score >= 0.85:
        label = "crisis"
    elif score >= 0.75:
        label = "high_anxiety"
    elif score >= 0.65:
        label = "moderate"
    else:
        label = "safe"

    return {
        "risk_score": round(score, 4),
        "label": label,
        "mode": MODE,
    }


def detect_absolute_hopelessness(text: str) -> bool:
    ABSOLUTE = [
        "nothing will ever get better", "it will never get better",
        "things will never change", "there's no point", "nothing matters",
        "i'll always feel this way", "nothing ever works", "i'll never be happy",
        "it's hopeless", "completely hopeless", "no way out", "nothing can help",
        "nobody can help", "i'm beyond help", "too late for me",
        "never going to get better", "always be like this",
    ]
    lower = text.lower()
    return any(phrase in lower for phrase in ABSOLUTE)


def detect_solo_goodbye(text: str) -> bool:
    patterns = [
        r"^goodbye\s*[.!]?\s*$",
        r"^bye\s*[.!]?\s*$",
        r"\bgoodbye\s*[.!]?\s*$",
        r"\bfarewell\s*$",
        r"\bbye\s+forever\s*$",
        r"\btake\s+care\s+everyone\s*$",
    ]
    trimmed = text.strip()
    return any(re.search(p, trimmed, re.IGNORECASE) for p in patterns)
