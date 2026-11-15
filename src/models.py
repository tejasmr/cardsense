from typing import Dict, List, Optional, Any
from pydantic import BaseModel, Field


class Milestone(BaseModel):
    spend_threshold_annual: float
    reward_type: str  # "points", "voucher", "cashback"
    reward_value: float
    voucher_type: Optional[str] = None  # "flight", "hotel", "general"
    description: str


class Perks(BaseModel):
    domestic_lounges_per_year: int = 0
    railway_lounges_per_year: int = 0
    movie_bogo_monthly_max_discount: float = 0.0
    movie_bogo_tickets_per_month: int = 0
    golf_rounds_per_year: int = 0
    fuel_surcharge_waiver: bool = False
    fuel_surcharge_monthly_cap: float = 0.0
    dining_membership_name: Optional[str] = None
    dining_membership_value: float = 0.0


class CreditCard(BaseModel):
    id: str
    name: str
    bank: str
    network: str = "Visa"
    tier: str = "Mid"
    annual_fee: float = 0.0
    gst_rate: float = 0.18
    fee_waiver_spend_annual: Optional[float] = None
    joining_fee: float = 0.0
    is_ltf: bool = False
    reward_type: str = "cashback"  # "cashback", "points", "miles"
    point_value_inr: float = 1.0
    base_reward_rate: float = 0.01  # e.g., 0.01 for 1%
    category_rates: Dict[str, float] = Field(default_factory=dict)
    category_caps_monthly: Dict[str, float] = Field(default_factory=dict)
    category_exclusions: List[str] = Field(default_factory=list)
    overall_monthly_reward_cap: Optional[float] = None
    milestones: List[Milestone] = Field(default_factory=list)
    perks: Perks = Field(default_factory=Perks)
    rupay_upi_enabled: bool = False
    key_highlights: List[str] = Field(default_factory=list)
    source_url: Optional[str] = None


class SpendProfile(BaseModel):
    # Category ID -> Monthly Spend in INR
    monthly_spend: Dict[str, float] = Field(default_factory=dict)

    def total_monthly_spend(self) -> float:
        return sum(self.monthly_spend.values())

    def total_annual_spend(self) -> float:
        return self.total_monthly_spend() * 12.0


class PerkWeights(BaseModel):
    # Multipliers (0.0 to 2.0)
    domestic_airport_lounge_multiplier: float = 1.0
    railway_lounge_multiplier: float = 1.0
    movie_bogo_multiplier: float = 1.0
    golf_round_multiplier: float = 1.0
    milestone_travel_voucher_multiplier: float = 0.85
    dining_membership_multiplier: float = 1.0
    fuel_surcharge_multiplier: float = 1.0

    # Custom Unit Cash Valuations in INR
    domestic_airport_lounge_unit_value: float = 1000.0
    railway_lounge_unit_value: float = 300.0
    movie_bogo_ticket_unit_value: float = 250.0
    golf_round_unit_value: float = 1500.0


class CardQuantification(BaseModel):
    card_id: str
    card_name: str
    bank: str
    tier: str
    allocated_annual_spend: float
    category_spend: Dict[str, float]
    category_rewards: Dict[str, float]
    base_rewards_earned: float
    milestone_rewards_earned: float
    total_rewards_earned: float
    effective_annual_fee: float
    fee_waived: bool
    fee_waiver_threshold: Optional[float]
    lounge_value: float
    railway_lounge_value: float
    movie_value: float
    golf_value: float
    fuel_waiver_value: float
    dining_membership_value: float
    total_perk_value: float
    net_value: float  # (total_rewards_earned + total_perk_value - effective_annual_fee)
    net_yield_percent: float


class Gap(BaseModel):
    gap_type: str  # "category_coverage", "missing_perk", "fee_inefficiency"
    title: str
    severity: str  # "high", "medium", "low", "warning"
    description: str
    category_or_perk: str
    current_value: Any
    benchmark_value: Any
    estimated_annual_loss: float = 0.0


class Recommendation(BaseModel):
    action: str  # "add", "replace", "drop"
    card_id: str
    card_name: str
    replaces_card_id: Optional[str] = None
    replaces_card_name: Optional[str] = None
    reason: str
    projected_net_gain_inr: float
    new_portfolio_net_value: float
    key_features_gained: List[str]


class PortfolioAnalysisResult(BaseModel):
    total_annual_spend: float
    total_annual_rewards: float
    total_perk_value: float
    total_fees_paid: float
    net_annual_value: float
    net_portfolio_yield_percent: float
    best_spend_routing: Dict[str, Dict[str, Any]]
    cards_summary: List[CardQuantification]
    gaps: List[Gap]
    recommendations: List[Recommendation]


class AnalyzeRequest(BaseModel):
    selected_card_ids: List[str]
    spend_profile: SpendProfile
    weights: Optional[PerkWeights] = None
    custom_cards: Optional[List[CreditCard]] = None


# --- User Management & Google Auth Models ---

class GoogleAuthRequest(BaseModel):
    credential: Optional[str] = None  # Google JWT ID token
    google_id: Optional[str] = None
    email: Optional[str] = None
    full_name: Optional[str] = None
    avatar_url: Optional[str] = None


class UserProfile(BaseModel):
    id: int
    google_id: str
    email: str
    full_name: Optional[str] = None
    avatar_url: Optional[str] = None
    created_at: Optional[str] = None


class AuthResponse(BaseModel):
    token: str
    user: UserProfile


class UserConfigResponse(BaseModel):
    user_id: int
    selected_card_ids: List[str]
    spend_profile: SpendProfile
    weights: PerkWeights


class SaveUserConfigRequest(BaseModel):
    selected_card_ids: List[str]
    spend_profile: SpendProfile
    weights: PerkWeights
