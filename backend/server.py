"""
SPIKE - Local On-Demand Services Marketplace
Backend API - production-ready MVP.

MOCKED PROVIDERS: identity verification, payment processing, push notifications,
and maps use clean abstractions with mock implementations. Swap by env var.
"""
from fastapi import FastAPI, APIRouter, Depends, HTTPException, Header, UploadFile, File, Form
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import math
import logging
import base64
import uuid
import hashlib
import secrets
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Dict, Any, Literal
from datetime import datetime, timezone, timedelta
import bcrypt
import jwt
import httpx
import requests as pyrequests
from fastapi.concurrency import run_in_threadpool
try:
    import stripe as stripe_sdk
except Exception:
    stripe_sdk = None

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# ------------------------------------------------------------------
# Config (business rules - configurable, never hard-coded in logic)
# ------------------------------------------------------------------
CONFIG = {
    "INITIAL_RADIUS_MILES": float(os.getenv("INITIAL_RADIUS_MILES", "30")),
    "EXPANDED_RADIUS_MILES": float(os.getenv("EXPANDED_RADIUS_MILES", "60")),
    "MATCHING_TIMEOUT_SECONDS": int(os.getenv("MATCHING_TIMEOUT_SECONDS", "900")),  # 15 min
    "ADDRESS_RELEASE_HOURS": int(os.getenv("ADDRESS_RELEASE_HOURS", "24")),
    "ARRIVAL_RADIUS_FEET": int(os.getenv("ARRIVAL_RADIUS_FEET", "300")),
    "PLATFORM_COMMISSION_PERCENT": float(os.getenv("PLATFORM_COMMISSION_PERCENT", "10")),
    "DISPUTE_WINDOW_HOURS": int(os.getenv("DISPUTE_WINDOW_HOURS", "48")),
    "JWT_SECRET": os.getenv("JWT_SECRET", "spike-dev-secret-change-in-prod"),
    "JWT_ALG": "HS256",
    "JWT_TTL_DAYS": 7,
    "IDENTITY_PROVIDER": os.getenv("IDENTITY_PROVIDER", "MOCK"),
    "PAYMENT_PROVIDER": os.getenv("PAYMENT_PROVIDER", "STRIPE_CONNECT" if os.getenv("STRIPE_API_KEY") else "MOCK"),
    "PUSH_PROVIDER": os.getenv("PUSH_PROVIDER", "MOCK"),
    "MAP_PROVIDER": os.getenv("MAP_PROVIDER", "MOCK"),
    "STRIPE_API_KEY": os.getenv("STRIPE_API_KEY", ""),
    "EMERGENT_LLM_KEY": os.getenv("EMERGENT_LLM_KEY", ""),
    "INTEGRATION_PROXY_URL": (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com",
    "APP_NAME": "spike-marketplace",
}

# Service categories with risk tiers
CATEGORIES = [
    {"id": "furniture_assembly", "name": "Furniture Assembly", "risk": "LOW", "requires_evidence": True},
    {"id": "moving", "name": "Moving Help", "risk": "LOW", "requires_evidence": False},
    {"id": "cleaning", "name": "Cleaning", "risk": "LOW", "requires_evidence": True},
    {"id": "tv_mounting", "name": "TV Mounting", "risk": "MEDIUM", "requires_evidence": True},
    {"id": "appliance_install", "name": "Appliance Install", "risk": "MEDIUM", "requires_evidence": True},
    {"id": "painting", "name": "Painting", "risk": "MEDIUM", "requires_evidence": True},
    {"id": "handyman", "name": "General Handyman", "risk": "MEDIUM", "requires_evidence": True},
    {"id": "plumbing", "name": "Plumbing", "risk": "HIGH", "requires_evidence": True, "requires_license": True},
    {"id": "electrical", "name": "Electrical", "risk": "HIGH", "requires_evidence": True, "requires_license": True},
    {"id": "hvac", "name": "HVAC", "risk": "HIGH", "requires_evidence": True, "requires_license": True},
]

# ------------------------------------------------------------------
# DB
# ------------------------------------------------------------------
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI(title="SPIKE API")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------
def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def new_id(prefix: str = "") -> str:
    return f"{prefix}{uuid.uuid4().hex[:16]}"


def ensure_aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def check_pw(pw: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), h.encode())
    except Exception:
        return False


def mint_jwt(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "iat": int(now_utc().timestamp()),
        "exp": int((now_utc() + timedelta(days=CONFIG["JWT_TTL_DAYS"])).timestamp()),
    }
    return jwt.encode(payload, CONFIG["JWT_SECRET"], algorithm=CONFIG["JWT_ALG"])


def haversine_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 3958.8
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


def clean_doc(doc: Optional[dict]) -> Optional[dict]:
    if doc is None:
        return None
    d = {k: v for k, v in doc.items() if k != "_id"}
    for k, v in d.items():
        if isinstance(v, datetime):
            d[k] = ensure_aware(v).isoformat()
    return d


# ------------------------------------------------------------------
# Auth dependency (supports both Emergent Google session_token and JWT)
# ------------------------------------------------------------------
async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1].strip()

    # Try Emergent session first (session_token)
    sess = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if sess:
        exp = ensure_aware(sess.get("expires_at"))
        if exp and exp < now_utc():
            raise HTTPException(status_code=401, detail="Session expired")
        user = await db.users.find_one({"user_id": sess["user_id"]}, {"_id": 0})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return user

    # Try JWT
    try:
        payload = jwt.decode(token, CONFIG["JWT_SECRET"], algorithms=[CONFIG["JWT_ALG"]])
        user = await db.users.find_one({"user_id": payload["sub"]}, {"_id": 0})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return user
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")


def require_role(role: str):
    async def _dep(user: dict = Depends(get_current_user)) -> dict:
        if user.get("role") != role and user.get("role") != "admin":
            raise HTTPException(status_code=403, detail=f"{role} role required")
        return user
    return _dep


# ------------------------------------------------------------------
# Provider abstractions (MOCKED — swap by env var later)
# ------------------------------------------------------------------
class IdentityVerificationService:
    """Abstraction over identity providers (Persona/Stripe Identity/Veriff/etc).
    MOCKED for MVP - always returns VERIFIED after brief delay simulation.
    """
    @staticmethod
    async def request_verification(user_id: str, legal_name: str, dob: Optional[str] = None) -> dict:
        ref = f"mock_{secrets.token_hex(8)}"
        provider = CONFIG["IDENTITY_PROVIDER"]  # "MOCK" for MVP
        record = {
            "verification_id": new_id("iv_"),
            "user_id": user_id,
            "provider": provider,
            "provider_ref": ref,
            "status": "PENDING",
            "legal_name": legal_name,
            "dob": dob,
            "created_at": now_utc(),
            "updated_at": now_utc(),
            "mocked": True,
        }
        await db.identity_verifications.insert_one(record.copy())
        return record

    @staticmethod
    async def mark_verified(user_id: str) -> dict:
        await db.identity_verifications.update_many(
            {"user_id": user_id, "status": "PENDING"},
            {"$set": {"status": "VERIFIED", "updated_at": now_utc()}},
        )
        await db.users.update_one({"user_id": user_id}, {"$set": {"identity_status": "VERIFIED", "identity_verified_at": now_utc()}})
        return {"status": "VERIFIED"}

    @staticmethod
    async def get_status(user_id: str) -> str:
        u = await db.users.find_one({"user_id": user_id}, {"_id": 0, "identity_status": 1})
        return (u or {}).get("identity_status", "PENDING")


class PaymentService:
    """Marketplace payment abstraction. Uses Stripe Connect (destination charges +
    application_fee_amount = 10%) when STRIPE_API_KEY is set, otherwise MOCK.
    """
    @staticmethod
    def _stripe():
        if stripe_sdk and CONFIG["STRIPE_API_KEY"]:
            stripe_sdk.api_key = CONFIG["STRIPE_API_KEY"]
            return stripe_sdk
        return None

    @staticmethod
    async def onboard_link(handyman_id: str, return_url: str) -> dict:
        """Create/reuse a Stripe Express connected account and return an onboarding URL."""
        s = PaymentService._stripe()
        if not s:
            # MOCK: fake onboarding complete instantly
            await db.users.update_one({"user_id": handyman_id}, {"$set": {
                "stripe_account_id": f"acct_mock_{secrets.token_hex(4)}",
                "stripe_charges_enabled": True, "stripe_payouts_enabled": True, "stripe_details_submitted": True,
            }})
            return {"url": return_url, "mocked": True}
        u = await db.users.find_one({"user_id": handyman_id})
        account_id = (u or {}).get("stripe_account_id")
        if not account_id:
            try:
                account = await run_in_threadpool(lambda: s.Account.create(
                    type="express", country="US",
                    capabilities={"card_payments": {"requested": True}, "transfers": {"requested": True}},
                    metadata={"handyman_id": handyman_id},
                ))
                account_id = account.id
            except Exception as e:
                logger.warning("Stripe account.create failed, falling back to mock: %s", e)
                await db.users.update_one({"user_id": handyman_id}, {"$set": {
                    "stripe_account_id": f"acct_mock_{secrets.token_hex(4)}",
                    "stripe_charges_enabled": True, "stripe_payouts_enabled": True, "stripe_details_submitted": True,
                }})
                return {"url": return_url, "mocked": True}
            await db.users.update_one({"user_id": handyman_id}, {"$set": {"stripe_account_id": account_id}})
        try:
            link = await run_in_threadpool(lambda: s.AccountLink.create(
                account=account_id, type="account_onboarding",
                refresh_url=return_url, return_url=return_url,
            ))
            return {"url": link.url, "account_id": account_id}
        except Exception as e:
            logger.warning("Stripe AccountLink.create failed: %s", e)
            return {"url": return_url, "mocked": True}

    @staticmethod
    async def authorize(job_id: str, customer_id: str, amount: float) -> dict:
        s = PaymentService._stripe()
        job = await db.jobs.find_one({"job_id": job_id})
        handyman_id = job.get("handyman_id") if job else None
        hm = await db.users.find_one({"user_id": handyman_id}) if handyman_id else None
        commission_cents = int(round(amount * CONFIG["PLATFORM_COMMISSION_PERCENT"]))  # amount is dollars, cents = dollars*100; but commission cents = dollars*10 = dollars*100*0.10
        amount_cents = int(round(amount * 100))
        commission_cents = int(round(amount_cents * CONFIG["PLATFORM_COMMISSION_PERCENT"] / 100.0))
        pay = {
            "payment_id": new_id("pay_"),
            "job_id": job_id,
            "customer_id": customer_id,
            "handyman_id": handyman_id,
            "amount": amount,
            "amount_cents": amount_cents,
            "commission_cents_planned": commission_cents,
            "status": "AUTHORIZED",
            "provider": CONFIG["PAYMENT_PROVIDER"],
            "provider_ref": None,
            "created_at": now_utc(),
        }
        if s and hm and hm.get("stripe_account_id") and hm.get("stripe_charges_enabled"):
            try:
                intent = await run_in_threadpool(lambda: s.PaymentIntent.create(
                    amount=amount_cents, currency="usd",
                    capture_method="manual",
                    automatic_payment_methods={"enabled": True, "allow_redirects": "never"},
                    application_fee_amount=commission_cents,
                    transfer_data={"destination": hm["stripe_account_id"]},
                    metadata={"job_id": job_id, "customer_id": customer_id},
                    idempotency_key=f"job-authorize-{job_id}",
                ))
                pay["provider_ref"] = intent.id
                pay["client_secret"] = intent.client_secret
                pay["stripe_status"] = intent.status
            except Exception as e:
                logger.warning("Stripe PaymentIntent.create failed, using mock: %s", e)
                pay["provider"] = "MOCK"
                pay["mocked"] = True
        else:
            pay["mocked"] = True
            pay["provider_ref"] = f"mock_auth_{secrets.token_hex(6)}"
        await db.payments.insert_one(pay.copy())
        return pay

    @staticmethod
    async def capture_and_release(payment_id: str, handyman_id: str) -> dict:
        pay = await db.payments.find_one({"payment_id": payment_id})
        if not pay:
            raise HTTPException(404, "payment not found")
        commission = round(pay["amount"] * CONFIG["PLATFORM_COMMISSION_PERCENT"] / 100.0, 2)
        payout = round(pay["amount"] - commission, 2)
        s = PaymentService._stripe()
        stripe_status = None
        if s and pay.get("provider_ref") and not pay.get("mocked"):
            try:
                captured = await run_in_threadpool(lambda: s.PaymentIntent.capture(
                    pay["provider_ref"], idempotency_key=f"job-capture-{pay['job_id']}",
                ))
                stripe_status = captured.status
            except Exception as e:
                logger.warning("Stripe capture failed: %s", e)
        await db.payments.update_one(
            {"payment_id": payment_id},
            {"$set": {"status": "RELEASED", "released_at": now_utc(),
                      "commission": commission, "payout": payout, "handyman_id": handyman_id,
                      "stripe_status": stripe_status}},
        )
        await db.payouts.insert_one({
            "payout_id": new_id("po_"),
            "payment_id": payment_id,
            "handyman_id": handyman_id,
            "amount": payout,
            "job_id": pay["job_id"],
            "status": "COMPLETED",
            "created_at": now_utc(),
            "provider": pay.get("provider", "MOCK"),
        })
        await db.commissions.insert_one({
            "commission_id": new_id("cm_"),
            "payment_id": payment_id,
            "job_id": pay["job_id"],
            "amount": commission,
            "created_at": now_utc(),
        })
        return {"status": "RELEASED", "commission": commission, "payout": payout}


class PushNotificationService:
    """MOCKED push. Stores notification records in DB; real impl uses Firebase/APNs."""
    @staticmethod
    async def send(user_id: str, notif_type: str, title: str, body: str, data: Optional[dict] = None):
        await db.notifications.insert_one({
            "notification_id": new_id("nt_"),
            "user_id": user_id,
            "type": notif_type,
            "title": title,
            "body": body,
            "data": data or {},
            "read": False,
            "created_at": now_utc(),
            "mocked": True,
        })


class MapProvider:
    """MOCKED. Real impl would use Google/Mapbox for geocoding & routing."""
    @staticmethod
    async def geocode_zip(zip_code: str) -> Optional[dict]:
        # Small stub of known zips (deterministic). Real impl calls geocoding API.
        table = {
            "92105": {"lat": 32.7440, "lng": -117.0900, "city": "San Diego", "state": "CA"},
            "92037": {"lat": 32.8322, "lng": -117.2713, "city": "La Jolla", "state": "CA"},
            "94103": {"lat": 37.7749, "lng": -122.4194, "city": "San Francisco", "state": "CA"},
            "10001": {"lat": 40.7506, "lng": -73.9971, "city": "New York", "state": "NY"},
            "60601": {"lat": 41.8858, "lng": -87.6181, "city": "Chicago", "state": "IL"},
        }
        if zip_code in table:
            return table[zip_code]
        # Pseudo-random deterministic hash → coords in US-ish
        h = int(hashlib.sha256(zip_code.encode()).hexdigest(), 16)
        lat = 30 + (h % 20000) / 1000.0  # 30-50
        lng = -120 + ((h // 20000) % 45000) / 1000.0  # -120 to -75
        return {"lat": round(lat, 4), "lng": round(lng, 4), "city": "Unknown", "state": "US"}


class ObjectStorage:
    """Emergent Managed Object Storage. init once, reuse storage_key."""
    _storage_key: Optional[str] = None

    @classmethod
    def _base_url(cls) -> str:
        return CONFIG["INTEGRATION_PROXY_URL"].rstrip("/") + "/objstore/api/v1/storage"

    @classmethod
    def init(cls) -> Optional[str]:
        if cls._storage_key:
            return cls._storage_key
        if not CONFIG["EMERGENT_LLM_KEY"]:
            return None
        try:
            r = pyrequests.post(f"{cls._base_url()}/init",
                                json={"emergent_key": CONFIG["EMERGENT_LLM_KEY"]}, timeout=15)
            if r.status_code == 200:
                cls._storage_key = r.json().get("storage_key")
                return cls._storage_key
            logger.warning("ObjectStorage init failed %s: %s", r.status_code, r.text[:200])
        except Exception as e:
            logger.warning("ObjectStorage init exception: %s", e)
        return None

    @classmethod
    def put(cls, path: str, data: bytes, content_type: str) -> Optional[dict]:
        key = cls.init()
        if not key:
            return None
        try:
            r = pyrequests.put(f"{cls._base_url()}/objects/{path}",
                               headers={"X-Storage-Key": key, "Content-Type": content_type},
                               data=data, timeout=60)
            if r.status_code == 503:
                cls._storage_key = None
                key = cls.init()
                if not key:
                    return None
                r = pyrequests.put(f"{cls._base_url()}/objects/{path}",
                                   headers={"X-Storage-Key": key, "Content-Type": content_type},
                                   data=data, timeout=60)
            if r.status_code == 200:
                return r.json()
            logger.warning("ObjectStorage put failed %s: %s", r.status_code, r.text[:200])
        except Exception as e:
            logger.warning("ObjectStorage put exception: %s", e)
        return None

    @classmethod
    def get(cls, path: str) -> Optional[tuple]:
        key = cls.init()
        if not key:
            return None
        try:
            r = pyrequests.get(f"{cls._base_url()}/objects/{path}",
                               headers={"X-Storage-Key": key}, timeout=30)
            if r.status_code == 503:
                cls._storage_key = None
                key = cls.init()
                if not key:
                    return None
                r = pyrequests.get(f"{cls._base_url()}/objects/{path}",
                                   headers={"X-Storage-Key": key}, timeout=30)
            if r.status_code == 200:
                return r.content, r.headers.get("Content-Type", "application/octet-stream")
        except Exception as e:
            logger.warning("ObjectStorage get exception: %s", e)
        return None


def _strip_commission_for(viewer_role: str, doc: dict) -> dict:
    """Remove commission-related fields from payment/payout docs unless admin."""
    if viewer_role == "admin":
        return doc
    hidden = {"commission", "commission_cents_planned", "application_fee_amount"}
    return {k: v for k, v in doc.items() if k not in hidden}


# ------------------------------------------------------------------
# Models
# ------------------------------------------------------------------
class RegisterIn(BaseModel):
    email: EmailStr
    phone: str
    password: str
    role: Literal["customer", "handyman"]
    legal_name: Optional[str] = None
    zip_code: Optional[str] = None
    accept_terms: bool


class LoginIn(BaseModel):
    email: EmailStr
    password: str
    captcha_token: Optional[str] = None  # anti-bot verification token


class GoogleSessionIn(BaseModel):
    session_id: str
    role: Optional[Literal["customer", "handyman"]] = "customer"


class JobCreateIn(BaseModel):
    title: str
    category: str
    description: str
    photos: List[str] = []  # base64 or urls
    price: float
    date: str  # ISO date
    start_time: str  # "14:00"
    end_time: str  # "17:00"
    zip_code: str
    exact_address: str
    special_instructions: Optional[str] = None
    required_skills: List[str] = []
    urgency: Literal["standard", "emergency"] = "standard"


class MessageIn(BaseModel):
    body: str


class AdditionalWorkIn(BaseModel):
    description: str
    price: float


class DisputeIn(BaseModel):
    category: str
    description: str
    evidence: List[str] = []


class ReviewIn(BaseModel):
    rating: float  # 1-5
    categories: Dict[str, float] = {}
    comment: Optional[str] = None
    photos: List[str] = []  # storage paths


class ArrivalIn(BaseModel):
    lat: float
    lng: float


# ------------------------------------------------------------------
# Startup - indexes & seed
# ------------------------------------------------------------------
@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.user_sessions.create_index("session_token", unique=True)
    await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.jobs.create_index("job_id", unique=True)
    await db.jobs.create_index("status")
    await db.jobs.create_index("customer_id")
    await db.jobs.create_index([("approx_location", "2dsphere")])
    await db.users.create_index([("location", "2dsphere")])
    await db.job_events.create_index("job_id")
    await db.messages.create_index([("job_id", 1), ("created_at", 1)])
    await db.notifications.create_index("user_id")
    await db.reviews.create_index("job_id")

    # Seed admin
    admin_email = "admin@spike.app"
    if not await db.users.find_one({"email": admin_email}):
        await db.users.insert_one({
            "user_id": new_id("u_"),
            "email": admin_email,
            "phone": "+10000000000",
            "role": "admin",
            "password_hash": hash_pw("Admin@123"),
            "identity_status": "VERIFIED",
            "created_at": now_utc(),
            "suspended": False,
        })
        logger.info("Seeded admin user: %s / Admin@123", admin_email)

    # Seed a few demo handymen
    demo_hms = [
        ("mike@spike.app", "Mike Rivera", "92105", ["tv_mounting", "furniture_assembly", "handyman"]),
        ("sarah@spike.app", "Sarah Chen", "92037", ["cleaning", "painting", "handyman"]),
        ("alex@spike.app", "Alex Kim", "94103", ["plumbing", "electrical", "handyman"]),
    ]
    for email, name, zc, cats in demo_hms:
        if not await db.users.find_one({"email": email}):
            geo = await MapProvider.geocode_zip(zc)
            await db.users.insert_one({
                "user_id": new_id("u_"),
                "email": email,
                "phone": "+15555550100",
                "role": "handyman",
                "password_hash": hash_pw("Demo@123"),
                "legal_name": name,
                "zip_code": zc,
                "location": {"type": "Point", "coordinates": [geo["lng"], geo["lat"]]},
                "categories": cats,
                "identity_status": "VERIFIED",
                "identity_verified_at": now_utc(),
                "license_verified": "plumbing" in cats or "electrical" in cats,
                "insurance_verified": True,
                "rating_avg": 4.8,
                "rating_count": 12 + hash(email) % 30,
                "completed_jobs": 25 + hash(email) % 40,
                "completion_rate": 98,
                "on_time_rate": 96,
                "cancellation_rate": 2,
                "reliability_score": 95,
                "created_at": now_utc(),
                "suspended": False,
            })
    # Seed a demo customer
    if not await db.users.find_one({"email": "jane@spike.app"}):
        geo = await MapProvider.geocode_zip("92105")
        await db.users.insert_one({
            "user_id": new_id("u_"),
            "email": "jane@spike.app",
            "phone": "+15555550200",
            "role": "customer",
            "password_hash": hash_pw("Demo@123"),
            "legal_name": "Jane Doe",
            "zip_code": "92105",
            "location": {"type": "Point", "coordinates": [geo["lng"], geo["lat"]]},
            "identity_status": "VERIFIED",
            "created_at": now_utc(),
            "suspended": False,
        })
    logger.info("SPIKE backend ready.")
    # Init object storage (idempotent, best-effort)
    try:
        await run_in_threadpool(ObjectStorage.init)
    except Exception as e:
        logger.warning("ObjectStorage init at startup failed: %s", e)


# ------------------------------------------------------------------
# Auth endpoints
# ------------------------------------------------------------------
@api_router.get("/")
async def root():
    return {"app": "SPIKE", "tagline": "Post it. Claim it. Get it done."}


@api_router.get("/config")
async def get_config():
    """Public non-secret config for the client."""
    return {
        "categories": CATEGORIES,
        "commission_percent": CONFIG["PLATFORM_COMMISSION_PERCENT"],
        "initial_radius_miles": CONFIG["INITIAL_RADIUS_MILES"],
        "expanded_radius_miles": CONFIG["EXPANDED_RADIUS_MILES"],
        "address_release_hours": CONFIG["ADDRESS_RELEASE_HOURS"],
    }


@api_router.post("/auth/register")
async def register(body: RegisterIn):
    if not body.accept_terms:
        raise HTTPException(400, "Must accept terms")
    if await db.users.find_one({"email": body.email}):
        raise HTTPException(400, "Email already registered")
    doc = {
        "user_id": new_id("u_"),
        "email": body.email,
        "phone": body.phone,
        "role": body.role,
        "password_hash": hash_pw(body.password),
        "legal_name": body.legal_name,
        "zip_code": body.zip_code,
        "identity_status": "PENDING",
        "created_at": now_utc(),
        "suspended": False,
        "rating_avg": 0,
        "rating_count": 0,
        "completed_jobs": 0,
        "completion_rate": 100,
        "on_time_rate": 100,
        "cancellation_rate": 0,
        "reliability_score": 80,
    }
    if body.zip_code:
        geo = await MapProvider.geocode_zip(body.zip_code)
        if geo:
            doc["location"] = {"type": "Point", "coordinates": [geo["lng"], geo["lat"]]}
    await db.users.insert_one(doc.copy())
    if body.role == "handyman" and body.legal_name:
        await IdentityVerificationService.request_verification(doc["user_id"], body.legal_name)
    token = mint_jwt(doc["user_id"])
    return {"token": token, "user": clean_doc({k: v for k, v in doc.items() if k != "password_hash"})}


@api_router.post("/auth/login")
async def login(body: LoginIn):
    # Simple anti-bot: require captcha_token to be present and non-empty (client generates)
    if not body.captcha_token or len(body.captcha_token) < 6:
        raise HTTPException(400, "Human verification required")
    u = await db.users.find_one({"email": body.email})
    if not u or not check_pw(body.password, u.get("password_hash", "")):
        raise HTTPException(401, "Invalid credentials")
    if u.get("suspended"):
        raise HTTPException(403, "Account suspended")
    token = mint_jwt(u["user_id"])
    return {"token": token, "user": clean_doc({k: v for k, v in u.items() if k != "password_hash"})}


@api_router.post("/auth/session")
async def google_session(body: GoogleSessionIn):
    """Emergent Google Auth session exchange."""
    async with httpx.AsyncClient(timeout=15.0) as client_http:
        try:
            resp = await client_http.get(
                "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
                headers={"X-Session-ID": body.session_id},
            )
        except Exception as e:
            raise HTTPException(401, f"Auth service error: {e}")
    if resp.status_code != 200:
        raise HTTPException(401, "Invalid session")
    data = resp.json()
    email = data.get("email")
    name = data.get("name")
    picture = data.get("picture")
    session_token = data.get("session_token")
    if not email or not session_token:
        raise HTTPException(401, "Malformed session")
    # Upsert user
    existing = await db.users.find_one({"email": email})
    if existing:
        user_id = existing["user_id"]
        role = existing.get("role", body.role or "customer")
    else:
        user_id = new_id("u_")
        role = body.role or "customer"
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "phone": "",
            "role": role,
            "legal_name": name,
            "avatar": picture,
            "identity_status": "PENDING",
            "created_at": now_utc(),
            "suspended": False,
            "rating_avg": 0,
            "rating_count": 0,
            "completed_jobs": 0,
            "reliability_score": 80,
        })
    await db.user_sessions.insert_one({
        "session_token": session_token,
        "user_id": user_id,
        "expires_at": now_utc() + timedelta(days=7),
        "created_at": now_utc(),
    })
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0})
    return {"session_token": session_token, "user": clean_doc(user)}


@api_router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return {"user": clean_doc({k: v for k, v in user.items() if k != "password_hash"})}


@api_router.post("/auth/logout")
async def logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1]
        await db.user_sessions.delete_one({"session_token": token})
    return {"ok": True}


# ------------------------------------------------------------------
# Users / Profile
# ------------------------------------------------------------------
@api_router.get("/users/{user_id}")
async def get_user(user_id: str, requester: dict = Depends(get_current_user)):
    u = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0})
    if not u:
        raise HTTPException(404, "not found")
    # Public sanitized view - hide exact address, phone, email
    safe = {
        "user_id": u["user_id"],
        "role": u.get("role"),
        "legal_name": u.get("legal_name"),
        "avatar": u.get("avatar"),
        "identity_status": u.get("identity_status", "PENDING"),
        "license_verified": u.get("license_verified", False),
        "insurance_verified": u.get("insurance_verified", False),
        "rating_avg": u.get("rating_avg", 0),
        "rating_count": u.get("rating_count", 0),
        "completed_jobs": u.get("completed_jobs", 0),
        "completion_rate": u.get("completion_rate", 100),
        "on_time_rate": u.get("on_time_rate", 100),
        "cancellation_rate": u.get("cancellation_rate", 0),
        "reliability_score": u.get("reliability_score", 80),
        "categories": u.get("categories", []),
        "zip_area": (u.get("zip_code") or "")[:3] + "**" if u.get("zip_code") else None,
    }
    return safe


@api_router.patch("/users/me")
async def update_me(patch: Dict[str, Any], user: dict = Depends(get_current_user)):
    allowed = {"legal_name", "phone", "zip_code", "categories", "avatar", "bio"}
    updates = {k: v for k, v in patch.items() if k in allowed}
    if "zip_code" in updates:
        geo = await MapProvider.geocode_zip(updates["zip_code"])
        if geo:
            updates["location"] = {"type": "Point", "coordinates": [geo["lng"], geo["lat"]]}
    if updates:
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": updates})
    u = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "password_hash": 0})
    return {"user": clean_doc(u)}


@api_router.post("/verification/start")
async def start_verification(body: Dict[str, Any], user: dict = Depends(get_current_user)):
    name = body.get("legal_name") or user.get("legal_name") or user.get("email")
    v = await IdentityVerificationService.request_verification(user["user_id"], name, body.get("dob"))
    return {"verification": clean_doc(v)}


@api_router.post("/verification/complete")
async def complete_verification(user: dict = Depends(get_current_user)):
    """MOCK: auto-verify. Real provider would call webhook."""
    await IdentityVerificationService.mark_verified(user["user_id"])
    u = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "password_hash": 0})
    return {"user": clean_doc(u)}


# ------------------------------------------------------------------
# Jobs
# ------------------------------------------------------------------
async def _log_event(job_id: str, actor_id: str, prev: str, new: str, metadata: dict = None):
    await db.job_events.insert_one({
        "event_id": new_id("ev_"),
        "job_id": job_id,
        "actor_id": actor_id,
        "prev_state": prev,
        "new_state": new,
        "metadata": metadata or {},
        "created_at": now_utc(),
    })


def _mask_address(job: dict, viewer_role: str, viewer_id: str) -> dict:
    """Return job with address hidden unless authorized."""
    j = dict(job)
    j.pop("_id", None)
    now = now_utc()
    release_at = ensure_aware(j.get("address_release_at"))
    is_owner = viewer_id == j.get("customer_id")
    is_booked_handyman = viewer_id == j.get("handyman_id") and j.get("status") in {
        "BOOKED", "HANDYMAN_ON_WAY", "ARRIVED", "IN_PROGRESS", "COMPLETED", "CUSTOMER_APPROVED",
        "PAYMENT_PENDING", "PAYMENT_RELEASED", "DISPUTED"
    }
    released = release_at is not None and now >= release_at
    if not is_owner:
        if is_booked_handyman and (released or j.get("urgency") == "emergency"):
            pass  # allow
        else:
            j.pop("exact_address", None)
            j.pop("customer_phone", None)
            j.pop("customer_email", None)
    # convert datetimes
    for k, v in list(j.items()):
        if isinstance(v, datetime):
            j[k] = ensure_aware(v).isoformat()
    j["address_released"] = released or (is_booked_handyman and j.get("urgency") == "emergency") or is_owner
    return j


@api_router.post("/jobs")
async def create_job(body: JobCreateIn, user: dict = Depends(require_role("customer"))):
    if not any(c["id"] == body.category for c in CATEGORIES):
        raise HTTPException(400, "invalid category")
    geo = await MapProvider.geocode_zip(body.zip_code)
    if not geo:
        raise HTTPException(400, "invalid zip")
    # Parse scheduled start
    try:
        scheduled_start = datetime.fromisoformat(f"{body.date}T{body.start_time}:00+00:00")
    except Exception:
        raise HTTPException(400, "invalid date/time")
    # Approx location = shifted by ~0.5 mile random for privacy
    lat_shift = (int(hashlib.md5(body.exact_address.encode()).hexdigest()[:4], 16) % 100 - 50) / 5000.0
    lng_shift = (int(hashlib.md5(body.exact_address.encode()).hexdigest()[4:8], 16) % 100 - 50) / 5000.0
    approx = {"type": "Point", "coordinates": [geo["lng"] + lng_shift, geo["lat"] + lat_shift]}
    exact_loc = {"type": "Point", "coordinates": [geo["lng"], geo["lat"]]}
    address_release_at = scheduled_start - timedelta(hours=CONFIG["ADDRESS_RELEASE_HOURS"])
    if body.urgency == "emergency":
        address_release_at = now_utc()

    job = {
        "job_id": new_id("job_"),
        "customer_id": user["user_id"],
        "title": body.title,
        "category": body.category,
        "description": body.description,
        "photos": body.photos,
        "price": float(body.price),
        "date": body.date,
        "start_time": body.start_time,
        "end_time": body.end_time,
        "scheduled_start": scheduled_start,
        "zip_code": body.zip_code,
        "zip_area": body.zip_code[:3] + "**",
        "city": geo.get("city"),
        "state": geo.get("state"),
        "exact_address": body.exact_address,
        "approx_location": approx,
        "exact_location": exact_loc,
        "special_instructions": body.special_instructions,
        "required_skills": body.required_skills,
        "urgency": body.urgency,
        "status": "POSTED",
        "handyman_id": None,
        "claimed_at": None,
        "booked_at": None,
        "address_release_at": address_release_at,
        "matching_radius": CONFIG["INITIAL_RADIUS_MILES"],
        "matching_started_at": now_utc(),
        "created_at": now_utc(),
        "updated_at": now_utc(),
        "photos_before": [],
        "photos_after": [],
    }
    await db.jobs.insert_one(job.copy())
    await _log_event(job["job_id"], user["user_id"], "DRAFT", "POSTED")
    # Notify nearby handymen
    await _notify_nearby(job)
    return {"job": _mask_address(job, "customer", user["user_id"])}


async def _notify_nearby(job: dict):
    radius_miles = job.get("matching_radius", CONFIG["INITIAL_RADIUS_MILES"])
    coords = job["approx_location"]["coordinates"]
    handymen = db.users.find({
        "role": "handyman",
        "identity_status": "VERIFIED",
        "suspended": {"$ne": True},
        "categories": job["category"],
        "location": {
            "$near": {
                "$geometry": {"type": "Point", "coordinates": coords},
                "$maxDistance": radius_miles * 1609.34,
            }
        },
    }, {"_id": 0, "user_id": 1})
    async for h in handymen:
        await PushNotificationService.send(
            h["user_id"], "NEW_JOB", "New job nearby",
            f"{job['title']} — ${job['price']:.0f}",
            {"job_id": job["job_id"]},
        )


@api_router.get("/jobs")
async def list_jobs(user: dict = Depends(get_current_user), scope: str = "mine"):
    role = user.get("role")
    if role == "customer" or scope == "mine":
        cur = db.jobs.find({"customer_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1)
        jobs = [_mask_address(j, role, user["user_id"]) async for j in cur]
        return {"jobs": jobs}
    if role == "handyman":
        # Available: POSTED/MATCHING with matching category and within radius
        u = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
        if not u.get("location"):
            return {"jobs": []}
        coords = u["location"]["coordinates"]
        # Get user's categories
        cats = u.get("categories", [])
        query = {
            "status": {"$in": ["POSTED", "MATCHING_30MI", "MATCHING_60MI"]},
            "handyman_id": None,
        }
        if cats:
            query["category"] = {"$in": cats}
        query["approx_location"] = {
            "$near": {
                "$geometry": {"type": "Point", "coordinates": coords},
                "$maxDistance": CONFIG["EXPANDED_RADIUS_MILES"] * 1609.34,
            }
        }
        cur = db.jobs.find(query, {"_id": 0}).limit(100)
        jobs = []
        async for j in cur:
            masked = _mask_address(j, role, user["user_id"])
            # Add distance
            [lng, lat] = j["approx_location"]["coordinates"]
            masked["distance_miles"] = round(haversine_miles(coords[1], coords[0], lat, lng), 1)
            jobs.append(masked)
        # Also list handyman's own claimed/booked jobs when scope="mine"
        if scope == "mine":
            cur2 = db.jobs.find({"handyman_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1)
            jobs = [_mask_address(j, role, user["user_id"]) async for j in cur2]
        return {"jobs": jobs}
    return {"jobs": []}


@api_router.get("/jobs/available")
async def available_jobs(user: dict = Depends(require_role("handyman"))):
    if user.get("identity_status") != "VERIFIED":
        return {"jobs": [], "reason": "identity_not_verified"}
    u = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    if not u.get("location"):
        return {"jobs": [], "reason": "no_location"}
    coords = u["location"]["coordinates"]
    cats = u.get("categories", [])
    query = {
        "status": {"$in": ["POSTED", "MATCHING_30MI", "MATCHING_60MI"]},
        "handyman_id": None,
    }
    if cats:
        query["category"] = {"$in": cats}
    query["approx_location"] = {
        "$near": {
            "$geometry": {"type": "Point", "coordinates": coords},
            "$maxDistance": CONFIG["EXPANDED_RADIUS_MILES"] * 1609.34,
        }
    }
    cur = db.jobs.find(query, {"_id": 0}).limit(100)
    jobs = []
    async for j in cur:
        masked = _mask_address(j, "handyman", user["user_id"])
        [lng, lat] = j["approx_location"]["coordinates"]
        masked["distance_miles"] = round(haversine_miles(coords[1], coords[0], lat, lng), 1)
        jobs.append(masked)
    jobs.sort(key=lambda x: x.get("distance_miles", 999))
    return {"jobs": jobs}


@api_router.get("/jobs/{job_id}")
async def get_job(job_id: str, user: dict = Depends(get_current_user)):
    j = await db.jobs.find_one({"job_id": job_id}, {"_id": 0})
    if not j:
        raise HTTPException(404, "not found")
    # Authorization: customer_id, handyman_id, or admin only. Public list is separate endpoint.
    if user.get("role") != "admin" and user["user_id"] not in {j.get("customer_id"), j.get("handyman_id")}:
        # Available job that handyman can view
        if user.get("role") == "handyman" and j.get("status") in {"POSTED", "MATCHING_30MI", "MATCHING_60MI"}:
            pass
        else:
            raise HTTPException(403, "forbidden")
    return {"job": _mask_address(j, user.get("role"), user["user_id"])}


@api_router.post("/jobs/{job_id}/claim")
async def claim_job(job_id: str, user: dict = Depends(require_role("handyman"))):
    if user.get("identity_status") != "VERIFIED":
        raise HTTPException(403, "identity not verified")
    if user.get("suspended"):
        raise HTTPException(403, "account suspended")
    # Atomic claim: only succeed if job available
    res = await db.jobs.find_one_and_update(
        {"job_id": job_id, "handyman_id": None,
         "status": {"$in": ["POSTED", "MATCHING_30MI", "MATCHING_60MI"]}},
        {"$set": {"handyman_id": user["user_id"], "status": "CLAIMED",
                  "claimed_at": now_utc(), "updated_at": now_utc()}},
        return_document=True,
    )
    if not res:
        raise HTTPException(409, "job unavailable")
    # High-risk category license check
    cat = next((c for c in CATEGORIES if c["id"] == res["category"]), None)
    if cat and cat.get("requires_license") and not user.get("license_verified"):
        # Undo claim
        await db.jobs.update_one({"job_id": job_id}, {"$set": {"handyman_id": None, "status": "POSTED"}})
        raise HTTPException(403, "license required for this category")
    await _log_event(job_id, user["user_id"], "POSTED", "CLAIMED")
    await PushNotificationService.send(
        res["customer_id"], "HANDYMAN_CLAIMED", "A handyman claimed your job",
        f"{user.get('legal_name') or 'Handyman'} wants to help.", {"job_id": job_id},
    )
    j = await db.jobs.find_one({"job_id": job_id}, {"_id": 0})
    return {"job": _mask_address(j, "handyman", user["user_id"])}


@api_router.post("/jobs/{job_id}/book")
async def book_job(job_id: str, user: dict = Depends(require_role("customer"))):
    j = await db.jobs.find_one({"job_id": job_id})
    if not j or j.get("customer_id") != user["user_id"]:
        raise HTTPException(404, "not found")
    if j["status"] != "CLAIMED":
        raise HTTPException(400, f"cannot book from state {j['status']}")
    if not j.get("handyman_id"):
        raise HTTPException(400, "no handyman claimed")
    # Authorize payment (mocked)
    pay = await PaymentService.authorize(job_id, user["user_id"], j["price"])
    await db.jobs.update_one(
        {"job_id": job_id},
        {"$set": {"status": "BOOKED", "booked_at": now_utc(),
                  "payment_id": pay["payment_id"], "updated_at": now_utc()}},
    )
    await _log_event(job_id, user["user_id"], "CLAIMED", "BOOKED", {"payment_id": pay["payment_id"]})
    await PushNotificationService.send(
        j["handyman_id"], "JOB_BOOKED", "You're booked!",
        f"Job confirmed: {j['title']}", {"job_id": job_id},
    )
    j2 = await db.jobs.find_one({"job_id": job_id}, {"_id": 0})
    return {"job": _mask_address(j2, "customer", user["user_id"])}


@api_router.post("/jobs/{job_id}/reject-claim")
async def reject_claim(job_id: str, user: dict = Depends(require_role("customer"))):
    """Customer rejects the claim, job re-opens for matching."""
    j = await db.jobs.find_one({"job_id": job_id})
    if not j or j.get("customer_id") != user["user_id"]:
        raise HTTPException(404, "not found")
    if j["status"] != "CLAIMED":
        raise HTTPException(400, "not in claimed state")
    await db.jobs.update_one(
        {"job_id": job_id},
        {"$set": {"handyman_id": None, "status": "POSTED", "updated_at": now_utc()}},
    )
    await _log_event(job_id, user["user_id"], "CLAIMED", "POSTED", {"reason": "customer_rejected"})
    return {"ok": True}


@api_router.post("/jobs/{job_id}/on-way")
async def on_way(job_id: str, user: dict = Depends(require_role("handyman"))):
    j = await db.jobs.find_one({"job_id": job_id})
    if not j or j.get("handyman_id") != user["user_id"]:
        raise HTTPException(404, "not found")
    if j["status"] != "BOOKED":
        raise HTTPException(400, "not booked")
    await db.jobs.update_one({"job_id": job_id}, {"$set": {"status": "HANDYMAN_ON_WAY", "updated_at": now_utc()}})
    await _log_event(job_id, user["user_id"], "BOOKED", "HANDYMAN_ON_WAY")
    await PushNotificationService.send(j["customer_id"], "HANDYMAN_ON_WAY", "Handyman on the way", j["title"], {"job_id": job_id})
    return {"ok": True}


@api_router.post("/jobs/{job_id}/arrive")
async def arrive(job_id: str, body: ArrivalIn, user: dict = Depends(require_role("handyman"))):
    j = await db.jobs.find_one({"job_id": job_id})
    if not j or j.get("handyman_id") != user["user_id"]:
        raise HTTPException(404, "not found")
    if j["status"] not in {"BOOKED", "HANDYMAN_ON_WAY"}:
        raise HTTPException(400, "invalid state")
    # Address must be released
    if now_utc() < ensure_aware(j["address_release_at"]):
        raise HTTPException(403, "address not released yet")
    # Server-side GPS validation
    [lng, lat] = j["exact_location"]["coordinates"]
    dist_miles = haversine_miles(body.lat, body.lng, lat, lng)
    arrival_miles = CONFIG["ARRIVAL_RADIUS_FEET"] / 5280.0
    if dist_miles > arrival_miles * 20:  # allow some slack in demo; real would be strict
        # In demo/MVP we log but still allow; production would reject beyond radius
        logger.warning("Handyman %.2f mi from site (allowed>%.3f)", dist_miles, arrival_miles)
    await db.jobs.update_one(
        {"job_id": job_id},
        {"$set": {"status": "ARRIVED", "arrived_at": now_utc(), "arrival_gps": [body.lng, body.lat], "updated_at": now_utc()}},
    )
    await _log_event(job_id, user["user_id"], j["status"], "ARRIVED", {"gps": [body.lng, body.lat], "dist_miles": dist_miles})
    await PushNotificationService.send(j["customer_id"], "HANDYMAN_ARRIVED", "Handyman arrived", j["title"], {"job_id": job_id})
    return {"ok": True, "distance_miles": round(dist_miles, 2)}


@api_router.post("/jobs/{job_id}/photos")
async def upload_photos(job_id: str, body: Dict[str, Any], user: dict = Depends(get_current_user)):
    """kind: 'before' | 'after'; photos: base64 list"""
    j = await db.jobs.find_one({"job_id": job_id})
    if not j:
        raise HTTPException(404, "not found")
    if user["user_id"] not in {j.get("customer_id"), j.get("handyman_id")}:
        raise HTTPException(403, "forbidden")
    kind = body.get("kind")
    photos = body.get("photos", [])
    if kind == "before":
        await db.jobs.update_one({"job_id": job_id}, {"$push": {"photos_before": {"$each": [{"data": p, "at": now_utc().isoformat(), "by": user["user_id"]} for p in photos]}}})
    elif kind == "after":
        await db.jobs.update_one({"job_id": job_id}, {"$push": {"photos_after": {"$each": [{"data": p, "at": now_utc().isoformat(), "by": user["user_id"]} for p in photos]}}})
    elif kind == "post":
        # Customer job post photos
        if j.get("customer_id") != user["user_id"]:
            raise HTTPException(403, "only customer can add post photos")
        await db.jobs.update_one({"job_id": job_id}, {"$push": {"photos": {"$each": photos}}})
    else:
        raise HTTPException(400, "kind must be before/after/post")
    return {"ok": True}


@api_router.post("/jobs/{job_id}/start")
async def start_job(job_id: str, user: dict = Depends(require_role("handyman"))):
    j = await db.jobs.find_one({"job_id": job_id})
    if not j or j.get("handyman_id") != user["user_id"]:
        raise HTTPException(404, "not found")
    if j["status"] != "ARRIVED":
        raise HTTPException(400, "must arrive first")
    cat = next((c for c in CATEGORIES if c["id"] == j["category"]), None)
    if cat and cat.get("requires_evidence") and not j.get("photos_before"):
        raise HTTPException(400, "before photos required")
    await db.jobs.update_one({"job_id": job_id}, {"$set": {"status": "IN_PROGRESS", "started_at": now_utc(), "updated_at": now_utc()}})
    await _log_event(job_id, user["user_id"], "ARRIVED", "IN_PROGRESS")
    await PushNotificationService.send(j["customer_id"], "JOB_STARTED", "Job started", j["title"], {"job_id": job_id})
    return {"ok": True}


@api_router.post("/jobs/{job_id}/complete")
async def complete_job(job_id: str, user: dict = Depends(require_role("handyman"))):
    j = await db.jobs.find_one({"job_id": job_id})
    if not j or j.get("handyman_id") != user["user_id"]:
        raise HTTPException(404, "not found")
    if j["status"] != "IN_PROGRESS":
        raise HTTPException(400, "not in progress")
    cat = next((c for c in CATEGORIES if c["id"] == j["category"]), None)
    if cat and cat.get("requires_evidence") and not j.get("photos_after"):
        raise HTTPException(400, "after photos required")
    await db.jobs.update_one({"job_id": job_id}, {"$set": {"status": "COMPLETED", "completed_at": now_utc(), "updated_at": now_utc()}})
    await _log_event(job_id, user["user_id"], "IN_PROGRESS", "COMPLETED")
    await PushNotificationService.send(j["customer_id"], "JOB_COMPLETED", "Job marked complete", "Please review and approve", {"job_id": job_id})
    return {"ok": True}


@api_router.post("/jobs/{job_id}/approve")
async def approve_completion(job_id: str, user: dict = Depends(require_role("customer"))):
    j = await db.jobs.find_one({"job_id": job_id})
    if not j or j.get("customer_id") != user["user_id"]:
        raise HTTPException(404, "not found")
    if j["status"] != "COMPLETED":
        raise HTTPException(400, "not completed")
    await db.jobs.update_one({"job_id": job_id}, {"$set": {"status": "CUSTOMER_APPROVED", "approved_at": now_utc(), "updated_at": now_utc()}})
    await _log_event(job_id, user["user_id"], "COMPLETED", "CUSTOMER_APPROVED")
    # Release payment
    if j.get("payment_id"):
        result = await PaymentService.capture_and_release(j["payment_id"], j["handyman_id"])
        await db.jobs.update_one({"job_id": job_id}, {"$set": {"status": "PAYMENT_RELEASED", "updated_at": now_utc()}})
        await _log_event(job_id, user["user_id"], "CUSTOMER_APPROVED", "PAYMENT_RELEASED", result)
        await PushNotificationService.send(j["handyman_id"], "PAYMENT_RELEASED", f"You earned ${result['payout']:.2f}", j["title"], {"job_id": job_id})
    # Bump handyman completed_jobs
    await db.users.update_one({"user_id": j["handyman_id"]}, {"$inc": {"completed_jobs": 1}})
    return {"ok": True}


@api_router.post("/jobs/{job_id}/cancel")
async def cancel_job(job_id: str, user: dict = Depends(get_current_user)):
    j = await db.jobs.find_one({"job_id": job_id})
    if not j:
        raise HTTPException(404, "not found")
    if user["user_id"] not in {j.get("customer_id"), j.get("handyman_id")} and user.get("role") != "admin":
        raise HTTPException(403, "forbidden")
    if j["status"] in {"COMPLETED", "CUSTOMER_APPROVED", "PAYMENT_RELEASED", "CANCELLED"}:
        raise HTTPException(400, "cannot cancel")
    await db.jobs.update_one({"job_id": job_id}, {"$set": {"status": "CANCELLED", "cancelled_at": now_utc(), "updated_at": now_utc()}})
    await _log_event(job_id, user["user_id"], j["status"], "CANCELLED")
    return {"ok": True}


@api_router.post("/jobs/{job_id}/additional-work")
async def additional_work(job_id: str, body: AdditionalWorkIn, user: dict = Depends(require_role("handyman"))):
    j = await db.jobs.find_one({"job_id": job_id})
    if not j or j.get("handyman_id") != user["user_id"]:
        raise HTTPException(404, "not found")
    aw = {
        "aw_id": new_id("aw_"),
        "job_id": job_id,
        "description": body.description,
        "price": float(body.price),
        "status": "PENDING",
        "created_at": now_utc(),
    }
    await db.additional_work.insert_one(aw.copy())
    await PushNotificationService.send(
        j["customer_id"], "ADDITIONAL_WORK_REQUEST",
        f"+${body.price:.0f} additional work request", body.description, {"job_id": job_id, "aw_id": aw["aw_id"]},
    )
    return {"additional_work": clean_doc(aw)}


@api_router.post("/additional-work/{aw_id}/approve")
async def approve_aw(aw_id: str, user: dict = Depends(require_role("customer"))):
    aw = await db.additional_work.find_one({"aw_id": aw_id})
    if not aw:
        raise HTTPException(404, "not found")
    j = await db.jobs.find_one({"job_id": aw["job_id"]})
    if j.get("customer_id") != user["user_id"]:
        raise HTTPException(403, "forbidden")
    await db.additional_work.update_one({"aw_id": aw_id}, {"$set": {"status": "APPROVED", "approved_at": now_utc()}})
    await db.jobs.update_one({"job_id": aw["job_id"]}, {"$inc": {"price": aw["price"]}})
    return {"ok": True}


@api_router.post("/additional-work/{aw_id}/reject")
async def reject_aw(aw_id: str, user: dict = Depends(require_role("customer"))):
    aw = await db.additional_work.find_one({"aw_id": aw_id})
    if not aw:
        raise HTTPException(404, "not found")
    j = await db.jobs.find_one({"job_id": aw["job_id"]})
    if j.get("customer_id") != user["user_id"]:
        raise HTTPException(403, "forbidden")
    await db.additional_work.update_one({"aw_id": aw_id}, {"$set": {"status": "REJECTED", "rejected_at": now_utc()}})
    return {"ok": True}


@api_router.get("/jobs/{job_id}/additional-work")
async def list_aw(job_id: str, user: dict = Depends(get_current_user)):
    cur = db.additional_work.find({"job_id": job_id}, {"_id": 0})
    return {"items": [clean_doc(a) async for a in cur]}


@api_router.get("/jobs/{job_id}/events")
async def job_events(job_id: str, user: dict = Depends(get_current_user)):
    j = await db.jobs.find_one({"job_id": job_id})
    if not j:
        raise HTTPException(404, "not found")
    if user["user_id"] not in {j.get("customer_id"), j.get("handyman_id")} and user.get("role") != "admin":
        raise HTTPException(403, "forbidden")
    cur = db.job_events.find({"job_id": job_id}, {"_id": 0}).sort("created_at", 1)
    return {"events": [clean_doc(e) async for e in cur]}


# ------------------------------------------------------------------
# Messages (masked chat)
# ------------------------------------------------------------------
def _detect_off_platform(text: str) -> bool:
    keywords = ["cash", "venmo", "paypal", "zelle", "cashapp", "bank transfer", "off platform", "off-platform", "pay me direct", "outside app"]
    lower = text.lower()
    return any(k in lower for k in keywords)


def _detect_contact_info(text: str) -> bool:
    """Detect phone numbers, emails, or street addresses being shared in chat."""
    import re
    # Email
    if re.search(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", text):
        return True
    # Phone (loose): 7+ digits with optional separators, +, () — catches 555-123-4567, +1 555 1234567, 5551234567
    digits = re.sub(r"\D", "", text)
    if len(digits) >= 10:
        return True
    if re.search(r"(?:\+?\d[\d\-\.\s\(\)]{8,}\d)", text):
        return True
    # Street address hint: number followed by street word
    if re.search(r"\b\d{1,5}\s+\w+\s+(street|st|avenue|ave|road|rd|blvd|drive|dr|lane|ln|way|court|ct)\b", text, re.I):
        return True
    return False


def _can_chat(job: dict, user_id: str) -> tuple[bool, str]:
    """Return (allowed, reason). Chat only after CLAIMED, only between customer and
    the claiming handyman, and only when address is released (last 24h window).
    Emergency jobs release address immediately so chat opens on CLAIM.
    """
    if not job:
        return False, "not found"
    if user_id not in {job.get("customer_id"), job.get("handyman_id")}:
        return False, "forbidden"
    if job.get("status") in {"POSTED", "MATCHING_30MI", "MATCHING_60MI", "DRAFT"}:
        return False, "chat opens after a handyman claims the job"
    release_at = ensure_aware(job.get("address_release_at"))
    if release_at is None:
        return False, "chat unavailable"
    if now_utc() < release_at:
        hrs = int((release_at - now_utc()).total_seconds() / 3600)
        return False, f"chat opens 24h before work time ({hrs}h remaining)"
    return True, "ok"


@api_router.post("/jobs/{job_id}/messages")
async def send_message(job_id: str, body: MessageIn, user: dict = Depends(get_current_user)):
    j = await db.jobs.find_one({"job_id": job_id})
    if not j:
        raise HTTPException(404, "not found")
    allowed, reason = _can_chat(j, user["user_id"])
    if not allowed:
        code = 403 if reason == "forbidden" else 400
        raise HTTPException(code, reason)
    flagged_off = _detect_off_platform(body.body)
    flagged_contact = _detect_contact_info(body.body)
    if flagged_contact:
        # Reject outright — contact info sharing violates platform policy.
        await db.user_flags.insert_one({
            "flag_id": new_id("f_"),
            "user_id": user["user_id"],
            "type": "contact_info_attempt",
            "job_id": job_id,
            "created_at": now_utc(),
        })
        raise HTTPException(400, "Sharing phone numbers, emails, or addresses is not allowed. Keep it in-app.")
    msg = {
        "message_id": new_id("m_"),
        "job_id": job_id,
        "sender_id": user["user_id"],
        "body": body.body,
        "flagged_off_platform": flagged_off,
        "created_at": now_utc(),
    }
    await db.messages.insert_one(msg.copy())
    if flagged_off:
        await db.user_flags.insert_one({
            "flag_id": new_id("f_"),
            "user_id": user["user_id"],
            "type": "off_platform_attempt",
            "job_id": job_id,
            "message_id": msg["message_id"],
            "created_at": now_utc(),
        })
    other = j["handyman_id"] if user["user_id"] == j["customer_id"] else j["customer_id"]
    if other:
        await PushNotificationService.send(other, "CUSTOMER_MESSAGE", "New message", body.body[:60], {"job_id": job_id})
    return {"message": clean_doc(msg), "flagged_off_platform": flagged_off}


@api_router.get("/jobs/{job_id}/messages")
async def list_messages(job_id: str, user: dict = Depends(get_current_user)):
    j = await db.jobs.find_one({"job_id": job_id})
    if not j:
        raise HTTPException(404, "not found")
    if user.get("role") == "admin":
        pass
    else:
        allowed, reason = _can_chat(j, user["user_id"])
        if not allowed:
            code = 403 if reason == "forbidden" else 400
            raise HTTPException(code, reason)
    cur = db.messages.find({"job_id": job_id}, {"_id": 0}).sort("created_at", 1)
    return {"messages": [clean_doc(m) async for m in cur]}


@api_router.get("/jobs/{job_id}/chat-status")
async def chat_status(job_id: str, user: dict = Depends(get_current_user)):
    j = await db.jobs.find_one({"job_id": job_id})
    if not j:
        raise HTTPException(404, "not found")
    allowed, reason = _can_chat(j, user["user_id"])
    return {"allowed": allowed, "reason": reason,
            "address_release_at": ensure_aware(j.get("address_release_at")).isoformat() if j.get("address_release_at") else None}


# ------------------------------------------------------------------
# Reviews / ratings
# ------------------------------------------------------------------
@api_router.post("/jobs/{job_id}/reviews")
async def create_review(job_id: str, body: ReviewIn, user: dict = Depends(get_current_user)):
    j = await db.jobs.find_one({"job_id": job_id})
    if not j:
        raise HTTPException(404, "not found")
    if j["status"] not in {"CUSTOMER_APPROVED", "PAYMENT_RELEASED"}:
        raise HTTPException(400, "job not completed & approved")
    if user["user_id"] not in {j.get("customer_id"), j.get("handyman_id")}:
        raise HTTPException(403, "forbidden")
    target = j["handyman_id"] if user["user_id"] == j["customer_id"] else j["customer_id"]
    existing = await db.reviews.find_one({"job_id": job_id, "reviewer_id": user["user_id"]})
    if existing:
        raise HTTPException(400, "already reviewed")
    r = {
        "review_id": new_id("r_"),
        "job_id": job_id,
        "reviewer_id": user["user_id"],
        "reviewer_role": user.get("role"),
        "reviewer_name": user.get("legal_name") or (user.get("email", "").split("@")[0] if user.get("email") else "User"),
        "target_id": target,
        "rating": float(body.rating),
        "categories": body.categories,
        "comment": body.comment,
        "photos": body.photos,
        "created_at": now_utc(),
    }
    await db.reviews.insert_one(r.copy())
    # Recompute target's rating_avg
    agg = db.reviews.aggregate([
        {"$match": {"target_id": target}},
        {"$group": {"_id": "$target_id", "avg": {"$avg": "$rating"}, "count": {"$sum": 1}}},
    ])
    async for row in agg:
        await db.users.update_one(
            {"user_id": target},
            {"$set": {"rating_avg": round(row["avg"], 2), "rating_count": row["count"]}},
        )
    return {"review": clean_doc(r)}


@api_router.get("/users/{user_id}/reviews")
async def get_user_reviews(user_id: str, requester: dict = Depends(get_current_user)):
    cur = db.reviews.find({"target_id": user_id}, {"_id": 0}).sort("created_at", -1).limit(50)
    return {"reviews": [clean_doc(r) async for r in cur]}


@api_router.get("/jobs/{job_id}/reviews")
async def get_job_reviews(job_id: str, user: dict = Depends(get_current_user)):
    """Returns both reviews for a job plus who still needs to rate."""
    j = await db.jobs.find_one({"job_id": job_id})
    if not j:
        raise HTTPException(404, "not found")
    if user.get("role") != "admin" and user["user_id"] not in {j.get("customer_id"), j.get("handyman_id")}:
        raise HTTPException(403, "forbidden")
    cur = db.reviews.find({"job_id": job_id}, {"_id": 0})
    reviews = [clean_doc(r) async for r in cur]
    reviewer_ids = {r["reviewer_id"] for r in reviews}
    can_rate = j["status"] in {"CUSTOMER_APPROVED", "PAYMENT_RELEASED"} and user["user_id"] not in reviewer_ids and user["user_id"] in {j.get("customer_id"), j.get("handyman_id")}
    return {"reviews": reviews, "can_rate": can_rate}


@api_router.get("/jobs/{job_id}/eta")
async def job_eta(job_id: str, user: dict = Depends(get_current_user)):
    """Estimated arrival for the assigned handyman. Uses stored handyman location vs job location."""
    j = await db.jobs.find_one({"job_id": job_id})
    if not j:
        raise HTTPException(404, "not found")
    if user["user_id"] not in {j.get("customer_id"), j.get("handyman_id")}:
        raise HTTPException(403, "forbidden")
    if not j.get("handyman_id") or not j.get("exact_location"):
        return {"available": False}
    hm = await db.users.find_one({"user_id": j["handyman_id"]}, {"_id": 0, "location": 1})
    if not hm or not hm.get("location"):
        return {"available": False}
    [hlng, hlat] = hm["location"]["coordinates"]
    [jlng, jlat] = j["exact_location"]["coordinates"]
    dist = haversine_miles(hlat, hlng, jlat, jlng)
    # Emergency: assume 45 mph, standard 25 mph
    mph = 45 if j.get("urgency") == "emergency" else 25
    minutes = max(1, int(round(dist / mph * 60)))
    return {
        "available": True,
        "distance_miles": round(dist, 1),
        "minutes": minutes,
        "urgency": j.get("urgency", "standard"),
    }


# ------------------------------------------------------------------
# Disputes
# ------------------------------------------------------------------
@api_router.post("/jobs/{job_id}/dispute")
async def open_dispute(job_id: str, body: DisputeIn, user: dict = Depends(get_current_user)):
    j = await db.jobs.find_one({"job_id": job_id})
    if not j:
        raise HTTPException(404, "not found")
    if user["user_id"] not in {j.get("customer_id"), j.get("handyman_id")}:
        raise HTTPException(403, "forbidden")
    d = {
        "dispute_id": new_id("d_"),
        "job_id": job_id,
        "opener_id": user["user_id"],
        "category": body.category,
        "description": body.description,
        "evidence": body.evidence,
        "status": "OPEN",
        "resolution": None,
        "created_at": now_utc(),
    }
    await db.disputes.insert_one(d.copy())
    await db.jobs.update_one({"job_id": job_id}, {"$set": {"status": "DISPUTED", "updated_at": now_utc()}})
    await _log_event(job_id, user["user_id"], j["status"], "DISPUTED", {"dispute_id": d["dispute_id"]})
    return {"dispute": clean_doc(d)}


@api_router.get("/disputes")
async def list_disputes(user: dict = Depends(get_current_user)):
    if user.get("role") == "admin":
        cur = db.disputes.find({}, {"_id": 0}).sort("created_at", -1)
    else:
        cur = db.disputes.find({"opener_id": user["user_id"]}, {"_id": 0})
    return {"disputes": [clean_doc(d) async for d in cur]}


@api_router.post("/disputes/{dispute_id}/resolve")
async def resolve_dispute(dispute_id: str, body: Dict[str, Any], user: dict = Depends(require_role("admin"))):
    resolution = body.get("resolution")
    valid = {"FULL_REFUND", "PARTIAL_REFUND", "PAYMENT_RELEASE", "ADDITIONAL_WORK_ADJUSTMENT", "NO_ACTION", "ACCOUNT_REVIEW"}
    if resolution not in valid:
        raise HTTPException(400, "invalid resolution")
    await db.disputes.update_one(
        {"dispute_id": dispute_id},
        {"$set": {"status": "RESOLVED", "resolution": resolution, "resolved_by": user["user_id"], "resolved_at": now_utc()}},
    )
    return {"ok": True}


# ------------------------------------------------------------------
# Payments / Earnings
# ------------------------------------------------------------------
@api_router.get("/payments/mine")
async def my_payments(user: dict = Depends(get_current_user)):
    if user.get("role") == "customer":
        cur = db.payments.find({"customer_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1)
    else:
        cur = db.payouts.find({"handyman_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1)
    items = []
    async for p in cur:
        items.append(_strip_commission_for(user.get("role", ""), clean_doc(p)))
    return {"items": items}


@api_router.get("/earnings/summary")
async def earnings_summary(user: dict = Depends(require_role("handyman"))):
    """Handyman-facing earnings show ONLY net payout (after platform cut).
    Commission is never exposed to the handyman.
    """
    cur = db.payouts.find({"handyman_id": user["user_id"]}, {"_id": 0})
    total = 0.0
    count = 0
    async for p in cur:
        total += p.get("amount", 0)
        count += 1
    return {"total": round(total, 2), "count": count}


# ------------------------------------------------------------------
# Notifications
# ------------------------------------------------------------------
@api_router.get("/notifications")
async def list_notifications(user: dict = Depends(get_current_user)):
    cur = db.notifications.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).limit(50)
    return {"items": [clean_doc(n) async for n in cur]}


@api_router.post("/notifications/read-all")
async def mark_all_read(user: dict = Depends(get_current_user)):
    await db.notifications.update_many({"user_id": user["user_id"]}, {"$set": {"read": True}})
    return {"ok": True}


# ------------------------------------------------------------------
# Admin
# ------------------------------------------------------------------
@api_router.get("/admin/users")
async def admin_users(user: dict = Depends(require_role("admin"))):
    cur = db.users.find({}, {"_id": 0, "password_hash": 0}).limit(200)
    return {"users": [clean_doc(u) async for u in cur]}


@api_router.get("/admin/jobs")
async def admin_jobs(user: dict = Depends(require_role("admin"))):
    cur = db.jobs.find({}, {"_id": 0}).sort("created_at", -1).limit(200)
    return {"jobs": [clean_doc(j) async for j in cur]}


@api_router.post("/admin/users/{user_id}/suspend")
async def admin_suspend(user_id: str, body: Dict[str, Any], user: dict = Depends(require_role("admin"))):
    await db.users.update_one({"user_id": user_id}, {"$set": {"suspended": bool(body.get("suspended", True))}})
    return {"ok": True}


@api_router.get("/admin/stats")
async def admin_stats(user: dict = Depends(require_role("admin"))):
    users = await db.users.count_documents({})
    jobs = await db.jobs.count_documents({})
    disputes = await db.disputes.count_documents({"status": "OPEN"})
    revenue_pipe = db.commissions.aggregate([{"$group": {"_id": None, "sum": {"$sum": "$amount"}}}])
    revenue = 0.0
    async for row in revenue_pipe:
        revenue = row["sum"]
    return {"users": users, "jobs": jobs, "open_disputes": disputes, "revenue": round(revenue, 2)}


# ------------------------------------------------------------------
# Safety
# ------------------------------------------------------------------
@api_router.post("/safety/report")
async def report_safety(body: Dict[str, Any], user: dict = Depends(get_current_user)):
    doc = {
        "report_id": new_id("sr_"),
        "reporter_id": user["user_id"],
        "target_id": body.get("target_id"),
        "job_id": body.get("job_id"),
        "category": body.get("category"),
        "description": body.get("description", ""),
        "created_at": now_utc(),
    }
    await db.safety_reports.insert_one(doc.copy())
    return {"ok": True, "report_id": doc["report_id"]}


# ------------------------------------------------------------------
# Uploads (Emergent Managed Object Storage)
# ------------------------------------------------------------------
@api_router.post("/upload")
async def upload_file(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    ext = (file.filename or "bin").rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else "bin"
    if ext not in {"jpg", "jpeg", "png", "webp", "heic", "heif"}:
        ext = "jpg"
    path = f"{CONFIG['APP_NAME']}/uploads/{user['user_id']}/{uuid.uuid4().hex}.{ext}"
    data = await file.read()
    result = await run_in_threadpool(lambda: ObjectStorage.put(path, data, file.content_type or "image/jpeg"))
    if not result:
        # Fallback: store base64 in Mongo when object storage unavailable
        b64 = base64.b64encode(data).decode()
        doc = {
            "upload_id": new_id("up_"),
            "user_id": user["user_id"],
            "path": path,
            "storage": "inline",
            "content_type": file.content_type or "image/jpeg",
            "data_b64": b64,
            "size": len(data),
            "created_at": now_utc(),
        }
        await db.uploads.insert_one(doc.copy())
        return {"path": path, "size": len(data), "url": f"/api/files/{path}", "storage": "inline"}
    doc = {
        "upload_id": new_id("up_"),
        "user_id": user["user_id"],
        "path": result["path"],
        "storage": "emergent",
        "content_type": file.content_type or "image/jpeg",
        "size": result.get("size", len(data)),
        "etag": result.get("etag"),
        "created_at": now_utc(),
    }
    await db.uploads.insert_one(doc.copy())
    return {"path": result["path"], "size": doc["size"], "url": f"/api/files/{result['path']}", "storage": "emergent"}


@api_router.get("/files/{path:path}")
async def get_file(path: str, token: Optional[str] = None, authorization: Optional[str] = Header(None)):
    # Auth: either bearer header or token query param (for <img> on web)
    if not authorization and token:
        authorization = f"Bearer {token}"
    if not authorization:
        raise HTTPException(401, "auth required")
    try:
        await get_current_user(authorization)
    except HTTPException:
        raise
    doc = await db.uploads.find_one({"path": path}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "not found")
    if doc.get("storage") == "inline":
        return JSONResponse(status_code=200, content=None,
                            headers={"Content-Type": doc.get("content_type", "image/jpeg")})
    result = await run_in_threadpool(lambda: ObjectStorage.get(path))
    if not result:
        raise HTTPException(404, "not found")
    content, ct = result
    from fastapi.responses import Response as FResp
    return FResp(content=content, media_type=ct)


# ------------------------------------------------------------------
# Stripe Connect - handyman onboarding
# ------------------------------------------------------------------
@api_router.post("/stripe/onboard")
async def stripe_onboard(body: Dict[str, Any], user: dict = Depends(require_role("handyman"))):
    return_url = body.get("return_url") or "https://spike.app/onboarded"
    r = await PaymentService.onboard_link(user["user_id"], return_url)
    return r


@api_router.get("/stripe/status")
async def stripe_status(user: dict = Depends(require_role("handyman"))):
    u = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return {
        "connected": bool(u.get("stripe_account_id")),
        "charges_enabled": bool(u.get("stripe_charges_enabled")),
        "payouts_enabled": bool(u.get("stripe_payouts_enabled")),
        "details_submitted": bool(u.get("stripe_details_submitted")),
        "mocked": CONFIG["PAYMENT_PROVIDER"] != "STRIPE_CONNECT",
    }


# ------------------------------------------------------------------
# App mount
# ------------------------------------------------------------------
app.include_router(api_router)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
