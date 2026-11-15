import uuid
import json
import base64
import pytest
from src.api import (
    get_catalog,
    analyze_portfolio_endpoint,
    auth_google,
    get_user_configuration,
    update_user_configuration,
    analyze_user_portfolio
)
from src.models import (
    AnalyzeRequest,
    SpendProfile,
    PerkWeights,
    GoogleAuthRequest,
    SaveUserConfigRequest
)


def test_api_catalog_direct():
    data = get_catalog()
    assert "cards" in data
    assert "categories" in data
    assert "default_perks" in data
    assert len(data["cards"]) >= 14


def test_api_analyze_direct():
    req = AnalyzeRequest(
        selected_card_ids=["sbi_cashback", "icici_amazon_pay", "axis_airtel"],
        spend_profile=SpendProfile(
            monthly_spend={
                "dining_food_delivery": 5000,
                "groceries": 8000,
                "online_shopping": 10000,
                "utilities_bills": 4000,
                "travel_flights_hotels": 7000,
                "fuel": 4000,
                "movies_entertainment": 1500,
                "general_offline": 10000
            }
        ),
        weights=PerkWeights()
    )
    res = analyze_portfolio_endpoint(req)
    assert res.total_annual_spend > 0
    assert len(res.cards_summary) == 3
    assert len(res.gaps) >= 0
    assert len(res.recommendations) >= 0
    assert "dining_food_delivery" in res.best_spend_routing


def test_api_google_auth_and_config_flow():
    uid = uuid.uuid4().hex[:8]
    google_id = f"google_sub_{uid}"
    email = f"user_{uid}@gmail.com"

    # 1. Sign in via Google endpoint
    auth_req = GoogleAuthRequest(
        google_id=google_id,
        email=email,
        full_name="Google Test User",
        avatar_url="https://lh3.googleusercontent.com/test_avatar"
    )
    auth_res = auth_google(auth_req)
    assert auth_res.token is not None
    assert auth_res.user.google_id == google_id
    assert auth_res.user.email == email

    user_dict = {"id": auth_res.user.id, "email": auth_res.user.email}

    # 2. Get initial user config from SQLite
    config = get_user_configuration(user=user_dict)
    assert len(config.selected_card_ids) > 0

    # 3. Update user config with custom cards & spend
    save_req = SaveUserConfigRequest(
        selected_card_ids=["hdfc_infinia_metal"],
        spend_profile=SpendProfile(monthly_spend={"travel_flights_hotels": 25000}),
        weights=PerkWeights()
    )
    updated_cfg = update_user_configuration(save_req, user=user_dict)
    assert updated_cfg.selected_card_ids == ["hdfc_infinia_metal"]
    assert updated_cfg.spend_profile.monthly_spend["travel_flights_hotels"] == 25000

    # 4. Analyze user portfolio directly from DB
    analysis = analyze_user_portfolio(user=user_dict)
    assert analysis.total_annual_spend == 300000.0
    assert len(analysis.cards_summary) == 1
    assert analysis.cards_summary[0].card_id == "hdfc_infinia_metal"


def test_api_google_auth_with_jwt_credential():
    uid = uuid.uuid4().hex[:8]
    # Simulate a Google JWT ID token structure: header.payload.signature
    header_b64 = base64.urlsafe_b64encode(b'{"alg":"RS256"}').decode("utf-8").rstrip("=")
    payload_json = json.dumps({
        "sub": f"google_jwt_sub_{uid}",
        "email": f"jwt_user_{uid}@gmail.com",
        "name": "JWT Google User",
        "picture": "https://lh3.googleusercontent.com/jwt"
    }).encode("utf-8")
    payload_b64 = base64.urlsafe_b64encode(payload_json).decode("utf-8").rstrip("=")
    sig_b64 = "fakesignature"
    simulated_jwt = f"{header_b64}.{payload_b64}.{sig_b64}"

    auth_req = GoogleAuthRequest(credential=simulated_jwt)
    auth_res = auth_google(auth_req)
    assert auth_res.token is not None
    assert auth_res.user.google_id == f"google_jwt_sub_{uid}"
    assert auth_res.user.email == f"jwt_user_{uid}@gmail.com"
    assert auth_res.user.full_name == "JWT Google User"
