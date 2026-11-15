import json
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any

from src.models import (
    CreditCard,
    SpendProfile,
    PerkWeights,
    CardQuantification,
    PortfolioAnalysisResult,
    Milestone,
    Perks
)
from src.db import get_all_cards_from_db, init_db


class CreditCardEngine:
    def __init__(self, cards_path: Optional[Path] = None, db_path: Optional[Path] = None):
        self.cards_path = cards_path or Path(__file__).resolve().parent.parent / "data" / "cards.json"
        self.db_path = db_path
        self._cards_catalog: Dict[str, CreditCard] = {}
        init_db(self.db_path)
        self.load_catalog()

    def load_catalog(self) -> None:
        # Load from SQLite database
        db_cards = get_all_cards_from_db(self.db_path)
        if db_cards:
            for card in db_cards:
                self._cards_catalog[card.id] = card
        elif self.cards_path.exists():
            with open(self.cards_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                for item in data.get("cards", []):
                    card = CreditCard(**item)
                    self._cards_catalog[card.id] = card

    def get_catalog(self) -> Dict[str, CreditCard]:
        return self._cards_catalog

    def get_card(self, card_id: str) -> Optional[CreditCard]:
        return self._cards_catalog.get(card_id)

    @staticmethod
    def get_effective_category_rate(card: CreditCard, category: str) -> float:
        """
        Returns the effective INR reward return percentage for a category.
        e.g. If category rate is 5% cashback -> 0.05
        If points: points_rate * point_value_inr
        """
        if category in card.category_exclusions:
            return 0.0

        raw_rate = card.category_rates.get(category, card.base_reward_rate)
        return raw_rate * card.point_value_inr

    def calculate_category_routing(
        self,
        cards: List[CreditCard],
        monthly_spend: Dict[str, float]
    ) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, Dict[str, float]], Dict[str, Dict[str, float]]]:
        """
        Routes each category's spend to the best card in the portfolio.
        Accounts for category monthly caps: if top card has a cap,
        spillover spend is routed to the 2nd best card.

        Returns:
            - routing_info: category -> {best_card_id, rate, monthly_spend, earned_reward}
            - card_monthly_spend: card_id -> {category: spend}
            - card_monthly_rewards: card_id -> {category: reward_inr}
        """
        routing_info: Dict[str, Dict[str, Any]] = {}
        card_monthly_spend: Dict[str, Dict[str, float]] = {c.id: {} for c in cards}
        card_monthly_rewards: Dict[str, Dict[str, float]] = {c.id: {} for c in cards}

        for cat, spend in monthly_spend.items():
            if spend <= 0:
                continue

            # Sort cards by effective return rate descending
            ranked_cards = sorted(
                cards,
                key=lambda c: self.get_effective_category_rate(c, cat),
                reverse=True
            )

            remaining_spend = spend
            cat_routing_cards = []

            for card in ranked_cards:
                if remaining_spend <= 0:
                    break

                rate = self.get_effective_category_rate(card, cat)
                if rate <= 0 and cat != "fuel":
                    # No positive return; still might allocate if nothing else
                    pass

                cap = card.category_caps_monthly.get(cat)

                if cap is not None and rate > 0:
                    # Max spend allowed before hitting cap
                    max_spend_for_cap = cap / rate
                    spend_on_this_card = min(remaining_spend, max_spend_for_cap)
                    reward_earned = spend_on_this_card * rate
                else:
                    spend_on_this_card = remaining_spend
                    reward_earned = spend_on_this_card * rate

                # Check card overall monthly cap if present
                current_card_total_rewards = sum(card_monthly_rewards[card.id].values())
                if card.overall_monthly_reward_cap is not None:
                    headroom = max(0.0, card.overall_monthly_reward_cap - current_card_total_rewards)
                    if reward_earned > headroom:
                        reward_earned = headroom
                        if rate > 0:
                            spend_on_this_card = min(spend_on_this_card, reward_earned / rate)

                # Record spend and reward
                card_monthly_spend[card.id][cat] = (
                    card_monthly_spend[card.id].get(cat, 0.0) + spend_on_this_card
                )
                card_monthly_rewards[card.id][cat] = (
                    card_monthly_rewards[card.id].get(cat, 0.0) + reward_earned
                )

                cat_routing_cards.append({
                    "card_id": card.id,
                    "card_name": card.name,
                    "allocated_spend": spend_on_this_card,
                    "rate_percent": round(rate * 100, 2),
                    "reward_earned": round(reward_earned, 2)
                })

                remaining_spend -= spend_on_this_card

            # If there's still spend unallocated (e.g. all capped or 0% cards), put it on primary card
            if remaining_spend > 0 and cards:
                primary = cards[0]
                card_monthly_spend[primary.id][cat] = (
                    card_monthly_spend[primary.id].get(cat, 0.0) + remaining_spend
                )
                rate = self.get_effective_category_rate(primary, cat)
                card_monthly_rewards[primary.id][cat] = (
                    card_monthly_rewards[primary.id].get(cat, 0.0) + (remaining_spend * rate)
                )

            routing_info[cat] = {
                "category_id": cat,
                "total_monthly_spend": spend,
                "allocations": cat_routing_cards,
                "primary_card_id": cat_routing_cards[0]["card_id"] if cat_routing_cards else cards[0].id,
                "primary_card_name": cat_routing_cards[0]["card_name"] if cat_routing_cards else cards[0].name,
                "effective_rate_percent": cat_routing_cards[0]["rate_percent"] if cat_routing_cards else 0.0
            }

        return routing_info, card_monthly_spend, card_monthly_rewards

    def evaluate_milestones(
        self,
        card: CreditCard,
        annual_spend: float,
        weights: PerkWeights
    ) -> Tuple[float, List[Dict[str, Any]]]:
        """
        Evaluates milestones achieved based on annual spend allocated to the card.
        Returns total milestone value in INR and list of achieved milestones.
        """
        total_milestone_val = 0.0
        achieved = []

        for ms in card.milestones:
            if annual_spend >= ms.spend_threshold_annual:
                if ms.reward_type == "points":
                    val = ms.reward_value * card.point_value_inr
                elif ms.reward_type == "voucher":
                    val = ms.reward_value * weights.milestone_travel_voucher_multiplier
                else:  # cashback
                    val = ms.reward_value

                total_milestone_val += val
                achieved.append({
                    "threshold": ms.spend_threshold_annual,
                    "description": ms.description,
                    "raw_value": ms.reward_value,
                    "effective_value_inr": val
                })

        return total_milestone_val, achieved

    def evaluate_fee(
        self,
        card: CreditCard,
        annual_spend: float
    ) -> Tuple[float, bool]:
        """
        Evaluates effective annual fee including 18% GST and spend-based waiver.
        Returns: (effective_fee_inr, fee_waived_bool)
        """
        if card.is_ltf or card.annual_fee <= 0:
            return 0.0, True

        if card.fee_waiver_spend_annual is not None and annual_spend >= card.fee_waiver_spend_annual:
            return 0.0, True

        effective_fee = card.annual_fee * (1.0 + card.gst_rate)
        return effective_fee, False

    def evaluate_perks(
        self,
        card: CreditCard,
        monthly_fuel_spend: float,
        weights: PerkWeights,
        portfolio_lounge_visits_used: int = 0
    ) -> Tuple[Dict[str, float], float, int]:
        """
        Evaluates non-cash benefits quantified in INR according to user weights.
        Domestic lounge visits are capped realistically across a year (e.g. up to 16/yr per individual).
        """
        # Domestic airport lounge
        # Treat 999 as unlimited (capped at reasonable individual ceiling of 16 visits)
        raw_visits = card.perks.domestic_lounges_per_year
        effective_visits = min(16, raw_visits)
        # Check diminishing return if portfolio already has enough lounge visits
        remaining_individual_capacity = max(0, 16 - portfolio_lounge_visits_used)
        visits_credited = min(effective_visits, remaining_individual_capacity)

        lounge_val = (
            visits_credited
            * weights.domestic_airport_lounge_unit_value
            * weights.domestic_airport_lounge_multiplier
        )

        # Railway lounge
        railway_val = (
            card.perks.railway_lounges_per_year
            * weights.railway_lounge_unit_value
            * weights.railway_lounge_multiplier
        )

        # Movie BOGO
        # Max monthly discount * 12 months * user weight
        movie_val = (
            card.perks.movie_bogo_monthly_max_discount
            * 12.0
            * weights.movie_bogo_multiplier
        )

        # Golf
        golf_rounds = min(12, card.perks.golf_rounds_per_year)
        golf_val = (
            golf_rounds
            * weights.golf_round_unit_value
            * weights.golf_round_multiplier
        )

        # Fuel surcharge waiver
        # 1% waiver on fuel spend, capped at monthly limit
        fuel_val = 0.0
        if card.perks.fuel_surcharge_waiver and monthly_fuel_spend > 0:
            monthly_waiver = min(
                monthly_fuel_spend * 0.01,
                card.perks.fuel_surcharge_monthly_cap
            )
            fuel_val = monthly_waiver * 12.0 * weights.fuel_surcharge_multiplier

        # Dining membership
        dining_val = (
            card.perks.dining_membership_value
            * weights.dining_membership_multiplier
        )

        perk_breakdown = {
            "lounge_value": round(lounge_val, 2),
            "railway_lounge_value": round(railway_val, 2),
            "movie_value": round(movie_val, 2),
            "golf_value": round(golf_val, 2),
            "fuel_waiver_value": round(fuel_val, 2),
            "dining_membership_value": round(dining_val, 2),
        }
        total_perks = sum(perk_breakdown.values())

        return perk_breakdown, total_perks, visits_credited

    def analyze_portfolio(
        self,
        cards: List[CreditCard],
        spend_profile: SpendProfile,
        weights: Optional[PerkWeights] = None
    ) -> Tuple[List[CardQuantification], Dict[str, Any]]:
        """
        Runs comprehensive quantification for the given set of cards under best behavior.
        """
        weights = weights or PerkWeights()

        # Step 1: Best behavior category routing
        routing_info, card_monthly_spend, card_monthly_rewards = self.calculate_category_routing(
            cards, spend_profile.monthly_spend
        )

        # Step 2: Milestone & spend optimization check
        # If a card has high milestone rewards (e.g. Amex Plat Travel requiring ₹4L spend),
        # check if shifting base spend to reach the milestone yields a higher net return.
        cards_quant: List[CardQuantification] = []
        portfolio_lounge_visits = 0

        monthly_fuel = spend_profile.monthly_spend.get("fuel", 0.0)

        for card in cards:
            c_monthly_spend = card_monthly_spend[card.id]
            c_annual_spend = sum(c_monthly_spend.values()) * 12.0

            c_category_annual_spend = {k: v * 12.0 for k, v in c_monthly_spend.items()}
            c_category_annual_rewards = {k: v * 12.0 for k, v in card_monthly_rewards[card.id].items()}
            base_rewards = sum(c_category_annual_rewards.values())

            # Evaluate milestones
            milestone_rewards, _ = self.evaluate_milestones(card, c_annual_spend, weights)
            total_rewards = base_rewards + milestone_rewards

            # Evaluate fees
            effective_fee, fee_waived = self.evaluate_fee(card, c_annual_spend)

            # Evaluate perks
            perks_dict, total_perk_val, visits_used = self.evaluate_perks(
                card, monthly_fuel, weights, portfolio_lounge_visits
            )
            portfolio_lounge_visits += visits_used

            net_val = total_rewards + total_perk_val - effective_fee
            yield_pct = (net_val / c_annual_spend * 100.0) if c_annual_spend > 0 else 0.0

            quant = CardQuantification(
                card_id=card.id,
                card_name=card.name,
                bank=card.bank,
                tier=card.tier,
                allocated_annual_spend=round(c_annual_spend, 2),
                category_spend=c_category_annual_spend,
                category_rewards=c_category_annual_rewards,
                base_rewards_earned=round(base_rewards, 2),
                milestone_rewards_earned=round(milestone_rewards, 2),
                total_rewards_earned=round(total_rewards, 2),
                effective_annual_fee=round(effective_fee, 2),
                fee_waived=fee_waived,
                fee_waiver_threshold=card.fee_waiver_spend_annual,
                lounge_value=perks_dict["lounge_value"],
                railway_lounge_value=perks_dict["railway_lounge_value"],
                movie_value=perks_dict["movie_value"],
                golf_value=perks_dict["golf_value"],
                fuel_waiver_value=perks_dict["fuel_waiver_value"],
                dining_membership_value=perks_dict["dining_membership_value"],
                total_perk_value=round(total_perk_val, 2),
                net_value=round(net_val, 2),
                net_yield_percent=round(yield_pct, 2)
            )
            cards_quant.append(quant)

        return cards_quant, routing_info
