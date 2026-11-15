# CardSense India: Domestic Credit Card Optimization & Portfolio Gap Analyzer

A comprehensive, mathematically rigorous credit card benefit and cost quantification engine built for the **Indian Domestic Credit Card market (INR)**.

It models **best-behavior cardholder spending**, quantifies rewards, milestone vouchers, non-cash perks, annual fees (including **18% GST**), spend-based fee waivers, and detects portfolio gaps with smart card addition and replacement recommendations.

---

## Key Features

### 1. "Best Behavior" Spend Routing Engine
* **Optimal Category Allocation**: Simulates an informed user routing each domestic spend category to the highest-yielding card in their portfolio.
* **Monthly Reward Caps & Spillover**: Respects category-specific caps (e.g., Swiggy HDFC ₹1,500/mo cap, SBI Cashback ₹5,000/mo limit) and automatically diverts spillover spend to the second-best card.
* **18% GST on Fees**: Factors in Indian GST regulations (18% on annual and joining fees).
* **Spend-Based Fee Waivers**: Automatically eliminates annual renewal fees when allocated annual spend meets or exceeds the card's waiver threshold (e.g. ₹2,00,000 on SBI Cashback / Airtel Axis).
* **Milestone Rewards Optimization**: Triggers milestone rewards (e.g. Amex Platinum Travel ₹4L spend yielding ₹10k Taj voucher + ₹10k IndiGo flight vouchers + 40k MR points; Regalia Gold quarterly vouchers).

### 2. User Preference & Perk Weighting
* Users can adjust importance multipliers (`0.0x` to `2.0x`) and custom cash valuations for:
  * **Domestic Airport Lounges**: (Default: ₹1,000/visit with realistic annual capacity caps)
  * **Railway Lounges**: (Default: ₹300/visit)
  * **Movie Ticket BOGO**: (Buy-1-Get-1 free on BookMyShow/PVR/INOX, e.g. up to ₹500/month)
  * **Complimentary Golf**: (Default: ₹1,500/round)
  * **Milestone Travel / Hotel Vouchers**: (Default: 0.85x realization factor relative to cash)
  * **Dining Memberships**: (Swiggy One, EazyDiner Prime, etc.)
  * **Fuel Surcharge Waiver**: (1% waiver between ₹400 and ₹4,000 transactions)

### 3. Portfolio Gap & Inefficiency Detection
* **Category Coverage Gaps**: Identifies high-spend categories where current cards yield sub-benchmark returns (e.g., spending ₹10,000/mo on Dining with only 1% return when 10% is available in the market).
* **Missing Perk Gaps**: Identifies absent privileges such as domestic airport lounge access, movie BOGOs, fuel surcharge waivers, or RuPay credit card linking for UPI QR payments.
* **Fee Inefficiencies**:
  * **Negative ROI Cards**: Flags cards where the annual fee + 18% GST exceeds the generated rewards and utilized perks.
  * **Near-Miss Fee Waivers**: Alerts user when spend is just short of eliminating the renewal fee.
  * **Idle Paid Cards**: Paid cards with negligible utilization.
  * **Lounge Redundancy**: Paying multiple annual fees for overlapping lounge quotas.

### 4. Algorithmic Recommendations (Add / Replace)
* Evaluates every candidate card in the verified catalog.
* Calculates the **Marginal Net Gain** (`New Portfolio Net Value - Current Portfolio Net Value`) factoring in the new card's annual fee + 18% GST.
* Suggests replacements for negative ROI or underutilized cards.
* 1-Click "Add to Portfolio" or "Swap Cards" in the web dashboard.

### 5. SQLite Database & User-Level Configuration (Google OAuth Exclusive)
* **Exclusive Sign-In with Google**:
  * All user accounts and sessions are authenticated strictly via Google Identity.
  * Supports Google Identity Services (GIS) One Tap / button with client-side credential verification.
  * Extensible with environment variable `GOOGLE_CLIENT_ID`.
  * Pre-configured with quick Google test user profiles for local testing.
* **Relational SQLite Storage (`data/cc_analysis.db`)**:
  * `users`: Stores Google account data (`google_id`, `email`, `full_name`, `avatar_url`, `created_at`).
  * `sessions`: Token-based session management (`Bearer <token>`).
  * `cards`: Relational database catalog of domestic cards with JSON attributes.
  * `user_portfolios`: Stores active user cards with custom display order.
  * `user_spend_profiles`: Persists user-defined monthly category spends.
  * `user_perk_weights`: Persists custom valuations and multipliers per user.
* **1-Click "Save to DB"**: Syncs your custom card selection, spend breakdown, and perk weights directly to your SQLite profile.
* **Authenticated Analysis (`POST /api/user/analyze`)**: Runs complete portfolio optimization directly on your saved profile in the database.

---

## Verified Indian Domestic Card Catalog Included
Pre-loaded with verified data:
* **HDFC Bank**: Infinia Metal, Regalia Gold, Millennia, Tata Neu Infinity (RuPay), Swiggy HDFC
* **SBI Card**: SBI Cashback, SimplyCLICK
* **ICICI Bank**: Amazon Pay ICICI (Lifetime Free), Sapphiro Dual Card (BOGO BMS, Lounges, Golf)
* **Axis Bank**: Airtel Axis (10% utilities & dining), Axis Atlas (Miles ecosystem), Axis Ace (5% GPay bills, 1.5% flat)
* **American Express**: Platinum Travel (high-yield milestones), Membership Rewards (MRCC)
* **HSBC India**: HSBC Live+ (10% dining & groceries)
* **IDFC FIRST Bank**: IDFC FIRST Wealth (Lifetime Free premium card)
* *Plus custom card builder to add any custom or emerging cards.*

---

## Quick Start

### 1. Requirements
* Python 3.10+ (Tested on Python 3.14)
* Packages: `fastapi`, `uvicorn`, `pydantic`, `pytest`

### 2. Run the Dashboard
```bash
python run.py
```
Open your browser to:
```
http://127.0.0.1:8000
```
*(Note: To allow access from external browser on Windows if running in an isolated environment, run with standard network access).*

### 3. Run Automated Tests
```bash
python -m pytest
```

---

## Project Structure
```
cc_analysis/
├── data/
│   ├── cards.json           # Verified Indian domestic credit card database
│   ├── categories.json      # Domestic spend categories and benchmark rates
│   └── default_perks.json   # Default benchmark monetary values for non-cash perks
├── src/
│   ├── models.py            # Pydantic data models
│   ├── engine.py            # Best-behavior optimization & calculation engine
│   ├── gap_analyzer.py      # Category, perk, and fee inefficiency analyzer
│   ├── recommender.py       # Portfolio addition & replacement recommender
│   └── api.py               # FastAPI backend & REST endpoints
├── static/
│   ├── index.html           # Modern responsive dashboard UI
│   ├── app.js               # Reactive frontend logic & dynamic portfolio updating
│   └── style.css            # Custom UI styles
├── tests/
│   ├── test_engine.py       # Engine calculation & fee waiver tests
│   ├── test_gap_analyzer.py # Gap detection & recommender tests
│   └── test_api.py          # API endpoint tests
├── .gitignore               # Standard Python & IDE ignore patterns
├── pytest.ini               # Pytest configuration
├── requirements.txt         # Dependencies
└── run.py                   # Application launcher
```
