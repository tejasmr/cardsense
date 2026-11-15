import tempfile
from pathlib import Path
import pytest
from src.db import (
    init_db,
    get_or_create_google_user,
    create_session,
    get_user_by_token,
    delete_session,
    get_user_config,
    save_user_config,
    get_all_cards_from_db,
    save_card_to_db
)
from src.models import CreditCard


@pytest.fixture
def temp_db():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = Path(f.name)
    init_db(db_path)
    yield db_path
    try:
        db_path.unlink()
    except Exception:
        pass


def test_db_init_and_cards_seeded(temp_db):
    cards = get_all_cards_from_db(temp_db)
    assert len(cards) >= 14
    card_ids = [c.id for c in cards]
    assert "sbi_cashback" in card_ids
    assert "hdfc_infinia_metal" in card_ids


def test_google_user_creation_and_lookup(temp_db):
    # Test creating user with Google profile
    user = get_or_create_google_user(
        google_id="google_sub_12345",
        email="rohit.sharma@gmail.com",
        full_name="Rohit Sharma",
        avatar_url="https://lh3.googleusercontent.com/a/rohit",
        db_path=temp_db
    )
    assert user["id"] is not None
    assert user["google_id"] == "google_sub_12345"
    assert user["email"] == "rohit.sharma@gmail.com"
    assert user["full_name"] == "Rohit Sharma"

    # Subsequent login returns the existing user and updates profile if changed
    user_updated = get_or_create_google_user(
        google_id="google_sub_12345",
        email="rohit.sharma@gmail.com",
        full_name="Rohit Sharma (Captain)",
        avatar_url="https://lh3.googleusercontent.com/a/rohit_new",
        db_path=temp_db
    )
    assert user_updated["id"] == user["id"]
    assert user_updated["full_name"] == "Rohit Sharma (Captain)"


def test_session_lifecycle(temp_db):
    user = get_or_create_google_user(
        google_id="google_sub_999",
        email="priya@gmail.com",
        full_name="Priya",
        db_path=temp_db
    )
    token = create_session(user["id"], db_path=temp_db)
    assert token is not None

    user_info = get_user_by_token(token, db_path=temp_db)
    assert user_info is not None
    assert user_info["email"] == "priya@gmail.com"

    # Delete session
    assert delete_session(token, db_path=temp_db) is True
    assert get_user_by_token(token, db_path=temp_db) is None


def test_user_level_config_persistence(temp_db):
    user = get_or_create_google_user(
        google_id="google_sub_888",
        email="virat@gmail.com",
        full_name="Virat Kohli",
        db_path=temp_db
    )

    # Initial default config seeded on creation
    cfg = get_user_config(user["id"], db_path=temp_db)
    assert len(cfg["selected_card_ids"]) > 0

    # Custom update
    new_cards = ["hdfc_infinia_metal", "axis_atlas"]
    new_spend = {"dining_food_delivery": 15000, "travel_flights_hotels": 30000}
    new_weights = {"domestic_airport_lounge_multiplier": 1.5, "domestic_airport_lounge_unit_value": 1200}

    saved = save_user_config(user["id"], new_cards, new_spend, new_weights, db_path=temp_db)
    assert saved["selected_card_ids"] == new_cards
    assert saved["spend_profile"]["monthly_spend"]["dining_food_delivery"] == 15000
    assert saved["weights"]["domestic_airport_lounge_multiplier"] == 1.5

    # Retrieve again from SQLite
    reloaded = get_user_config(user["id"], db_path=temp_db)
    assert reloaded["selected_card_ids"] == new_cards
    assert reloaded["spend_profile"]["monthly_spend"]["travel_flights_hotels"] == 30000


def test_custom_card_db_persistence(temp_db):
    custom_card = CreditCard(
        id="custom_bank_card",
        name="Custom Super Card",
        bank="MyBank",
        tier="Premium",
        annual_fee=1000,
        base_reward_rate=0.02
    )
    save_card_to_db(custom_card, is_custom=True, db_path=temp_db)

    cards = get_all_cards_from_db(temp_db)
    found = next((c for c in cards if c.id == "custom_bank_card"), None)
    assert found is not None
    assert found.name == "Custom Super Card"
    assert found.base_reward_rate == 0.02
