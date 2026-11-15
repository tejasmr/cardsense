# CardSense India: Domestic Credit Card Optimization & Portfolio Gap Analyzer

A comprehensive, mathematically rigorous credit card benefit and cost quantification engine built for the **Indian Domestic Credit Card market (INR)**.

Hosted **100% serverless on GitHub Pages** and backed privately by your own **Google Sheet database via Google Apps Script**.

---

## Key Features

### 1. "Best Behavior" Spend Routing Engine
* **Optimal Category Allocation**: Simulates an informed user routing each domestic spend category to the highest-yielding card in their portfolio.
* **Monthly Reward Caps & Spillover**: Respects category-specific caps (e.g., Swiggy HDFC ₹1,500/mo cap, SBI Cashback ₹5,000/mo limit) and automatically diverts spillover spend to the second-best card.
* **18% GST on Fees**: Factors in Indian GST regulations (18% on annual and renewal fees).
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

### 5. Private Google Sheets Backend with Email Allowlist
* **Zero Hosting Costs**: Completely free, hosted directly via GitHub Pages and Google Apps Script.
* **Strict Allowlist Security**: Access is restricted strictly to emails you add in the `allowed_users` tab of your Google Sheet.
* **Cloud Sync**: Save and sync custom card selections, monthly spend breakdowns, and perk weights to your Google Sheet.

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

## Deployment & Setup

### 1. Google Sheets Backend Setup
1. Create a new Google Sheet named **`CardSense_DB`**.
2. Go to **Extensions** &rarr; **Apps Script**.
3. Paste the contents of [`google_sheets_backend/Code.gs`](google_sheets_backend/Code.gs) into `Code.gs`.
4. Run `setupSpreadsheet` once from the Apps Script editor to initialize the tabs (`allowed_users`, `user_configs`, `custom_cards`).
5. In the `allowed_users` tab of your Google Sheet, add the Gmail address(es) you want to permit.
6. Click **Deploy** &rarr; **New deployment**:
   - **Type**: Web app
   - **Execute as**: Me
   - **Who has access**: Anyone *(essential for GitHub Pages cross-origin sync; your script verifies email against `allowed_users`)*
7. Copy the generated Web App URL (`.../exec`).

### 2. GitHub Pages Deployment
1. In your GitHub repository, go to **Settings** &rarr; **Secrets and variables** &rarr; **Actions**.
2. Add a repository secret named **`GOOGLE_SHEET_URL`** with your Apps Script Web App URL.
3. Under **Settings** &rarr; **Pages**, set **Source** to **GitHub Actions**.
4. Push to `main` branch — GitHub Actions will automatically inject the secret into `config.js` and deploy your site!

---

## Project Structure
```
cc_analysis/
├── .github/
│   └── workflows/
│       └── deploy.yml          # GitHub Actions deployment to GitHub Pages
├── data/
│   ├── catalog.json            # Pre-bundled offline card database
│   ├── cards.json              # Source card definitions
│   ├── categories.json         # Domestic spend categories & benchmarks
│   └── default_perks.json      # Benchmark values for non-cash perks
├── google_sheets_backend/
│   └── Code.gs                 # Google Apps Script Web App backend
├── static/
│   ├── app.js                  # Frontend application logic & Sheet sync
│   ├── config.js               # Deployment secret injection template
│   ├── engine.js               # In-browser JavaScript calculation engine
│   └── style.css               # UI styling & animations
├── .gitignore                  # Git ignore rules
├── index.html                  # Single-page web dashboard
└── README.md                   # Documentation
```
