"""
database.py — Async SQLite via SQLAlchemy
Tables:
  - daily_scores   : per-user daily average risk scores (7-day trend)
  - safety_contacts: optional trusted contact per user
  - session_log    : hour-of-day log for 3am pattern detection
"""

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy import String, Float, Integer, DateTime, select, func
from datetime import datetime, date, timedelta
from typing import Optional
import os

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./companion.db")

engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class DailyScore(Base):
    __tablename__ = "daily_scores"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String, index=True)
    date_str: Mapped[str] = mapped_column(String)          # "2024-06-01"
    day_label: Mapped[str] = mapped_column(String)         # "Mon"
    total_score: Mapped[float] = mapped_column(Float, default=0.0)
    message_count: Mapped[int] = mapped_column(Integer, default=0)
    avg_score: Mapped[float] = mapped_column(Float, default=0.0)


class SafetyContact(Base):
    __tablename__ = "safety_contacts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String, unique=True, index=True)
    contact_name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    contact_phone: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    last_pinged_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class SessionLog(Base):
    __tablename__ = "session_log"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String, index=True)
    hour: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


# ─── DB Helper Functions ───────────────────────────────────────────────────────

async def upsert_daily_score(session: AsyncSession, user_id: str, new_score: float):
    today = date.today()
    date_str = today.isoformat()
    day_label = today.strftime("%a")

    result = await session.execute(
        select(DailyScore).where(
            DailyScore.user_id == user_id,
            DailyScore.date_str == date_str
        )
    )
    row = result.scalar_one_or_none()

    if row:
        row.total_score += new_score
        row.message_count += 1
        row.avg_score = row.total_score / row.message_count
    else:
        row = DailyScore(
            user_id=user_id, date_str=date_str, day_label=day_label,
            total_score=new_score, message_count=1, avg_score=new_score
        )
        session.add(row)

    await session.commit()
    return row.avg_score


async def get_trend_data(session: AsyncSession, user_id: str):
    cutoff = (date.today() - timedelta(days=7)).isoformat()
    result = await session.execute(
        select(DailyScore)
        .where(DailyScore.user_id == user_id, DailyScore.date_str >= cutoff)
        .order_by(DailyScore.date_str)
    )
    rows = result.scalars().all()
    return [{"day": r.day_label, "avg": round(r.avg_score, 3)} for r in rows]


async def check_trend_rising(session: AsyncSession, user_id: str) -> dict:
    data = await get_trend_data(session, user_id)
    if len(data) < 3:
        return {"trending": False, "data": data}
    last3 = data[-3:]
    rising = last3[0]["avg"] < last3[1]["avg"] < last3[2]["avg"]
    total_rise = last3[2]["avg"] - last3[0]["avg"]
    return {
        "trending": rising and total_rise > 0.15,
        "rise": round(total_rise * 100),
        "data": data
    }


async def save_safety_contact(session: AsyncSession, user_id: str, name: str, phone: str):
    result = await session.execute(
        select(SafetyContact).where(SafetyContact.user_id == user_id)
    )
    existing = result.scalar_one_or_none()
    if existing:
        existing.contact_name = name
        existing.contact_phone = phone
    else:
        session.add(SafetyContact(user_id=user_id, contact_name=name, contact_phone=phone))
    await session.commit()


async def get_safety_contact(session: AsyncSession, user_id: str) -> Optional[SafetyContact]:
    result = await session.execute(
        select(SafetyContact).where(SafetyContact.user_id == user_id)
    )
    return result.scalar_one_or_none()


async def log_session_hour(session: AsyncSession, user_id: str, hour: int):
    session.add(SessionLog(user_id=user_id, hour=hour))
    await session.commit()


async def get_late_night_count(session: AsyncSession, user_id: str) -> int:
    result = await session.execute(
        select(func.count(SessionLog.id)).where(
            SessionLog.user_id == user_id,
            SessionLog.hour >= 1,
            SessionLog.hour <= 5
        )
    )
    return result.scalar() or 0
