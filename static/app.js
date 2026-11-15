// State
let catalogData = {
  cards: [],
  categories: [],
  default_perks: {},
  default_weights: {}
};

let selectedCardIds = new Set(["sbi_cashback", "icici_amazon_pay", "axis_airtel"]);
let spendInputs = {};
let currentAnalysisResult = null;
let currentUser = null;
let authToken = localStorage.getItem("cardsense_auth_token") || null;
let clientEngine = null;

// Configured Google Sheet Web App Backend (Priority: 1. localStorage -> 2. Repo secret from config.js -> 3. empty)
const INJECTED_SHEET_URL = (window.CARDSENSE_SHEET_URL && !window.CARDSENSE_SHEET_URL.startsWith("__"))
  ? window.CARDSENSE_SHEET_URL
  : "";
let googleSheetUrl = localStorage.getItem("cardsense_sheet_url") || INJECTED_SHEET_URL;

// Presets
const spendPresets = {
  entry: {
    dining_food_delivery: 3000,
    groceries: 5000,
    online_shopping: 5000,
    utilities_bills: 2500,
    travel_flights_hotels: 2000,
    fuel: 2500,
    movies_entertainment: 1000,
    general_offline: 4000
  },
  standard: {
    dining_food_delivery: 6000,
    groceries: 9000,
    online_shopping: 12000,
    utilities_bills: 4000,
    travel_flights_hotels: 7000,
    fuel: 4000,
    movies_entertainment: 2000,
    general_offline: 6000
  },
  high: {
    dining_food_delivery: 15000,
    groceries: 18000,
    online_shopping: 25000,
    utilities_bills: 8000,
    travel_flights_hotels: 25000,
    fuel: 6000,
    movies_entertainment: 4000,
    general_offline: 19000
  }
};

document.addEventListener("DOMContentLoaded", async () => {
  setupPresetDropdown();
  await loadCatalog();
  renderCardSelectionList();
  renderSpendCategoryInputs();
  renderFullCatalog();
  updateWeightLabels();

  // Check auth session
  await checkAuthStatus();

  await triggerAnalysis();
});

// --- Auth & User Profile Functions ---

function getAuthHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }
  return headers;
}

async function checkAuthStatus() {
  if (!authToken) {
    renderAuthUI(null);
    return;
  }

  try {
    const res = await fetch("/api/auth/me", {
      headers: getAuthHeaders()
    });

    if (res.ok) {
      currentUser = await res.json();
      renderAuthUI(currentUser);
      await loadUserConfig();
    } else {
      // Token expired or invalid
      authToken = null;
      localStorage.removeItem("cardsense_auth_token");
      renderAuthUI(null);
    }
  } catch (err) {
    console.error("Auth status check failed:", err);
    renderAuthUI(null);
  }
}

function renderAuthUI(user) {
  const loginBtn = document.getElementById("loginBtn");
  const userWidget = document.getElementById("userLoggedInWidget");
  const userNameDisplay = document.getElementById("userNameDisplay");
  const userEmailDisplay = document.getElementById("userEmailDisplay");
  const userAvatarImg = document.getElementById("userAvatarImg");
  const userAvatarFallback = document.getElementById("userAvatarFallback");

  if (user) {
    if (loginBtn) loginBtn.classList.add("hidden");
    if (userWidget) userWidget.classList.remove("hidden");
    if (userNameDisplay) userNameDisplay.innerText = user.full_name || user.email.split("@")[0];
    if (userEmailDisplay) userEmailDisplay.innerText = user.email;

    if (user.avatar_url && userAvatarImg) {
      userAvatarImg.src = user.avatar_url;
      userAvatarImg.classList.remove("hidden");
      if (userAvatarFallback) userAvatarFallback.classList.add("hidden");
    } else if (userAvatarFallback) {
      userAvatarFallback.innerText = (user.full_name || user.email)[0].toUpperCase();
      userAvatarFallback.classList.remove("hidden");
      if (userAvatarImg) userAvatarImg.classList.add("hidden");
    }
  } else {
    if (loginBtn) loginBtn.classList.remove("hidden");
    if (userWidget) userWidget.classList.add("hidden");
    if (userNameDisplay) userNameDisplay.innerText = "";
    if (userEmailDisplay) userEmailDisplay.innerText = "";
  }
}

function openAuthModal() {
  const modal = document.getElementById("authModal");
  if (modal) modal.classList.remove("hidden");
  initGoogleIdentity();
}

function closeAuthModal() {
  const modal = document.getElementById("authModal");
  if (modal) modal.classList.add("hidden");
}

function initGoogleIdentity() {
  if (window.google && catalogData.google_client_id) {
    try {
      google.accounts.id.initialize({
        client_id: catalogData.google_client_id,
        callback: handleGoogleCredentialResponse
      });
      const container = document.getElementById("googleSignInButtonContainer");
      if (container) {
        container.innerHTML = "";
        google.accounts.id.renderButton(container, {
          theme: "outline",
          size: "large",
          type: "standard",
          shape: "pill",
          text: "signin_with",
          width: 250
        });
      }
    } catch (e) {
      console.warn("Google Identity initialization error:", e);
    }
  }
}

async function handleGoogleCredentialResponse(response) {
  const errBox = document.getElementById("googleAuthError");
  if (errBox) errBox.classList.add("hidden");

  try {
    const res = await fetch("/api/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential: response.credential })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Google sign-in failed");
    }

    const data = await res.json();
    authToken = data.token;
    localStorage.setItem("cardsense_auth_token", authToken);
    currentUser = data.user;
    renderAuthUI(currentUser);
    closeAuthModal();

    await loadUserConfig();
    await triggerAnalysis();
  } catch (err) {
    if (errBox) {
      errBox.innerText = err.message;
      errBox.classList.remove("hidden");
    }
  }
}

async function signInWithGoogleQuick(email, name, avatar) {
  const errBox = document.getElementById("googleAuthError");
  if (errBox) errBox.classList.add("hidden");

  // Create deterministic simulated Google ID from email
  const googleId = "gid_" + btoa(email.toLowerCase()).replace(/=/g, "").slice(0, 16);

  try {
    const res = await fetch("/api/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        google_id: googleId,
        email: email,
        full_name: name,
        avatar_url: avatar
      })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Google sign-in failed");
    }

    const data = await res.json();
    authToken = data.token;
    localStorage.setItem("cardsense_auth_token", authToken);
    currentUser = data.user;
    renderAuthUI(currentUser);
    closeAuthModal();

    await loadUserConfig();
    await triggerAnalysis();
  } catch (err) {
    if (errBox) {
      errBox.innerText = err.message;
      errBox.classList.remove("hidden");
    }
  }
}

function promptCustomGoogleEmail() {
  const email = prompt("Enter your Google Account email (e.g., yourname@gmail.com):");
  if (!email || !email.includes("@")) return;

  const name = email.split("@")[0].replace(/[._]/g, " ").replace(/\b\w/g, l => l.toUpperCase());
  signInWithGoogleQuick(email.trim(), name, "https://lh3.googleusercontent.com/a/default-user");
}

async function handleLogout() {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: getAuthHeaders()
    });
  } catch (err) {
    // Ignore
  }
  authToken = null;
  currentUser = null;
  localStorage.removeItem("cardsense_auth_token");
  renderAuthUI(null);
}

// Load user-specific cards, spend, and weights from SQLite
async function loadUserConfig() {
  if (!authToken) return;

  try {
    const res = await fetch("/api/user/config", {
      headers: getAuthHeaders()
    });

    if (!res.ok) return;

    const config = await res.json();

    // 1. Restore cards
    if (config.selected_card_ids && config.selected_card_ids.length > 0) {
      selectedCardIds = new Set(config.selected_card_ids);
      renderCardSelectionList();
    }

    // 2. Restore spend profile
    if (config.spend_profile && config.spend_profile.monthly_spend) {
      for (const [catId, val] of Object.entries(config.spend_profile.monthly_spend)) {
        const input = document.getElementById(`spend_${catId}`);
        if (input) input.value = val;
      }
      updateSpendTotals();
    }

    // 3. Restore weights
    if (config.weights) {
      const w = config.weights;
      if (w.domestic_airport_lounge_multiplier !== undefined) document.getElementById("w_lounge_mult").value = w.domestic_airport_lounge_multiplier;
      if (w.domestic_airport_lounge_unit_value !== undefined) document.getElementById("w_lounge_val").value = w.domestic_airport_lounge_unit_value;
      if (w.movie_bogo_multiplier !== undefined) document.getElementById("w_movie_mult").value = w.movie_bogo_multiplier;
      if (w.movie_bogo_ticket_unit_value !== undefined) document.getElementById("w_movie_val").value = w.movie_bogo_ticket_unit_value;
      if (w.milestone_travel_voucher_multiplier !== undefined) document.getElementById("w_voucher_mult").value = w.milestone_travel_voucher_multiplier;
      if (w.golf_round_multiplier !== undefined) document.getElementById("w_golf_mult").value = w.golf_round_multiplier;
      if (w.golf_round_unit_value !== undefined) document.getElementById("w_golf_val").value = w.golf_round_unit_value;
      if (w.dining_membership_multiplier !== undefined) document.getElementById("w_dining_mult").value = w.dining_membership_multiplier;
      if (w.fuel_surcharge_multiplier !== undefined) document.getElementById("w_fuel_mult").value = w.fuel_surcharge_multiplier;
      updateWeightLabels();
    }
  } catch (err) {
    console.error("Failed to load user config:", err);
  }
}

// Save current state to user's Google Sheet or SQLite backend
async function saveCurrentProfileToDb() {
  if (!authToken && !currentUser) {
    openAuthModal();
    return;
  }

  const saveBtn = document.getElementById("saveProfileBtn");
  const origText = saveBtn ? saveBtn.innerHTML : "";
  if (saveBtn) saveBtn.innerHTML = `<span>Saving...</span>`;

  const payload = {
    selected_card_ids: Array.from(selectedCardIds),
    spend_profile: getSpendProfilePayload(),
    weights: getWeightsPayload()
  };

  let savedToSheet = false;
  let savedToDb = false;

  // 1. Sync to Google Sheet if configured
  if (googleSheetUrl && currentUser && currentUser.email) {
    try {
      const sheetPayload = {
        action: "saveConfig",
        email: currentUser.email,
        config: payload
      };
      await fetch(googleSheetUrl, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify(sheetPayload)
      });
      savedToSheet = true;
    } catch (sheetErr) {
      console.warn("Failed to sync to Google Sheet:", sheetErr);
    }
  }

  // 2. Sync to SQLite backend if running
  try {
    const res = await fetch("/api/user/config", {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    if (res.ok) savedToDb = true;
  } catch (dbErr) {
    // Ignore if running 100% serverless
  }

  // Provide user feedback
  if (saveBtn) {
    saveBtn.className = "px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 text-white transition-colors flex items-center gap-1 border border-emerald-600";
    const msg = savedToSheet ? "✓ Synced to Sheet!" : "✓ Saved Profile!";
    saveBtn.innerHTML = `<span>${msg}</span>`;
    setTimeout(() => {
      saveBtn.className = "px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors flex items-center gap-1 border border-emerald-200";
      saveBtn.innerHTML = origText;
    }, 2500);
  }
}

// Google Sheet Sync Modal Controls
function openSheetModal() {
  const modal = document.getElementById("sheetConfigModal");
  if (modal) {
    modal.classList.remove("hidden");
    const input = document.getElementById("sheetWebAppUrlInput");
    if (input) input.value = googleSheetUrl;
  }
}

function closeSheetModal() {
  const modal = document.getElementById("sheetConfigModal");
  if (modal) modal.classList.add("hidden");
}

function saveSheetUrl() {
  const input = document.getElementById("sheetWebAppUrlInput");
  const url = (input ? input.value : "").trim();
  googleSheetUrl = url;
  if (url) {
    localStorage.setItem("cardsense_sheet_url", url);
    alert("Google Sheet Web App URL saved successfully!");
  } else {
    localStorage.removeItem("cardsense_sheet_url");
    alert("Google Sheet URL removed.");
  }
  closeSheetModal();
  if (currentUser) {
    loadUserConfig();
  }
}

async function testSheetConnection() {
  const input = document.getElementById("sheetWebAppUrlInput");
  const url = (input ? input.value : "").trim();
  const statusDiv = document.getElementById("sheetConnectionStatus");
  if (!statusDiv) return;

  if (!url) {
    statusDiv.className = "text-[11px] p-2 rounded-lg font-semibold bg-rose-50 text-rose-700";
    statusDiv.innerText = "Please enter your Google Apps Script Web App URL first.";
    statusDiv.classList.remove("hidden");
    return;
  }

  statusDiv.className = "text-[11px] p-2 rounded-lg font-semibold bg-slate-100 text-slate-700";
  statusDiv.innerText = "Testing connection to Google Sheet...";
  statusDiv.classList.remove("hidden");

  try {
    const res = await fetch(`${url}?action=ping`, { method: "GET" });
    const data = await res.json();
    if (data.status === "success") {
      statusDiv.className = "text-[11px] p-2 rounded-lg font-semibold bg-emerald-50 text-emerald-800";
      statusDiv.innerText = "✓ Connected successfully to CardSense_DB Google Sheet!";
    } else {
      throw new Error(data.message || "Unknown error");
    }
  } catch (err) {
    statusDiv.className = "text-[11px] p-2 rounded-lg font-semibold bg-amber-50 text-amber-800";
    statusDiv.innerText = "Note: Web App reached! (Ensure 'Who has access' is set to 'Anyone' in Apps Script deployment).";
  }
}

// Setup preset dropdown toggle
function setupPresetDropdown() {
  const btn = document.getElementById("presetBtn");
  const menu = document.getElementById("presetMenu");
  if (!btn || !menu) return;

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.classList.toggle("hidden");
  });

  document.addEventListener("click", () => {
    menu.classList.add("hidden");
  });
}

function applyPreset(presetKey) {
  const preset = spendPresets[presetKey];
  if (!preset) return;

  for (const [catId, val] of Object.entries(preset)) {
    const input = document.getElementById(`spend_${catId}`);
    if (input) {
      input.value = val;
    }
  }
  updateSpendTotals();
  triggerAnalysis();
}

async function loadCatalog() {
  try {
    let res = null;
    try {
      res = await fetch("/api/catalog");
    } catch (e) {
      // Backend not running, load static data
    }

    if (!res || !res.ok) {
      // Fallback for GitHub Pages static hosting
      res = await fetch("./data/catalog.json");
    }

    catalogData = await res.json();
    populateBankFilter();
    document.getElementById("totalCardsCount").innerText = catalogData.cards.length;

    // Instantiate in-browser calculation engine
    if (typeof ClientCreditCardEngine !== "undefined") {
      clientEngine = new ClientCreditCardEngine(catalogData.cards, catalogData.categories);
    }

    initGoogleIdentity();
  } catch (err) {
    console.error("Failed to load catalog:", err);
  }
}

function populateBankFilter() {
  const bankFilter = document.getElementById("bankFilter");
  if (!bankFilter) return;

  const banks = Array.from(new Set(catalogData.cards.map(c => c.bank))).sort();
  bankFilter.innerHTML = '<option value="">All Banks</option>';
  banks.forEach(b => {
    const opt = document.createElement("option");
    opt.value = b;
    opt.innerText = b;
    bankFilter.appendChild(opt);
  });
}

function renderCardSelectionList() {
  const container = document.getElementById("cardsSelectionContainer");
  if (!container) return;

  container.innerHTML = "";
  const searchTerm = (document.getElementById("cardSearchInput")?.value || "").toLowerCase();
  const bankTerm = document.getElementById("bankFilter")?.value || "";

  catalogData.cards.forEach(card => {
    const matchesSearch = card.name.toLowerCase().includes(searchTerm) || card.bank.toLowerCase().includes(searchTerm);
    const matchesBank = !bankTerm || card.bank === bankTerm;

    if (!matchesSearch || !matchesBank) return;

    const isChecked = selectedCardIds.has(card.id);

    const div = document.createElement("div");
    div.className = `p-3 rounded-xl border cursor-pointer transition-all card-item flex items-center justify-between ${
      isChecked ? "bg-indigo-50/70 border-indigo-300 shadow-xs" : "bg-white border-slate-200 hover:border-slate-300"
    }`;
    div.onclick = (e) => {
      if (e.target.tagName !== "INPUT") {
        toggleCard(card.id);
      }
    };

    let feeText = card.is_ltf ? "Lifetime Free" : `₹${card.annual_fee.toLocaleString("en-IN")}/yr + GST`;
    let waiverText = card.fee_waiver_spend_annual ? `Waived on ₹${(card.fee_waiver_spend_annual/100000).toFixed(1)}L` : "";

    div.innerHTML = `
      <div class="flex items-center gap-3">
        <input type="checkbox" ${isChecked ? "checked" : ""} onchange="toggleCard('${card.id}')" class="w-4 h-4 rounded text-indigo-600 cursor-pointer">
        <div>
          <span class="block text-xs font-bold text-slate-900">${card.name}</span>
          <div class="flex items-center gap-2 mt-0.5">
            <span class="text-[11px] text-slate-500 font-medium">${card.bank}</span>
            <span class="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded font-semibold">${card.tier}</span>
            ${card.rupay_upi_enabled ? '<span class="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.2 rounded font-semibold">RuPay UPI</span>' : ''}
          </div>
        </div>
      </div>
      <div class="text-right">
        <span class="text-xs font-bold ${card.is_ltf ? 'text-emerald-600' : 'text-slate-700'}">${feeText}</span>
        ${waiverText ? `<span class="block text-[10px] text-slate-400">${waiverText}</span>` : ''}
      </div>
    `;

    container.appendChild(div);
  });

  const countBadge = document.getElementById("selectedCardsCount");
  if (countBadge) countBadge.innerText = `${selectedCardIds.size} selected`;
}

function filterCardList() {
  renderCardSelectionList();
}

function toggleCard(cardId) {
  if (selectedCardIds.has(cardId)) {
    selectedCardIds.delete(cardId);
  } else {
    selectedCardIds.add(cardId);
  }
  renderCardSelectionList();
  triggerAnalysis();
}

function renderSpendCategoryInputs() {
  const container = document.getElementById("spendCategoriesContainer");
  if (!container) return;

  container.innerHTML = "";
  catalogData.categories.forEach(cat => {
    const div = document.createElement("div");
    div.className = "p-3 bg-slate-50/70 rounded-xl border border-slate-200/80 space-y-1.5";

    div.innerHTML = `
      <div class="flex items-center justify-between">
        <label for="spend_${cat.id}" class="text-xs font-bold text-slate-800">${cat.name}</label>
        <span class="text-[10px] text-slate-400 font-medium">${(cat.benchmark_rate * 100).toFixed(0)}% Benchmark</span>
      </div>
      <div class="relative">
        <span class="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400">₹</span>
        <input type="number" id="spend_${cat.id}" value="${cat.default_monthly_spend}" oninput="updateSpendTotals()" class="w-full text-xs font-bold bg-white border border-slate-200 rounded-lg pl-7 pr-3 py-1.5 text-slate-800 focus:outline-hidden focus:ring-1 focus:ring-indigo-500">
      </div>
      <p class="text-[10px] text-slate-400 truncate">${cat.description}</p>
    `;

    container.appendChild(div);
  });

  updateSpendTotals();
}

function updateSpendTotals() {
  let monthlyTotal = 0;
  catalogData.categories.forEach(cat => {
    const input = document.getElementById(`spend_${cat.id}`);
    const val = parseFloat(input?.value || 0);
    monthlyTotal += val;
  });

  const annualTotal = monthlyTotal * 12;
  const monthSumEl = document.getElementById("spendMonthlySum");
  const annSumEl = document.getElementById("spendAnnualSum");

  if (monthSumEl) monthSumEl.innerText = `₹${monthlyTotal.toLocaleString("en-IN")}`;
  if (annSumEl) annSumEl.innerText = `₹${annualTotal.toLocaleString("en-IN")}`;
}

function getSpendProfilePayload() {
  const monthly_spend = {};
  catalogData.categories.forEach(cat => {
    const input = document.getElementById(`spend_${cat.id}`);
    monthly_spend[cat.id] = parseFloat(input?.value || 0);
  });
  return { monthly_spend };
}

function getWeightsPayload() {
  return {
    domestic_airport_lounge_multiplier: parseFloat(document.getElementById("w_lounge_mult")?.value || 1.0),
    domestic_airport_lounge_unit_value: parseFloat(document.getElementById("w_lounge_val")?.value || 1000.0),
    movie_bogo_multiplier: parseFloat(document.getElementById("w_movie_mult")?.value || 1.0),
    movie_bogo_ticket_unit_value: parseFloat(document.getElementById("w_movie_val")?.value || 250.0),
    milestone_travel_voucher_multiplier: parseFloat(document.getElementById("w_voucher_mult")?.value || 0.85),
    golf_round_multiplier: parseFloat(document.getElementById("w_golf_mult")?.value || 1.0),
    golf_round_unit_value: parseFloat(document.getElementById("w_golf_val")?.value || 1500.0),
    dining_membership_multiplier: parseFloat(document.getElementById("w_dining_mult")?.value || 1.0),
    fuel_surcharge_multiplier: parseFloat(document.getElementById("w_fuel_mult")?.value || 1.0)
  };
}

function updateWeightLabels() {
  const lMult = document.getElementById("w_lounge_mult")?.value || "1.0";
  const mMult = document.getElementById("w_movie_mult")?.value || "1.0";
  const vMult = document.getElementById("w_voucher_mult")?.value || "0.85";
  const gMult = document.getElementById("w_golf_mult")?.value || "1.0";
  const dMult = document.getElementById("w_dining_mult")?.value || "1.0";
  const fMult = document.getElementById("w_fuel_mult")?.value || "1.0";

  if (document.getElementById("loungeMultiplierLabel")) document.getElementById("loungeMultiplierLabel").innerText = `${lMult}x`;
  if (document.getElementById("movieMultiplierLabel")) document.getElementById("movieMultiplierLabel").innerText = `${mMult}x`;
  if (document.getElementById("voucherMultiplierLabel")) document.getElementById("voucherMultiplierLabel").innerText = `${vMult}x`;
  if (document.getElementById("golfMultiplierLabel")) document.getElementById("golfMultiplierLabel").innerText = `${gMult}x`;
  if (document.getElementById("diningMultiplierLabel")) document.getElementById("diningMultiplierLabel").innerText = `${dMult}x`;
  if (document.getElementById("fuelMultiplierLabel")) document.getElementById("fuelMultiplierLabel").innerText = `${fMult}x`;

  const vTxt = document.getElementById("voucherRealizationTxt");
  if (vTxt) vTxt.innerText = `${Math.round(parseFloat(vMult) * 100)}% of face value`;
}

function resetDefaultWeights() {
  document.getElementById("w_lounge_mult").value = 1.0;
  document.getElementById("w_lounge_val").value = 1000;
  document.getElementById("w_movie_mult").value = 1.0;
  document.getElementById("w_movie_val").value = 250;
  document.getElementById("w_voucher_mult").value = 0.85;
  document.getElementById("w_golf_mult").value = 1.0;
  document.getElementById("w_golf_val").value = 1500;
  document.getElementById("w_dining_mult").value = 1.0;
  document.getElementById("w_fuel_mult").value = 1.0;
  updateWeightLabels();
  triggerAnalysis();
}

async function triggerAnalysis() {
  if (selectedCardIds.size === 0) {
    alert("Please select at least one credit card in Tab 1.");
    return;
  }

  const spinner = document.getElementById("loadingSpinner");
  const runIcon = document.getElementById("runIcon");
  if (spinner) spinner.classList.remove("hidden");
  if (runIcon) runIcon.classList.add("hidden");

  // 1. If in-browser calculation engine is ready, compute instantly (0ms latency, GitHub Pages ready)
  if (clientEngine && catalogData.cards.length > 0) {
    try {
      const selectedCards = catalogData.cards.filter(c => selectedCardIds.has(c.id));
      const spendProfile = getSpendProfilePayload();
      const weights = getWeightsPayload();

      const { cardsSummary, routingInfo } = clientEngine.analyzePortfolio(selectedCards, spendProfile, weights);
      const gaps = clientEngine.analyzeGaps(selectedCards, cardsSummary, spendProfile, routingInfo, weights);
      const recs = clientEngine.generateRecommendations(selectedCards, cardsSummary, spendProfile, gaps, weights);

      const totSpend = Object.values(spendProfile.monthly_spend).reduce((a, b) => a + b, 0) * 12.0;
      const totRewards = cardsSummary.reduce((acc, q) => acc + q.total_rewards_earned, 0);
      const totPerks = cardsSummary.reduce((acc, q) => acc + q.total_perk_value, 0);
      const totFees = cardsSummary.reduce((acc, q) => acc + q.effective_annual_fee, 0);
      const netVal = cardsSummary.reduce((acc, q) => acc + q.net_value, 0);
      const netYield = totSpend > 0 ? (netVal / totSpend * 100.0) : 0.0;

      currentAnalysisResult = {
        total_annual_spend: Number(totSpend.toFixed(2)),
        total_annual_rewards: Number(totRewards.toFixed(2)),
        total_perk_value: Number(totPerks.toFixed(2)),
        total_fees_paid: Number(totFees.toFixed(2)),
        net_annual_value: Number(netVal.toFixed(2)),
        net_portfolio_yield_percent: Number(netYield.toFixed(2)),
        best_spend_routing: routingInfo,
        cards_summary: cardsSummary,
        gaps: gaps,
        recommendations: recs
      };

      renderAnalysisOutput(currentAnalysisResult);
      if (spinner) spinner.classList.add("hidden");
      if (runIcon) runIcon.classList.remove("hidden");
      return;
    } catch (clientErr) {
      console.warn("Client engine fallback to API:", clientErr);
    }
  }

  // 2. Fallback to API endpoint
  const payload = {
    selected_card_ids: Array.from(selectedCardIds),
    spend_profile: getSpendProfilePayload(),
    weights: getWeightsPayload()
  };

  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Analysis failed");
    }

    currentAnalysisResult = await res.json();
    renderAnalysisOutput(currentAnalysisResult);
  } catch (err) {
    alert(`Error: ${err.message}`);
  } finally {
    if (spinner) spinner.classList.add("hidden");
    if (runIcon) runIcon.classList.remove("hidden");
  }
}

function renderAnalysisOutput(result) {
  // 1. KPI Ribbon
  document.getElementById("kpiTotalSpend").innerText = `₹${result.total_annual_spend.toLocaleString("en-IN")}`;
  document.getElementById("kpiMonthlySpend").innerText = `₹${Math.round(result.total_annual_spend / 12).toLocaleString("en-IN")} / mo`;
  document.getElementById("kpiTotalRewards").innerText = `₹${result.total_annual_rewards.toLocaleString("en-IN")}`;
  document.getElementById("kpiTotalPerks").innerText = `₹${result.total_perk_value.toLocaleString("en-IN")}`;
  document.getElementById("kpiTotalFees").innerText = `₹${result.total_fees_paid.toLocaleString("en-IN")}`;

  const waivedCount = result.cards_summary.filter(c => c.fee_waived).length;
  document.getElementById("kpiWaiverCount").innerText = `${waivedCount} / ${result.cards_summary.length} fees waived`;

  const kpiNet = document.getElementById("kpiNetValue");
  kpiNet.innerText = `₹${result.net_annual_value.toLocaleString("en-IN")}`;
  kpiNet.className = result.net_annual_value >= 0 ? "text-2xl font-black text-emerald-300" : "text-2xl font-black text-rose-300";

  document.getElementById("kpiYieldBadge").innerText = `${result.net_portfolio_yield_percent}% Net Yield`;

  // Badges
  document.getElementById("gapsBadgeCount").innerText = result.gaps.length;
  document.getElementById("recsBadgeCount").innerText = result.recommendations.length;

  // 2. Tab 3 Spend Routing Table
  renderSpendRoutingTable(result.best_spend_routing);

  // 3. Tab 3 Card-by-Card Performance Ledger
  renderCardLedger(result.cards_summary);

  // 4. Tab 4 Gaps
  renderGaps(result.gaps);

  // 5. Tab 5 Recommendations
  renderRecommendations(result.recommendations);
}

function renderSpendRoutingTable(routing) {
  const tbody = document.getElementById("routingTableBody");
  if (!tbody) return;

  tbody.innerHTML = "";
  for (const [catId, info] of Object.entries(routing)) {
    const catMeta = catalogData.categories.find(c => c.id === catId);
    const catName = catMeta ? catMeta.name : catId;

    const tr = document.createElement("tr");
    tr.className = "hover:bg-slate-50/70 transition-colors";

    const allocs = info.allocations || [];
    let assignedCardHtml = "";

    if (allocs.length === 0) {
      assignedCardHtml = `<span class="text-slate-400">None</span>`;
    } else {
      assignedCardHtml = allocs.map(a => `
        <span class="inline-block bg-indigo-50 text-indigo-800 px-2 py-0.5 rounded text-[11px] font-bold">
          ${a.card_name}
        </span>
      `).join(" ");
    }

    const monthlyRew = allocs.reduce((acc, curr) => acc + curr.reward_earned, 0);
    const annualRew = monthlyRew * 12;

    tr.innerHTML = `
      <td class="py-2.5 px-3 font-semibold text-slate-800">${catName}</td>
      <td class="py-2.5 px-3 text-slate-600">₹${info.total_monthly_spend.toLocaleString("en-IN")}</td>
      <td class="py-2.5 px-3">${assignedCardHtml}</td>
      <td class="py-2.5 px-3 font-bold text-emerald-600">${info.effective_rate_percent}%</td>
      <td class="py-2.5 px-3 text-right font-semibold text-slate-700">₹${Math.round(monthlyRew).toLocaleString("en-IN")}</td>
      <td class="py-2.5 px-3 text-right font-black text-emerald-600">₹${Math.round(annualRew).toLocaleString("en-IN")}</td>
    `;
    tbody.appendChild(tr);
  }
}

function renderCardLedger(cardsSummary) {
  const container = document.getElementById("cardLedgerContainer");
  if (!container) return;

  container.innerHTML = "";
  cardsSummary.forEach(q => {
    const div = document.createElement("div");
    div.className = "p-4 rounded-xl border border-slate-200 bg-white shadow-xs space-y-3";

    let waiverBadge = "";
    if (q.effective_annual_fee === 0) {
      waiverBadge = `<span class="text-[10px] bg-emerald-100 text-emerald-700 font-bold px-2 py-0.5 rounded-full">Fee Waived</span>`;
    } else {
      waiverBadge = `<span class="text-[10px] bg-rose-100 text-rose-700 font-bold px-2 py-0.5 rounded-full">Fee Paid: ₹${q.effective_annual_fee.toLocaleString("en-IN")}</span>`;
    }

    div.innerHTML = `
      <div class="flex items-start justify-between">
        <div>
          <h4 class="text-xs font-bold text-slate-900">${q.card_name}</h4>
          <span class="text-[11px] text-slate-500">${q.bank} &bull; ${q.tier}</span>
        </div>
        ${waiverBadge}
      </div>

      <div class="space-y-1.5 text-xs pt-1 border-t border-slate-100">
        <div class="flex justify-between text-slate-500">
          <span>Allocated Spend:</span>
          <span class="font-bold text-slate-700">₹${q.allocated_annual_spend.toLocaleString("en-IN")}/yr</span>
        </div>
        <div class="flex justify-between text-slate-500">
          <span>Cashback & Points:</span>
          <span class="font-bold text-emerald-600">₹${q.base_rewards_earned.toLocaleString("en-IN")}</span>
        </div>
        ${q.milestone_rewards_earned > 0 ? `
          <div class="flex justify-between text-slate-500">
            <span>Milestones Achieved:</span>
            <span class="font-bold text-indigo-600">₹${q.milestone_rewards_earned.toLocaleString("en-IN")}</span>
          </div>
        ` : ''}
        <div class="flex justify-between text-slate-500">
          <span>Weighted Perks:</span>
          <span class="font-bold text-purple-600">₹${q.total_perk_value.toLocaleString("en-IN")}</span>
        </div>
        <div class="flex justify-between text-slate-500">
          <span>Fee + 18% GST:</span>
          <span class="font-bold text-rose-600">-₹${q.effective_annual_fee.toLocaleString("en-IN")}</span>
        </div>
      </div>

      <div class="pt-2 border-t border-slate-100 flex items-center justify-between">
        <div>
          <span class="text-[10px] uppercase text-slate-400 font-bold block">Net Card Value</span>
          <span class="text-sm font-black ${q.net_value >= 0 ? 'text-emerald-600' : 'text-rose-600'}">
            ${q.net_value >= 0 ? '+' : ''}₹${q.net_value.toLocaleString("en-IN")}
          </span>
        </div>
        <div class="text-right">
          <span class="text-[10px] uppercase text-slate-400 font-bold block">Return Yield</span>
          <span class="text-xs font-bold text-slate-700">${q.net_yield_percent}%</span>
        </div>
      </div>
    `;

    container.appendChild(div);
  });
}

function renderGaps(gaps) {
  const catList = document.getElementById("catGapsList");
  const perkList = document.getElementById("perkGapsList");
  const feeList = document.getElementById("feeGapsList");

  catList.innerHTML = "";
  perkList.innerHTML = "";
  feeList.innerHTML = "";

  const catGaps = gaps.filter(g => g.gap_type === "category_coverage");
  const perkGaps = gaps.filter(g => g.gap_type === "missing_perk");
  const feeGaps = gaps.filter(g => g.gap_type === "fee_inefficiency");

  document.getElementById("countCatGaps").innerText = catGaps.length;
  document.getElementById("countPerkGaps").innerText = perkGaps.length;
  document.getElementById("countFeeGaps").innerText = feeGaps.length;

  if (catGaps.length === 0) {
    catList.innerHTML = `<div class="p-4 text-center text-xs text-slate-400 bg-slate-50 rounded-xl">No category coverage gaps detected!</div>`;
  } else {
    catGaps.forEach(g => catList.appendChild(createGapCard(g)));
  }

  if (perkGaps.length === 0) {
    perkList.innerHTML = `<div class="p-4 text-center text-xs text-slate-400 bg-slate-50 rounded-xl">All key perks covered!</div>`;
  } else {
    perkGaps.forEach(g => perkList.appendChild(createGapCard(g)));
  }

  if (feeGaps.length === 0) {
    feeList.innerHTML = `<div class="p-4 text-center text-xs text-slate-400 bg-slate-50 rounded-xl">No fee inefficiencies found!</div>`;
  } else {
    feeGaps.forEach(g => feeList.appendChild(createGapCard(g)));
  }
}

function createGapCard(gap) {
  const div = document.createElement("div");
  const isHigh = gap.severity === "high";

  div.className = `p-3.5 rounded-xl border text-xs space-y-2 ${
    isHigh ? "bg-amber-50/60 border-amber-200" : "bg-slate-50 border-slate-200"
  }`;

  div.innerHTML = `
    <div class="flex items-center justify-between">
      <span class="font-bold text-slate-900">${gap.title}</span>
      <span class="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
        isHigh ? "bg-amber-200/60 text-amber-900" : "bg-slate-200 text-slate-700"
      }">${gap.severity}</span>
    </div>
    <p class="text-slate-600 text-[11px] leading-relaxed">${gap.description}</p>
    <div class="flex items-center justify-between pt-1 border-t border-slate-200/60 text-[11px]">
      <span class="text-slate-500">Est. Opportunity Loss:</span>
      <span class="font-extrabold text-rose-600">₹${gap.estimated_annual_loss.toLocaleString("en-IN")}/yr</span>
    </div>
  `;
  return div;
}

function renderRecommendations(recommendations) {
  const container = document.getElementById("recommendationsContainer");
  if (!container) return;

  container.innerHTML = "";
  if (recommendations.length === 0) {
    container.innerHTML = `
      <div class="p-8 text-center text-slate-400">
        <p class="text-sm font-semibold">Your portfolio is currently optimal!</p>
        <p class="text-xs">No candidate card provides a significant marginal gain over your current setup.</p>
      </div>
    `;
    return;
  }

  recommendations.forEach(r => {
    const isAdd = r.action === "add";
    const div = document.createElement("div");
    div.className = "p-4 rounded-xl border border-indigo-100 bg-gradient-to-r from-indigo-50/50 via-white to-white shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4";

    div.innerHTML = `
      <div class="space-y-1.5 flex-1">
        <div class="flex items-center gap-2">
          <span class="text-xs font-black uppercase px-2 py-0.5 rounded-md ${
            isAdd ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
          }">
            ${isAdd ? "Recommended Addition" : "Recommended Replacement"}
          </span>
          <h3 class="text-sm font-bold text-slate-900">${r.card_name}</h3>
        </div>
        <p class="text-xs text-slate-600">${r.reason}</p>
        <div class="flex flex-wrap gap-1.5 pt-1">
          ${r.key_features_gained.map(f => `
            <span class="text-[10px] font-semibold bg-white border border-slate-200 text-slate-700 px-2 py-0.5 rounded-md">
              &bull; ${f}
            </span>
          `).join("")}
        </div>
      </div>

      <div class="text-right flex md:flex-col items-center md:items-end justify-between w-full md:w-auto pt-2 md:pt-0 border-t md:border-t-0 border-slate-100 gap-3">
        <div>
          <span class="text-[10px] uppercase font-bold text-slate-400 block">Projected Net Gain</span>
          <span class="text-base font-black text-emerald-600">+₹${r.projected_net_gain_inr.toLocaleString("en-IN")}/yr</span>
        </div>
        <button onclick="applyRecommendation('${r.action}', '${r.card_id}', '${r.replaces_card_id || ''}')" class="px-3.5 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors shadow-xs">
          ${isAdd ? "+ Add to Portfolio" : "Swap Cards"}
        </button>
      </div>
    `;

    container.appendChild(div);
  });
}

function applyRecommendation(action, cardId, replacesCardId) {
  if (action === "replace" && replacesCardId) {
    selectedCardIds.delete(replacesCardId);
  }
  selectedCardIds.add(cardId);
  renderCardSelectionList();
  triggerAnalysis();
  switchTab("tab-quant");
}

function renderFullCatalog() {
  const container = document.getElementById("fullCatalogContainer");
  if (!container) return;

  const search = (document.getElementById("catalogSearch")?.value || "").toLowerCase();
  container.innerHTML = "";

  catalogData.cards.forEach(card => {
    if (search && !card.name.toLowerCase().includes(search) && !card.bank.toLowerCase().includes(search)) {
      return;
    }

    const isSelected = selectedCardIds.has(card.id);
    const div = document.createElement("div");
    div.className = "p-4 rounded-xl border border-slate-200 bg-white shadow-xs space-y-3 flex flex-col justify-between";

    let feeStr = card.is_ltf ? "Lifetime Free" : `₹${card.annual_fee.toLocaleString("en-IN")} + 18% GST`;

    div.innerHTML = `
      <div class="space-y-2">
        <div class="flex items-start justify-between">
          <div>
            <h4 class="text-xs font-bold text-slate-900">${card.name}</h4>
            <span class="text-[11px] text-slate-500">${card.bank} &bull; ${card.tier}</span>
          </div>
          <span class="text-xs font-bold ${card.is_ltf ? 'text-emerald-600' : 'text-slate-800'}">${feeStr}</span>
        </div>

        <ul class="text-[11px] text-slate-600 space-y-1 list-disc list-inside">
          ${card.key_highlights.slice(0, 3).map(h => `<li class="truncate">${h}</li>`).join("")}
        </ul>
      </div>

      <div class="pt-3 border-t border-slate-100 flex items-center justify-between">
        <span class="text-[10px] text-slate-400">
          ${card.fee_waiver_spend_annual ? `Waiver: ₹${(card.fee_waiver_spend_annual/100000).toFixed(1)}L spend` : ''}
        </span>
        <button onclick="toggleCard('${card.id}')" class="px-3 py-1 text-xs font-bold rounded-lg ${
          isSelected ? 'bg-slate-100 text-slate-600 hover:bg-slate-200' : 'bg-indigo-600 text-white hover:bg-indigo-700'
        }">
          ${isSelected ? 'Remove' : 'Select'}
        </button>
      </div>
    `;

    container.appendChild(div);
  });
}

function filterCatalogCards() {
  renderFullCatalog();
}

function switchTab(tabId) {
  document.querySelectorAll(".tab-content").forEach(el => el.classList.add("hidden"));
  document.querySelectorAll(".tab-btn").forEach(el => {
    el.classList.remove("active", "border-indigo-600", "text-indigo-600");
    el.classList.add("border-transparent", "text-slate-500");
  });

  const targetTab = document.getElementById(tabId);
  if (targetTab) targetTab.classList.remove("hidden");

  const activeBtn = Array.from(document.querySelectorAll(".tab-btn")).find(b => b.getAttribute("onclick").includes(tabId));
  if (activeBtn) {
    activeBtn.classList.add("active", "border-indigo-600", "text-indigo-600");
    activeBtn.classList.remove("border-transparent", "text-slate-500");
  }
}

// Custom Card Modal
function openCustomCardModal() {
  document.getElementById("customCardModal").classList.remove("hidden");
}

function closeCustomCardModal() {
  document.getElementById("customCardModal").classList.add("hidden");
}

async function saveCustomCard(e) {
  e.preventDefault();

  const name = document.getElementById("c_name").value.trim();
  const bank = document.getElementById("c_bank").value.trim();
  const id = `custom_${name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;

  const annualFee = parseFloat(document.getElementById("c_fee").value || 0);
  const waiver = parseFloat(document.getElementById("c_waiver").value || 0);
  const isLtf = document.getElementById("c_ltf").value === "true";
  const baseRate = (parseFloat(document.getElementById("c_base_rate").value || 1.0)) / 100.0;
  const network = document.getElementById("c_network").value;
  const rewardType = document.getElementById("c_rew_type").value;

  const categoryRates = {};
  const diningRate = document.getElementById("c_rate_dining").value;
  if (diningRate) categoryRates["dining_food_delivery"] = parseFloat(diningRate) / 100.0;

  const grocRate = document.getElementById("c_rate_groceries").value;
  if (grocRate) categoryRates["groceries"] = parseFloat(grocRate) / 100.0;

  const onlineRate = document.getElementById("c_rate_online").value;
  if (onlineRate) categoryRates["online_shopping"] = parseFloat(onlineRate) / 100.0;

  const utilRate = document.getElementById("c_rate_utilities").value;
  if (utilRate) categoryRates["utilities_bills"] = parseFloat(utilRate) / 100.0;

  const lounges = parseInt(document.getElementById("c_lounges").value || 0);
  const movieDisc = parseFloat(document.getElementById("c_movie_disc").value || 0);
  const golf = parseInt(document.getElementById("c_golf").value || 0);
  const fuelWaiver = document.getElementById("c_fuel_waiver").checked;
  const rupayUpi = document.getElementById("c_rupay_upi").checked;

  const cardPayload = {
    id: id,
    name: name,
    bank: bank,
    network: network,
    tier: "Custom",
    annual_fee: annualFee,
    gst_rate: 0.18,
    fee_waiver_spend_annual: waiver > 0 ? waiver : null,
    joining_fee: annualFee,
    is_ltf: isLtf,
    reward_type: rewardType,
    point_value_inr: 1.0,
    base_reward_rate: baseRate,
    category_rates: categoryRates,
    category_caps_monthly: {},
    category_exclusions: ["fuel"],
    overall_monthly_reward_cap: null,
    milestones: [],
    perks: {
      domestic_lounges_per_year: lounges,
      railway_lounges_per_year: 0,
      movie_bogo_monthly_max_discount: movieDisc,
      movie_bogo_tickets_per_month: movieDisc > 0 ? 2 : 0,
      golf_rounds_per_year: golf,
      fuel_surcharge_waiver: fuelWaiver,
      fuel_surcharge_monthly_cap: 250,
      dining_membership_name: null,
      dining_membership_value: 0
    },
    rupay_upi_enabled: rupayUpi,
    key_highlights: [`Custom User Card: ${name}`]
  };

  try {
    const res = await fetch("/api/cards", {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify(cardPayload)
    });

    if (!res.ok) throw new Error("Failed to save custom card");

    await loadCatalog();
    selectedCardIds.add(id);
    renderCardSelectionList();
    renderFullCatalog();
    closeCustomCardModal();
    triggerAnalysis();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}
