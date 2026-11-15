import json
import base64
import os
from pathlib import Path
from typing import Dict, List, Any, Optional

from fastapi import FastAPI, HTTPException, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from src.models import (
    CreditCard,
    SpendProfile,
    PerkWeights,
    PortfolioAnalysisResult,
    AnalyzeRequest,
    GoogleAuthRequest,
    UserProfile,
    AuthResponse,
    UserConfigResponse,
    SaveUserConfigRequest
)
from src.engine import CreditCardEngine
from src.gap_analyzer import GapAnalyzer
from src.recommender import Recommender
from src.db import (
    init_db,
    get_or_create_google_user,
    create_session,
    get_user_by_token,
    delete_session,
    get_user_config,
    save_user_config,
    save_card_to_db
)

# Initialize database
init_db()

app = FastAPI(
    title="India Domestic Credit Card Benefits & Gap Analysis Program",
    version="2.1.0",
    description="Quantifies domestic credit card benefits, fees, GST, milestones, user weights, portfolio gaps, with Google OAuth user management and user-level config."
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

engine = CreditCardEngine()
gap_analyzer = GapAnalyzer()
recommender = Recommender(engine)

# Base directories
BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"
DATA_DIR = BASE_DIR / "data"

# Mount static files
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


# --- Google Token Decoder Helper ---

def decode_google_credential(credential: str) -> Dict[str, Any]:
    try:
        parts = credential.split(".")
        if len(parts) < 2:
            raise ValueError("Invalid JWT token format")
        payload_b64 = parts[1]
        rem = len(payload_b64) % 4
        if rem > 0:
            payload_b64 += "=" * (4 - rem)
        decoded = base64.urlsafe_b64decode(payload_b64).decode("utf-8")
        return json.loads(decoded)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to decode Google credential: {str(e)}")


# --- Auth Dependency ---

def extract_token(authorization: Optional[str] = Header(None)) -> Optional[str]:
    if not authorization:
        return None
    if authorization.startswith("Bearer "):
        return authorization[7:].strip()
    return authorization.strip()


def get_current_user_optional(authorization: Optional[str] = Header(None)) -> Optional[Dict[str, Any]]:
    token = extract_token(authorization)
    if not token:
        return None
    user = get_user_by_token(token)
    return user


def get_current_user(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    user = get_current_user_optional(authorization)
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required. Please sign in with Google.")
    return user


# --- Static and Catalog Endpoints ---

@app.get("/")
def root():
    index_file = BASE_DIR / "index.html"
    if not index_file.exists():
        index_file = STATIC_DIR / "index.html"
    if not index_file.exists():
        raise HTTPException(status_code=404, detail="Frontend index.html not found")
    return FileResponse(index_file)


@app.get("/api/catalog")
def get_catalog():
    engine.load_catalog()
    cards = list(engine.get_catalog().values())

    categories_file = DATA_DIR / "categories.json"
    categories = []
    if categories_file.exists():
        with open(categories_file, "r", encoding="utf-8") as f:
            categories = json.load(f).get("categories", [])

    perks_file = DATA_DIR / "default_perks.json"
    perks = {}
    if perks_file.exists():
        with open(perks_file, "r", encoding="utf-8") as f:
            perks = json.load(f).get("perks", {})

    google_client_id = os.environ.get("GOOGLE_CLIENT_ID", "")

    return {
        "cards": [c.model_dump() for c in cards],
        "categories": categories,
        "default_perks": perks,
        "default_weights": PerkWeights().model_dump(),
        "google_client_id": google_client_id
    }


# --- Google Authentication Endpoint ---

@app.post("/api/auth/google", response_model=AuthResponse)
def auth_google(payload: GoogleAuthRequest):
    """
    Exclusively signs in or registers via Google.
    Accepts either Google Identity Services JWT credential or direct Google user details.
    """
    google_id = payload.google_id
    email = payload.email
    full_name = payload.full_name
    avatar_url = payload.avatar_url

    if payload.credential:
        jwt_data = decode_google_credential(payload.credential)
        google_id = jwt_data.get("sub")
        email = jwt_data.get("email")
        full_name = jwt_data.get("name") or full_name
        avatar_url = jwt_data.get("picture") or avatar_url

    if not google_id or not email:
        raise HTTPException(status_code=400, detail="Invalid Google authentication payload. Google ID and Email are required.")

    user = get_or_create_google_user(
        google_id=google_id,
        email=email,
        full_name=full_name,
        avatar_url=avatar_url
    )

    token = create_session(user["id"])
    return AuthResponse(token=token, user=UserProfile(**user))


@app.get("/api/auth/me", response_model=UserProfile)
def get_me(user: Dict[str, Any] = Depends(get_current_user)):
    return UserProfile(**user)


@app.post("/api/auth/logout")
def logout(authorization: Optional[str] = Header(None)):
    token = extract_token(authorization)
    if token:
        delete_session(token)
    return {"status": "success", "message": "Logged out successfully"}


# --- User Configuration Endpoints (SQLite-backed) ---

@app.get("/api/user/config", response_model=UserConfigResponse)
def get_user_configuration(user: Dict[str, Any] = Depends(get_current_user)):
    config = get_user_config(user["id"])
    return UserConfigResponse(
        user_id=config["user_id"],
        selected_card_ids=config["selected_card_ids"],
        spend_profile=SpendProfile(monthly_spend=config["spend_profile"]["monthly_spend"]),
        weights=PerkWeights(**config["weights"])
    )


@app.post("/api/user/config", response_model=UserConfigResponse)
def update_user_configuration(payload: SaveUserConfigRequest, user: Dict[str, Any] = Depends(get_current_user)):
    config = save_user_config(
        user_id=user["id"],
        selected_card_ids=payload.selected_card_ids,
        spend_profile=payload.spend_profile.monthly_spend,
        weights=payload.weights.model_dump()
    )
    return UserConfigResponse(
        user_id=config["user_id"],
        selected_card_ids=config["selected_card_ids"],
        spend_profile=SpendProfile(monthly_spend=config["spend_profile"]["monthly_spend"]),
        weights=PerkWeights(**config["weights"])
    )


@app.post("/api/user/analyze", response_model=PortfolioAnalysisResult)
def analyze_user_portfolio(user: Dict[str, Any] = Depends(get_current_user)):
    """
    Analyzes the logged in Google user's saved SQLite configuration directly.
    """
    config = get_user_config(user["id"])
    card_ids = config["selected_card_ids"]
    spend_profile = SpendProfile(monthly_spend=config["spend_profile"]["monthly_spend"])
    weights = PerkWeights(**config["weights"])

    return run_analysis(card_ids, spend_profile, weights)


# --- General Analysis & Custom Card Endpoints ---

@app.post("/api/cards")
def create_or_update_card(card: CreditCard, user: Optional[Dict[str, Any]] = Depends(get_current_user_optional)):
    """
    Allows user to input or customize a credit card, persisting to SQLite.
    """
    user_id = user["id"] if user else None
    save_card_to_db(card, user_id=user_id, is_custom=True)
    engine._cards_catalog[card.id] = card
    return {"status": "success", "card": card.model_dump()}


def run_analysis(
    selected_card_ids: List[str],
    spend_profile: SpendProfile,
    weights: PerkWeights,
    custom_cards: Optional[List[CreditCard]] = None
) -> PortfolioAnalysisResult:
    if custom_cards:
        for card in custom_cards:
            save_card_to_db(card, is_custom=True)
            engine._cards_catalog[card.id] = card

    catalog = engine.get_catalog()
    selected_cards: List[CreditCard] = []

    for cid in selected_card_ids:
        c = catalog.get(cid)
        if not c:
            raise HTTPException(status_code=404, detail=f"Card ID '{cid}' not found in catalog")
        selected_cards.append(c)

    if not selected_cards:
        raise HTTPException(status_code=400, detail="Please select at least one credit card for analysis.")

    # 1. Run Engine Quantification
    cards_quant, routing_info = engine.analyze_portfolio(
        cards=selected_cards,
        spend_profile=spend_profile,
        weights=weights
    )

    # 2. Gap Analysis
    gaps = gap_analyzer.analyze_gaps(
        cards=selected_cards,
        cards_quant=cards_quant,
        spend_profile=spend_profile,
        routing_info=routing_info,
        weights=weights
    )

    # 3. Recommendations
    recs = recommender.generate_recommendations(
        current_cards=selected_cards,
        current_quants=cards_quant,
        spend_profile=spend_profile,
        gaps=gaps,
        weights=weights
    )

    # Portfolio totals
    tot_spend = spend_profile.total_annual_spend()
    tot_rewards = sum(q.total_rewards_earned for q in cards_quant)
    tot_perks = sum(q.total_perk_value for q in cards_quant)
    tot_fees = sum(q.effective_annual_fee for q in cards_quant)
    net_val = sum(q.net_value for q in cards_quant)
    net_yield = (net_val / tot_spend * 100.0) if tot_spend > 0 else 0.0

    return PortfolioAnalysisResult(
        total_annual_spend=round(tot_spend, 2),
        total_annual_rewards=round(tot_rewards, 2),
        total_perk_value=round(tot_perks, 2),
        total_fees_paid=round(tot_fees, 2),
        net_annual_value=round(net_val, 2),
        net_portfolio_yield_percent=round(net_yield, 2),
        best_spend_routing=routing_info,
        cards_summary=cards_quant,
        gaps=gaps,
        recommendations=recs
    )


@app.post("/api/analyze", response_model=PortfolioAnalysisResult)
def analyze_portfolio_endpoint(request: AnalyzeRequest):
    weights = request.weights or PerkWeights()
    return run_analysis(
        selected_card_ids=request.selected_card_ids,
        spend_profile=request.spend_profile,
        weights=weights,
        custom_cards=request.custom_cards
    )
