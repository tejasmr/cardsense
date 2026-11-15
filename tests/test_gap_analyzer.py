import pytest
from src.models import (
    CreditCard,
    SpendProfile,
    PerkWeights,
    CardQuantification
)
from src.engine import CreditCardEngine
from src.gap_analyzer import GapAnalyzer
from src.recommender import Recommender


@pytest.fixture
def engine():
    return CreditCardEngine()


@pytest.fixture
def analyzer():
    return GapAnalyzer()


@pytest.fixture
def recommender(engine):
    return Recommender(engine)


def test_category_gap_detection(engine, analyzer):
    # If user only has a card with 1% base reward (Amazon Pay ICICI)
    # and spends ₹10,000/mo on Dining (where benchmark is 5%), a category coverage gap must be flagged.
    amazon = engine.get_card("icici_amazon_pay")
    cards = [amazon]

    spend = SpendProfile(monthly_spend={"dining_food_delivery": 10000.0})
    quants, routing = engine.analyze_portfolio(cards, spend)
    gaps = analyzer.analyze_gaps(cards, quants, spend, routing)

    cat_gaps = [g for g in gaps if g.gap_type == "category_coverage"]
    assert len(cat_gaps) >= 1
    dining_gap = next((g for g in cat_gaps if g.category_or_perk == "dining_food_delivery"), None)
    assert dining_gap is not None
    assert dining_gap.estimated_annual_loss > 0


def test_missing_lounge_perk_gap(engine, analyzer):
    # SBI Cashback has 0 lounge access
    sbi = engine.get_card("sbi_cashback")
    cards = [sbi]

    spend = SpendProfile(monthly_spend={"online_shopping": 5000.0})
    quants, routing = engine.analyze_portfolio(cards, spend)
    gaps = analyzer.analyze_gaps(cards, quants, spend, routing)

    perk_gaps = [g for g in gaps if g.gap_type == "missing_perk"]
    lounge_gap = next((g for g in perk_gaps if g.category_or_perk == "domestic_airport_lounge"), None)
    assert lounge_gap is not None
    assert "Airport Lounge" in lounge_gap.title


def test_fee_inefficiency_negative_roi(engine, analyzer):
    # User holds a high fee card (Axis Atlas: ₹5000 + 18% GST = ₹5,900) but only spends ₹1,200/year
    # and does not utilize lounges or dining memberships
    atlas = engine.get_card("axis_atlas")
    cards = [atlas]

    weights = PerkWeights(domestic_airport_lounge_multiplier=0.0, dining_membership_multiplier=0.0)
    spend = SpendProfile(monthly_spend={"general_offline": 100.0})  # ₹1200/year spend
    quants, routing = engine.analyze_portfolio(cards, spend, weights)
    gaps = analyzer.analyze_gaps(cards, quants, spend, routing, weights)

    fee_gaps = [g for g in gaps if g.gap_type == "fee_inefficiency"]
    assert len(fee_gaps) >= 1
    neg_roi = next((g for g in fee_gaps if "Negative ROI" in g.title), None)
    assert neg_roi is not None


def test_recommender_suggests_addition_or_replacement(engine, analyzer, recommender):
    # If user has only Amazon Pay ICICI and spends heavy on dining and utilities
    amazon = engine.get_card("icici_amazon_pay")
    cards = [amazon]

    spend = SpendProfile(monthly_spend={
        "utilities_bills": 5000.0,
        "dining_food_delivery": 8000.0,
        "online_shopping": 10000.0
    })
    quants, routing = engine.analyze_portfolio(cards, spend)
    gaps = analyzer.analyze_gaps(cards, quants, spend, routing)
    recs = recommender.generate_recommendations(cards, quants, spend, gaps)

    assert len(recs) > 0
    # Top recs should provide positive net gain
    assert recs[0].projected_net_gain_inr > 0
    # Candidate should likely include Airtel Axis (for 10% utilities & dining) or Swiggy HDFC or HSBC Live+
    rec_card_ids = [r.card_id for r in recs]
    assert any(cid in rec_card_ids for cid in ["axis_airtel", "hdfc_swiggy", "hsbc_live_plus", "sbi_cashback"])
