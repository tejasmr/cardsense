from typing import List, Dict, Any, Optional
from src.models import (
    CreditCard,
    SpendProfile,
    PerkWeights,
    CardQuantification,
    Gap,
    Recommendation
)
from src.engine import CreditCardEngine


class Recommender:
    def __init__(self, engine: CreditCardEngine):
        self.engine = engine

    def generate_recommendations(
        self,
        current_cards: List[CreditCard],
        current_quants: List[CardQuantification],
        spend_profile: SpendProfile,
        gaps: List[Gap],
        weights: Optional[PerkWeights] = None,
        max_recommendations: int = 5
    ) -> List[Recommendation]:
        weights = weights or PerkWeights()
        catalog = self.engine.get_catalog()
        current_ids = {c.id for c in current_cards}

        # Calculate current baseline portfolio net value
        current_total_net = sum(q.net_value for q in current_quants)

        recommendations: List[Recommendation] = []

        # Candidate cards in catalog not currently owned
        candidates = [c for c in catalog.values() if c.id not in current_ids]

        # -----------------------------------------------------------------
        # 1. Evaluate ADDITIONS
        # -----------------------------------------------------------------
        for cand in candidates:
            test_portfolio = current_cards + [cand]
            test_quants, _ = self.engine.analyze_portfolio(test_portfolio, spend_profile, weights)
            new_total_net = sum(q.net_value for q in test_quants)

            net_gain = new_total_net - current_total_net

            # Find what features are gained
            features_gained = []
            for gap in gaps:
                if gap.gap_type == "category_coverage":
                    rate = self.engine.get_effective_category_rate(cand, gap.category_or_perk)
                    if rate >= 0.05:
                        features_gained.append(f"{rate*100:.1f}% on {gap.title.replace('Suboptimal Rewards on ', '')}")
                elif gap.gap_type == "missing_perk":
                    if gap.category_or_perk == "domestic_airport_lounge" and cand.perks.domestic_lounges_per_year > 0:
                        features_gained.append(f"{cand.perks.domestic_lounges_per_year} Domestic Lounge Visits")
                    elif gap.category_or_perk == "movie_bogo_ticket" and cand.perks.movie_bogo_monthly_max_discount > 0:
                        features_gained.append("Movie BOGO BMS/PVR")
                    elif gap.category_or_perk == "fuel_surcharge_waiver" and cand.perks.fuel_surcharge_waiver:
                        features_gained.append("1% Fuel Surcharge Waiver")
                    elif gap.category_or_perk == "rupay_upi" and cand.rupay_upi_enabled:
                        features_gained.append("RuPay UPI scan-to-pay")

            if cand.rupay_upi_enabled and "RuPay UPI scan-to-pay" not in features_gained:
                features_gained.append("RuPay UPI scan-to-pay enabled")

            if net_gain > 500 or (net_gain >= 0 and len(features_gained) > 0):
                reason = (
                    f"Adding {cand.name} increases your net annual return by ₹{net_gain:,.0f} "
                    f"after factoring in fees + 18% GST."
                )
                if features_gained:
                    reason += f" Plugs key gaps: {', '.join(features_gained[:2])}."

                recommendations.append(Recommendation(
                    action="add",
                    card_id=cand.id,
                    card_name=cand.name,
                    replaces_card_id=None,
                    replaces_card_name=None,
                    reason=reason,
                    projected_net_gain_inr=round(net_gain, 2),
                    new_portfolio_net_value=round(new_total_net, 2),
                    key_features_gained=features_gained[:4]
                ))

        # -----------------------------------------------------------------
        # 2. Evaluate REPLACEMENTS for Underperforming / Negative Yield Cards
        # -----------------------------------------------------------------
        underperforming = [q for q in current_quants if q.net_value < 1000]

        for under_q in underperforming:
            orig_card = next((c for c in current_cards if c.id == under_q.card_id), None)
            if not orig_card:
                continue

            # Remaining portfolio without this card
            portfolio_without = [c for c in current_cards if c.id != under_q.card_id]

            for cand in candidates:
                test_portfolio = portfolio_without + [cand]
                test_quants, _ = self.engine.analyze_portfolio(test_portfolio, spend_profile, weights)
                new_total_net = sum(q.net_value for q in test_quants)

                net_gain = new_total_net - current_total_net

                if net_gain > 1000:
                    features_gained = []
                    if cand.is_ltf and not orig_card.is_ltf:
                        features_gained.append("Eliminates Annual Fee (Lifetime Free)")
                    if cand.perks.domestic_lounges_per_year > orig_card.perks.domestic_lounges_per_year:
                        features_gained.append(f"{cand.perks.domestic_lounges_per_year} Lounge visits")
                    if cand.rupay_upi_enabled and not orig_card.rupay_upi_enabled:
                        features_gained.append("RuPay UPI enabled")

                    recommendations.append(Recommendation(
                        action="replace",
                        card_id=cand.id,
                        card_name=cand.name,
                        replaces_card_id=orig_card.id,
                        replaces_card_name=orig_card.name,
                        reason=(
                            f"Replace {orig_card.name} (which currently yields ₹{under_q.net_value:,.0f}/yr) "
                            f"with {cand.name} to gain an extra ₹{net_gain:,.0f} net annual return."
                        ),
                        projected_net_gain_inr=round(net_gain, 2),
                        new_portfolio_net_value=round(new_total_net, 2),
                        key_features_gained=features_gained[:4]
                    ))

        # Sort recommendations by projected net gain descending
        recommendations.sort(key=lambda r: r.projected_net_gain_inr, reverse=True)
        return recommendations[:max_recommendations]
