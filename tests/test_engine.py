import pytest
from src.models import (
    CreditCard,
    SpendProfile,
    PerkWeights,
    Milestone,
    Perks
)
from src.engine import CreditCardEngine


@pytest.fixture
def engine():
    return CreditCardEngine()


def test_catalog_loaded(engine):
    catalog = engine.get_catalog()
    assert len(catalog) >= 14
    assert "hdfc_infinia_metal" in catalog
    assert "sbi_cashback" in catalog
    assert "icici_amazon_pay" in catalog
    assert "axis_airtel" in catalog


def test_effective_category_rate(engine):
    sbi = engine.get_card("sbi_cashback")
    assert sbi is not None
    # 5% on online shopping
    assert engine.get_effective_category_rate(sbi, "online_shopping") == 0.05
    # Excluded fuel should be 0.0
    assert engine.get_effective_category_rate(sbi, "fuel") == 0.0


def test_best_behavior_routing_and_caps(engine):
    # Test routing between SBI Cashback (5% online) and Amazon Pay ICICI (5% Amazon / 1% base)
    sbi = engine.get_card("sbi_cashback")
    amazon = engine.get_card("icici_amazon_pay")
    cards = [sbi, amazon]

    # SBI has 5000/mo cap on 5% cashback (= ₹1,00,000 spend)
    # If user spends ₹1,50,000 online:
    # First ₹1,00,000 should get ₹5,000 on SBI
    # Remaining ₹50,000 should spill over to Amazon Pay ICICI (or next best)
    monthly_spend = {"online_shopping": 150000.0}
    routing, card_spend, card_rewards = engine.calculate_category_routing(cards, monthly_spend)

    assert "online_shopping" in routing
    assert card_rewards[sbi.id]["online_shopping"] == 5000.0
    assert card_spend[sbi.id]["online_shopping"] == 100000.0
    assert card_spend[amazon.id]["online_shopping"] == 50000.0


def test_fee_waiver_with_gst(engine):
    airtel = engine.get_card("axis_airtel")
    assert airtel is not None
    assert airtel.annual_fee == 500.0
    assert airtel.gst_rate == 0.18
    # 500 * 1.18 = 590
    fee_below_waiver, waived = engine.evaluate_fee(airtel, 150000.0)
    assert not waived
    assert fee_below_waiver == 590.0

    # Waiver threshold is 200,000
    fee_above_waiver, waived_ok = engine.evaluate_fee(airtel, 200000.0)
    assert waived_ok
    assert fee_above_waiver == 0.0


def test_milestone_evaluation(engine):
    amex_plat = engine.get_card("amex_plat_travel")
    assert amex_plat is not None

    weights = PerkWeights(milestone_travel_voucher_multiplier=1.0)
    # Spend ₹4,00,000 should trigger both 1.9L and 4.0L milestones
    val, achieved = engine.evaluate_milestones(amex_plat, 400000.0, weights)
    assert len(achieved) == 2
    # 11,500 + 28,500 = 40,000
    assert val == 40000.0


def test_perk_weights_multipliers(engine):
    regalia = engine.get_card("hdfc_regalia_gold")
    assert regalia is not None

    # Normal weights: 12 domestic lounges * 1000 = 12000
    w_normal = PerkWeights(domestic_airport_lounge_multiplier=1.0, domestic_airport_lounge_unit_value=1000.0)
    perks_normal, total_normal, _ = engine.evaluate_perks(regalia, monthly_fuel_spend=0.0, weights=w_normal)
    assert perks_normal["lounge_value"] == 12000.0

    # User who never flies: multiplier = 0
    w_zero = PerkWeights(domestic_airport_lounge_multiplier=0.0)
    perks_zero, total_zero, _ = engine.evaluate_perks(regalia, monthly_fuel_spend=0.0, weights=w_zero)
    assert perks_zero["lounge_value"] == 0.0
