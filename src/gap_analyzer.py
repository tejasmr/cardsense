from typing import List, Dict, Any, Optional
from src.models import (
    CreditCard,
    SpendProfile,
    PerkWeights,
    CardQuantification,
    Gap
)


class GapAnalyzer:
    def __init__(self, categories_info: Optional[List[Dict[str, Any]]] = None):
        # Default benchmarks for Indian domestic market
        self.category_benchmarks = {
            "dining_food_delivery": {"name": "Dining & Food Delivery", "benchmark": 0.05, "top_card_desc": "Swiggy HDFC (10%) or HSBC Live+ (10%)"},
            "groceries": {"name": "Groceries & Supermarkets", "benchmark": 0.05, "top_card_desc": "Tata Neu Infinity (10%) or Airtel Axis (10%)"},
            "online_shopping": {"name": "Online Shopping & E-Commerce", "benchmark": 0.05, "top_card_desc": "SBI Cashback (5%) or Amazon Pay ICICI (5%)"},
            "utilities_bills": {"name": "Utilities & Bill Payments", "benchmark": 0.05, "top_card_desc": "Airtel Axis (10%) or Axis Ace (5%)"},
            "travel_flights_hotels": {"name": "Travel (Flights & Hotels)", "benchmark": 0.05, "top_card_desc": "HDFC Infinia (16.6%) or Axis Atlas (10%)"},
            "fuel": {"name": "Fuel Surcharge", "benchmark": 0.01, "top_card_desc": "Cards with 1% surcharge waiver"},
            "movies_entertainment": {"name": "Movies & Entertainment", "benchmark": 0.05, "top_card_desc": "ICICI Sapphiro (BOGO BMS) or SBI SimplyCLICK"},
            "general_offline": {"name": "General Offline Spends", "benchmark": 0.015, "top_card_desc": "Axis Ace (1.5%) or HSBC Live+ (1.5%)"}
        }

    def analyze_gaps(
        self,
        cards: List[CreditCard],
        cards_quant: List[CardQuantification],
        spend_profile: SpendProfile,
        routing_info: Dict[str, Dict[str, Any]],
        weights: Optional[PerkWeights] = None
    ) -> List[Gap]:
        gaps: List[Gap] = []
        weights = weights or PerkWeights()

        # -------------------------------------------------------------
        # 1. Category Coverage Gaps
        # -------------------------------------------------------------
        for cat_id, info in self.category_benchmarks.items():
            monthly_spend = spend_profile.monthly_spend.get(cat_id, 0.0)
            annual_spend = monthly_spend * 12.0
            if annual_spend <= 0:
                continue

            # What was the effective rate obtained?
            route = routing_info.get(cat_id, {})
            current_rate = (route.get("effective_rate_percent", 0.0)) / 100.0
            benchmark_rate = info["benchmark"]

            if current_rate < (benchmark_rate * 0.6):  # Underperforming benchmark by >40%
                gap_diff = benchmark_rate - current_rate
                annual_loss = round(annual_spend * gap_diff, 2)

                severity = "high" if annual_loss > 3000 else ("medium" if annual_loss > 1000 else "low")

                gaps.append(Gap(
                    gap_type="category_coverage",
                    title=f"Suboptimal Rewards on {info['name']}",
                    severity=severity,
                    description=(
                        f"You are spending ₹{annual_spend:,.0f}/year on {info['name']}, but your best card yields "
                        f"only {current_rate * 100:.1f}%. Top cards in the market offer {benchmark_rate * 100:.1f}%+ "
                        f"({info['top_card_desc']})."
                    ),
                    category_or_perk=cat_id,
                    current_value=f"{current_rate * 100:.1f}%",
                    benchmark_value=f"{benchmark_rate * 100:.1f}%",
                    estimated_annual_loss=annual_loss
                ))

        # -------------------------------------------------------------
        # 2. Missing Perk Gaps
        # -------------------------------------------------------------
        # Airport Lounge
        total_lounges = sum(c.perks.domestic_lounges_per_year for c in cards)
        if total_lounges == 0 and weights.domestic_airport_lounge_multiplier > 0:
            est_loss = 4 * weights.domestic_airport_lounge_unit_value * weights.domestic_airport_lounge_multiplier
            gaps.append(Gap(
                gap_type="missing_perk",
                title="No Airport Lounge Access",
                severity="high",
                description="None of your current cards provide complimentary domestic airport lounge access.",
                category_or_perk="domestic_airport_lounge",
                current_value="0 visits",
                benchmark_value="4-12 visits/year",
                estimated_annual_loss=round(est_loss, 2)
            ))

        # Movie BOGO
        has_movie_bogo = any(c.perks.movie_bogo_monthly_max_discount > 0 for c in cards)
        movie_spend = spend_profile.monthly_spend.get("movies_entertainment", 0.0)
        if not has_movie_bogo and movie_spend > 500 and weights.movie_bogo_multiplier > 0:
            est_loss = min(movie_spend, 500) * 12 * 0.5 * weights.movie_bogo_multiplier
            gaps.append(Gap(
                gap_type="missing_perk",
                title="Missing Movie Ticket BOGO Benefit",
                severity="medium",
                description="You spend on movies & entertainment, but lack a card offering 1+1 BookMyShow/PVR ticket discounts (saving up to ₹500/month).",
                category_or_perk="movie_bogo_ticket",
                current_value="None",
                benchmark_value="Buy 1 Get 1 free (up to ₹500/mo)",
                estimated_annual_loss=round(est_loss, 2)
            ))

        # Fuel Surcharge Waiver
        fuel_spend = spend_profile.monthly_spend.get("fuel", 0.0)
        has_fuel_waiver = any(c.perks.fuel_surcharge_waiver for c in cards)
        if not has_fuel_waiver and fuel_spend > 0:
            est_loss = fuel_spend * 0.01 * 12
            gaps.append(Gap(
                gap_type="missing_perk",
                title="Missing Fuel Surcharge Waiver",
                severity="medium" if est_loss > 600 else "low",
                description="You spend on fuel without a card that waives the standard 1% fuel surcharge.",
                category_or_perk="fuel_surcharge_waiver",
                current_value="No waiver",
                benchmark_value="1% waiver on ₹400-₹4,000 spends",
                estimated_annual_loss=round(est_loss, 2)
            ))

        # UPI on RuPay
        has_rupay = any(c.rupay_upi_enabled for c in cards)
        if not has_rupay:
            gaps.append(Gap(
                gap_type="missing_perk",
                title="No RuPay UPI Credit Card",
                severity="medium",
                description="You do not have a RuPay credit card linked to UPI to earn rewards on scan-and-pay transactions at local merchants.",
                category_or_perk="rupay_upi",
                current_value="None",
                benchmark_value="1.5% cashback/coins on UPI",
                estimated_annual_loss=round(spend_profile.monthly_spend.get("general_offline", 0.0) * 0.015 * 6, 2)
            ))

        # -------------------------------------------------------------
        # 3. Fee Inefficiencies & Overlaps
        # -------------------------------------------------------------
        for q in cards_quant:
            # Negative Net Yield (Fee > Total Rewards + Perks)
            if q.net_value < 0 and q.effective_annual_fee > 0:
                gaps.append(Gap(
                    gap_type="fee_inefficiency",
                    title=f"Negative ROI on {q.card_name}",
                    severity="high",
                    description=(
                        f"You are paying ₹{q.effective_annual_fee:,.0f} in annual fee + GST for {q.card_name}, "
                        f"but only generating ₹{q.total_rewards_earned + q.total_perk_value:,.0f} in rewards & perks. "
                        f"You have a net annual loss of ₹{abs(q.net_value):,.0f} holding this card."
                    ),
                    category_or_perk=q.card_id,
                    current_value=f"-₹{abs(q.net_value):,.0f}",
                    benchmark_value="Positive Net Return (> ₹0)",
                    estimated_annual_loss=round(abs(q.net_value), 2)
                ))

            # Missed fee waiver threshold
            if (
                not q.fee_waived
                and q.fee_waiver_threshold is not None
                and q.allocated_annual_spend > 0
                and q.allocated_annual_spend >= (q.fee_waiver_threshold * 0.75)
            ):
                shortfall = q.fee_waiver_threshold - q.allocated_annual_spend
                gaps.append(Gap(
                    gap_type="fee_inefficiency",
                    title=f"Close to Fee Waiver on {q.card_name}",
                    severity="medium",
                    description=(
                        f"You are only ₹{shortfall:,.0f} away from waiving the ₹{q.effective_annual_fee:,.0f} annual fee "
                        f"on {q.card_name} (Threshold: ₹{q.fee_waiver_threshold:,.0f}). Rerouting minor spend could eliminate this fee."
                    ),
                    category_or_perk=q.card_id,
                    current_value=f"Spend: ₹{q.allocated_annual_spend:,.0f}",
                    benchmark_value=f"Waiver Target: ₹{q.fee_waiver_threshold:,.0f}",
                    estimated_annual_loss=round(q.effective_annual_fee, 2)
                ))

            # Idle paid card
            if q.effective_annual_fee > 0 and q.allocated_annual_spend < 10000 and (q.lounge_value + q.movie_value) == 0:
                gaps.append(Gap(
                    gap_type="fee_inefficiency",
                    title=f"Underutilized Paid Card: {q.card_name}",
                    severity="high",
                    description=(
                        f"{q.card_name} has an annual fee of ₹{q.effective_annual_fee:,.0f}, but virtually no spend (₹{q.allocated_annual_spend:,.0f}) "
                        f"is routed to it and no perks are utilized. Consider closing or replacing this card."
                    ),
                    category_or_perk=q.card_id,
                    current_value=f"Spend: ₹{q.allocated_annual_spend:,.0f}",
                    benchmark_value="Active Utilization",
                    estimated_annual_loss=round(q.effective_annual_fee, 2)
                ))

        # Redundant lounge cards
        cards_with_lounge = [q for q in cards_quant if q.lounge_value > 0]
        if len(cards_with_lounge) >= 3:
            total_lounge_visits = sum(
                next(c.perks.domestic_lounges_per_year for c in cards if c.id == q.card_id)
                for q in cards_with_lounge
            )
            if total_lounge_visits > 20:
                paid_lounge_cards = [q for q in cards_with_lounge if q.effective_annual_fee > 0]
                if len(paid_lounge_cards) > 1:
                    gaps.append(Gap(
                        gap_type="fee_inefficiency",
                        title="Redundant Paid Lounge Cards",
                        severity="low",
                        description=(
                            f"Your portfolio offers {total_lounge_visits} lounge visits across {len(cards_with_lounge)} cards. "
                            f"You are paying annual fees on multiple cards for lounge perks you likely cannot fully consume."
                        ),
                        category_or_perk="lounge_redundancy",
                        current_value=f"{total_lounge_visits} visits",
                        benchmark_value="8-12 visits",
                        estimated_annual_loss=0.0
                    ))

        return gaps
