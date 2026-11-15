/**
 * CardSense India - Client-side Calculation Engine
 * Replicates the exact Python engine, gap analyzer, and recommender logic
 * for 100% serverless execution on GitHub Pages.
 */

class ClientCreditCardEngine {
  constructor(catalogCards = [], categories = []) {
    this.catalogCards = catalogCards;
    this.categories = categories;
    this.cardMap = new Map();
    catalogCards.forEach(c => this.cardMap.set(c.id, c));

    this.categoryBenchmarks = {
      dining_food_delivery: { name: "Dining & Food Delivery", benchmark: 0.05, topCard: "Swiggy HDFC (10%) or HSBC Live+ (10%)" },
      groceries: { name: "Groceries & Supermarkets", benchmark: 0.05, topCard: "Tata Neu Infinity (10%) or Airtel Axis (10%)" },
      online_shopping: { name: "Online Shopping & E-Commerce", benchmark: 0.05, topCard: "SBI Cashback (5%) or Amazon Pay ICICI (5%)" },
      utilities_bills: { name: "Utilities & Bill Payments", benchmark: 0.05, topCard: "Airtel Axis (10%) or Axis Ace (5%)" },
      travel_flights_hotels: { name: "Travel (Flights & Hotels)", benchmark: 0.05, topCard: "HDFC Infinia (16.6%) or Axis Atlas (10%)" },
      fuel: { name: "Fuel Surcharge Waiver", benchmark: 0.01, topCard: "Cards with 1% surcharge waiver" },
      movies_entertainment: { name: "Movies & Entertainment", benchmark: 0.05, topCard: "ICICI Sapphiro (BOGO BMS) or SBI SimplyCLICK" },
      general_offline: { name: "General Offline Spends", benchmark: 0.015, topCard: "Axis Ace (1.5%) or HSBC Live+ (1.5%)" }
    };
  }

  getEffectiveCategoryRate(card, category) {
    if (card.category_exclusions && card.category_exclusions.includes(category)) {
      return 0.0;
    }
    const rawRate = (card.category_rates && card.category_rates[category] !== undefined)
      ? card.category_rates[category]
      : (card.base_reward_rate || 0.01);
    const pointVal = card.point_value_inr || 1.0;
    return rawRate * pointVal;
  }

  calculateCategoryRouting(cards, monthlySpend) {
    const routingInfo = {};
    const cardMonthlySpend = {};
    const cardMonthlyRewards = {};
    cards.forEach(c => {
      cardMonthlySpend[c.id] = {};
      cardMonthlyRewards[c.id] = {};
    });

    for (const [cat, spend] of Object.entries(monthlySpend)) {
      if (spend <= 0) continue;

      // Sort cards descending by return rate
      const rankedCards = [...cards].sort((a, b) => {
        return this.getEffectiveCategoryRate(b, cat) - this.getEffectiveCategoryRate(a, cat);
      });

      let remainingSpend = spend;
      const catRoutingCards = [];

      for (const card of rankedCards) {
        if (remainingSpend <= 0) break;

        const rate = this.getEffectiveCategoryRate(card, cat);
        const cap = card.category_caps_monthly ? card.category_caps_monthly[cat] : null;

        let spendOnThisCard = remainingSpend;
        let rewardEarned = 0;

        if (cap !== null && cap !== undefined && rate > 0) {
          const maxSpendForCap = cap / rate;
          spendOnThisCard = Math.min(remainingSpend, maxSpendForCap);
          rewardEarned = spendOnThisCard * rate;
        } else {
          spendOnThisCard = remainingSpend;
          rewardEarned = spendOnThisCard * rate;
        }

        // Card overall monthly cap
        if (card.overall_monthly_reward_cap) {
          const currentTotal = Object.values(cardMonthlyRewards[card.id]).reduce((a, b) => a + b, 0);
          const headroom = Math.max(0, card.overall_monthly_reward_cap - currentTotal);
          if (rewardEarned > headroom) {
            rewardEarned = headroom;
            if (rate > 0) spendOnThisCard = Math.min(spendOnThisCard, rewardEarned / rate);
          }
        }

        cardMonthlySpend[card.id][cat] = (cardMonthlySpend[card.id][cat] || 0) + spendOnThisCard;
        cardMonthlyRewards[card.id][cat] = (cardMonthlyRewards[card.id][cat] || 0) + rewardEarned;

        catRoutingCards.push({
          card_id: card.id,
          card_name: card.name,
          allocated_spend: Math.round(spendOnThisCard),
          rate_percent: Number((rate * 100).toFixed(2)),
          reward_earned: Number(rewardEarned.toFixed(2))
        });

        remainingSpend -= spendOnThisCard;
      }

      if (remainingSpend > 0 && cards.length > 0) {
        const primary = cards[0];
        cardMonthlySpend[primary.id][cat] = (cardMonthlySpend[primary.id][cat] || 0) + remainingSpend;
        const rate = this.getEffectiveCategoryRate(primary, cat);
        cardMonthlyRewards[primary.id][cat] = (cardMonthlyRewards[primary.id][cat] || 0) + (remainingSpend * rate);
      }

      routingInfo[cat] = {
        category_id: cat,
        total_monthly_spend: spend,
        allocations: catRoutingCards,
        primary_card_id: catRoutingCards[0] ? catRoutingCards[0].card_id : cards[0].id,
        primary_card_name: catRoutingCards[0] ? catRoutingCards[0].card_name : cards[0].name,
        effective_rate_percent: catRoutingCards[0] ? catRoutingCards[0].rate_percent : 0.0
      };
    }

    return { routingInfo, cardMonthlySpend, cardMonthlyRewards };
  }

  evaluateMilestones(card, annualSpend, weights) {
    let totalMilestoneVal = 0.0;
    const achieved = [];
    if (!card.milestones) return { totalMilestoneVal, achieved };

    for (const ms of card.milestones) {
      if (annualSpend >= ms.spend_threshold_annual) {
        let val = 0;
        if (ms.reward_type === "points") {
          val = ms.reward_value * (card.point_value_inr || 1.0);
        } else if (ms.reward_type === "voucher") {
          val = ms.reward_value * (weights.milestone_travel_voucher_multiplier || 0.85);
        } else {
          val = ms.reward_value;
        }
        totalMilestoneVal += val;
        achieved.push({
          threshold: ms.spend_threshold_annual,
          description: ms.description,
          effective_value_inr: val
        });
      }
    }
    return { totalMilestoneVal, achieved };
  }

  evaluateFee(card, annualSpend) {
    if (card.is_ltf || card.annual_fee <= 0) {
      return { effectiveFee: 0.0, feeWaived: true };
    }
    if (card.fee_waiver_spend_annual && annualSpend >= card.fee_waiver_spend_annual) {
      return { effectiveFee: 0.0, feeWaived: true };
    }
    const gstRate = card.gst_rate !== undefined ? card.gst_rate : 0.18;
    const effectiveFee = card.annual_fee * (1.0 + gstRate);
    return { effectiveFee, feeWaived: false };
  }

  evaluatePerks(card, monthlyFuelSpend, weights, portfolioLoungeUsed = 0) {
    const perks = card.perks || {};
    const rawVisits = perks.domestic_lounges_per_year || 0;
    const effectiveVisits = Math.min(16, rawVisits);
    const capacityRemaining = Math.max(0, 16 - portfolioLoungeUsed);
    const visitsCredited = Math.min(effectiveVisits, capacityRemaining);

    const loungeVal = visitsCredited * (weights.domestic_airport_lounge_unit_value || 1000) * (weights.domestic_airport_lounge_multiplier || 1.0);
    const railwayVal = (perks.railway_lounges_per_year || 0) * (weights.railway_lounge_unit_value || 300) * (weights.railway_lounge_multiplier || 1.0);
    const movieVal = (perks.movie_bogo_monthly_max_discount || 0) * 12.0 * (weights.movie_bogo_multiplier || 1.0);
    const golfVal = Math.min(12, perks.golf_rounds_per_year || 0) * (weights.golf_round_unit_value || 1500) * (weights.golf_round_multiplier || 1.0);

    let fuelVal = 0.0;
    if (perks.fuel_surcharge_waiver && monthlyFuelSpend > 0) {
      const waiver = Math.min(monthlyFuelSpend * 0.01, perks.fuel_surcharge_monthly_cap || 250);
      fuelVal = waiver * 12.0 * (weights.fuel_surcharge_multiplier || 1.0);
    }

    const diningVal = (perks.dining_membership_value || 0) * (weights.dining_membership_multiplier || 1.0);

    const breakdown = {
      lounge_value: Number(loungeVal.toFixed(2)),
      railway_lounge_value: Number(railwayVal.toFixed(2)),
      movie_value: Number(movieVal.toFixed(2)),
      golf_value: Number(golfVal.toFixed(2)),
      fuel_waiver_value: Number(fuelVal.toFixed(2)),
      dining_membership_value: Number(diningVal.toFixed(2))
    };
    const totalPerks = Object.values(breakdown).reduce((a, b) => a + b, 0);

    return { breakdown, totalPerks: Number(totalPerks.toFixed(2)), visitsCredited };
  }

  analyzePortfolio(selectedCards, spendProfile, weights) {
    const monthlySpend = spendProfile.monthly_spend || {};
    const { routingInfo, cardMonthlySpend, cardMonthlyRewards } = this.calculateCategoryRouting(selectedCards, monthlySpend);

    const cardsSummary = [];
    let portfolioLoungeVisits = 0;
    const monthlyFuel = monthlySpend["fuel"] || 0.0;

    for (const card of selectedCards) {
      const cMonthlySpend = cardMonthlySpend[card.id] || {};
      const cAnnualSpend = Object.values(cMonthlySpend).reduce((a, b) => a + b, 0) * 12.0;

      const cCatAnnualSpend = {};
      const cCatAnnualRewards = {};
      for (const [k, v] of Object.entries(cMonthlySpend)) {
        cCatAnnualSpend[k] = v * 12.0;
      }
      for (const [k, v] of Object.entries(cardMonthlyRewards[card.id] || {})) {
        cCatAnnualRewards[k] = v * 12.0;
      }

      const baseRewards = Object.values(cCatAnnualRewards).reduce((a, b) => a + b, 0);
      const { totalMilestoneVal } = this.evaluateMilestones(card, cAnnualSpend, weights);
      const totalRewards = baseRewards + totalMilestoneVal;

      const { effectiveFee, feeWaived } = this.evaluateFee(card, cAnnualSpend);
      const { breakdown, totalPerks, visitsCredited } = this.evaluatePerks(card, monthlyFuel, weights, portfolioLoungeVisits);
      portfolioLoungeVisits += visitsCredited;

      const netVal = totalRewards + totalPerks - effectiveFee;
      const yieldPct = cAnnualSpend > 0 ? (netVal / cAnnualSpend * 100.0) : 0.0;

      cardsSummary.push({
        card_id: card.id,
        card_name: card.name,
        bank: card.bank,
        tier: card.tier,
        allocated_annual_spend: Number(cAnnualSpend.toFixed(2)),
        category_spend: cCatAnnualSpend,
        category_rewards: cCatAnnualRewards,
        base_rewards_earned: Number(baseRewards.toFixed(2)),
        milestone_rewards_earned: Number(totalMilestoneVal.toFixed(2)),
        total_rewards_earned: Number(totalRewards.toFixed(2)),
        effective_annual_fee: Number(effectiveFee.toFixed(2)),
        fee_waived: feeWaived,
        fee_waiver_threshold: card.fee_waiver_spend_annual,
        lounge_value: breakdown.lounge_value,
        railway_lounge_value: breakdown.railway_lounge_value,
        movie_value: breakdown.movie_value,
        golf_value: breakdown.golf_value,
        fuel_waiver_value: breakdown.fuel_waiver_value,
        dining_membership_value: breakdown.dining_membership_value,
        total_perk_value: totalPerks,
        net_value: Number(netVal.toFixed(2)),
        net_yield_percent: Number(yieldPct.toFixed(2))
      });
    }

    return { cardsSummary, routingInfo };
  }

  analyzeGaps(cards, cardsSummary, spendProfile, routingInfo, weights) {
    const gaps = [];
    const monthlySpend = spendProfile.monthly_spend || {};

    // 1. Category Coverage Gaps
    for (const [catId, info] of Object.entries(this.categoryBenchmarks)) {
      const mSpend = monthlySpend[catId] || 0.0;
      const aSpend = mSpend * 12.0;
      if (aSpend <= 0) continue;

      const route = routingInfo[catId] || {};
      const currentRate = (route.effective_rate_percent || 0.0) / 100.0;
      const benchmarkRate = info.benchmark;

      if (currentRate < (benchmarkRate * 0.6)) {
        const gapDiff = benchmarkRate - currentRate;
        const annualLoss = Number((aSpend * gapDiff).toFixed(2));
        const severity = annualLoss > 3000 ? "high" : (annualLoss > 1000 ? "medium" : "low");

        gaps.push({
          gap_type: "category_coverage",
          title: `Suboptimal Rewards on ${info.name}`,
          severity: severity,
          description: `You are spending ₹${aSpend.toLocaleString("en-IN")}/yr on ${info.name}, but earning only ${(currentRate * 100).toFixed(1)}%. Market benchmark is ${(benchmarkRate * 100).toFixed(1)}%+ (${info.topCard}).`,
          category_or_perk: catId,
          current_value: `${(currentRate * 100).toFixed(1)}%`,
          benchmark_value: `${(benchmarkRate * 100).toFixed(1)}%`,
          estimated_annual_loss: annualLoss
        });
      }
    }

    // 2. Missing Perk Gaps
    const totalLounges = cards.reduce((acc, c) => acc + (c.perks ? c.perks.domestic_lounges_per_year || 0 : 0), 0);
    if (totalLounges === 0 && (weights.domestic_airport_lounge_multiplier || 1.0) > 0) {
      const estLoss = 4 * (weights.domestic_airport_lounge_unit_value || 1000) * (weights.domestic_airport_lounge_multiplier || 1.0);
      gaps.push({
        gap_type: "missing_perk",
        title: "No Airport Lounge Access",
        severity: "high",
        description: "None of your current cards provide complimentary domestic airport lounge access.",
        category_or_perk: "domestic_airport_lounge",
        current_value: "0 visits",
        benchmark_value: "4-12 visits/year",
        estimated_annual_loss: Number(estLoss.toFixed(2))
      });
    }

    const hasMovieBogo = cards.some(c => c.perks && c.perks.movie_bogo_monthly_max_discount > 0);
    const movieSpend = monthlySpend["movies_entertainment"] || 0.0;
    if (!hasMovieBogo && movieSpend > 500 && (weights.movie_bogo_multiplier || 1.0) > 0) {
      const estLoss = Math.min(movieSpend, 500) * 12 * 0.5 * (weights.movie_bogo_multiplier || 1.0);
      gaps.push({
        gap_type: "missing_perk",
        title: "Missing Movie Ticket BOGO Benefit",
        severity: "medium",
        description: "You spend on movies & entertainment, but lack a card offering 1+1 BookMyShow/PVR ticket discounts.",
        category_or_perk: "movie_bogo_ticket",
        current_value: "None",
        benchmark_value: "Buy 1 Get 1 free (up to ₹500/mo)",
        estimated_annual_loss: Number(estLoss.toFixed(2))
      });
    }

    const hasFuelWaiver = cards.some(c => c.perks && c.perks.fuel_surcharge_waiver);
    const fuelSpend = monthlySpend["fuel"] || 0.0;
    if (!hasFuelWaiver && fuelSpend > 0) {
      const estLoss = fuelSpend * 0.01 * 12;
      gaps.push({
        gap_type: "missing_perk",
        title: "Missing Fuel Surcharge Waiver",
        severity: estLoss > 600 ? "medium" : "low",
        description: "You spend on fuel without a card that waives the standard 1% fuel surcharge.",
        category_or_perk: "fuel_surcharge_waiver",
        current_value: "No waiver",
        benchmark_value: "1% waiver on ₹400-₹4,000 spends",
        estimated_annual_loss: Number(estLoss.toFixed(2))
      });
    }

    const hasRuPay = cards.some(c => c.rupay_upi_enabled);
    if (!hasRuPay) {
      gaps.push({
        gap_type: "missing_perk",
        title: "No RuPay UPI Credit Card",
        severity: "medium",
        description: "You do not have a RuPay credit card linked to UPI to earn rewards on scan-and-pay transactions at local merchants.",
        category_or_perk: "rupay_upi",
        current_value: "None",
        benchmark_value: "1.5% cashback/coins on UPI",
        estimated_annual_loss: Number(((monthlySpend["general_offline"] || 0) * 0.015 * 6).toFixed(2))
      });
    }

    // 3. Fee Inefficiencies
    for (const q of cardsSummary) {
      if (q.net_value < 0 && q.effective_annual_fee > 0) {
        gaps.push({
          gap_type: "fee_inefficiency",
          title: `Negative ROI on ${q.card_name}`,
          severity: "high",
          description: `You pay ₹${q.effective_annual_fee.toLocaleString("en-IN")} in annual fee + GST for ${q.card_name}, but only generate ₹${(q.total_rewards_earned + q.total_perk_value).toLocaleString("en-IN")} in value. You have a net annual loss of ₹${Math.abs(q.net_value).toLocaleString("en-IN")}.`,
          category_or_perk: q.card_id,
          current_value: `-₹${Math.abs(q.net_value).toLocaleString("en-IN")}`,
          benchmark_value: "Positive Net Return (> ₹0)",
          estimated_annual_loss: Number(Math.abs(q.net_value).toFixed(2))
        });
      }

      if (!q.fee_waived && q.fee_waiver_threshold && q.allocated_annual_spend >= (q.fee_waiver_threshold * 0.75)) {
        const shortfall = q.fee_waiver_threshold - q.allocated_annual_spend;
        gaps.push({
          gap_type: "fee_inefficiency",
          title: `Close to Fee Waiver on ${q.card_name}`,
          severity: "medium",
          description: `You are only ₹${shortfall.toLocaleString("en-IN")} away from waiving the ₹${q.effective_annual_fee.toLocaleString("en-IN")} fee on ${q.card_name} (Target: ₹${q.fee_waiver_threshold.toLocaleString("en-IN")}).`,
          category_or_perk: q.card_id,
          current_value: `Spend: ₹${q.allocated_annual_spend.toLocaleString("en-IN")}`,
          benchmark_value: `Target: ₹${q.fee_waiver_threshold.toLocaleString("en-IN")}`,
          estimated_annual_loss: Number(q.effective_annual_fee.toFixed(2))
        });
      }
    }

    return gaps;
  }

  generateRecommendations(currentCards, cardsSummary, spendProfile, gaps, weights) {
    const currentTotalNet = cardsSummary.reduce((acc, q) => acc + q.net_value, 0);
    const currentIds = new Set(currentCards.map(c => c.id));
    const candidates = this.catalogCards.filter(c => !currentIds.has(c.id));
    const recommendations = [];

    // Evaluate Additions
    for (const cand of candidates) {
      const testPortfolio = [...currentCards, cand];
      const { cardsSummary: testSummary } = this.analyzePortfolio(testPortfolio, spendProfile, weights);
      const newTotalNet = testSummary.reduce((acc, q) => acc + q.net_value, 0);
      const netGain = newTotalNet - currentTotalNet;

      const featuresGained = [];
      for (const gap of gaps) {
        if (gap.gap_type === "category_coverage") {
          const rate = this.getEffectiveCategoryRate(cand, gap.category_or_perk);
          if (rate >= 0.05) featuresGained.push(`${(rate * 100).toFixed(1)}% on ${gap.title.replace('Suboptimal Rewards on ', '')}`);
        } else if (gap.gap_type === "missing_perk") {
          if (gap.category_or_perk === "domestic_airport_lounge" && cand.perks && cand.perks.domestic_lounges_per_year > 0) {
            featuresGained.push(`${cand.perks.domestic_lounges_per_year} Lounge Visits`);
          } else if (gap.category_or_perk === "movie_bogo_ticket" && cand.perks && cand.perks.movie_bogo_monthly_max_discount > 0) {
            featuresGained.push("Movie BOGO BMS/PVR");
          } else if (gap.category_or_perk === "fuel_surcharge_waiver" && cand.perks && cand.perks.fuel_surcharge_waiver) {
            featuresGained.push("1% Fuel Surcharge Waiver");
          } else if (gap.category_or_perk === "rupay_upi" && cand.rupay_upi_enabled) {
            featuresGained.push("RuPay UPI scan-to-pay");
          }
        }
      }

      if (netGain > 500 || (netGain >= 0 && featuresGained.length > 0)) {
        let reason = `Adding ${cand.name} increases your net annual return by ₹${Math.round(netGain).toLocaleString("en-IN")}/yr after factoring in fees + 18% GST.`;
        if (featuresGained.length > 0) reason += ` Plugs: ${featuresGained.slice(0, 2).join(", ")}.`;

        recommendations.push({
          action: "add",
          card_id: cand.id,
          card_name: cand.name,
          replaces_card_id: null,
          replaces_card_name: null,
          reason: reason,
          projected_net_gain_inr: Number(netGain.toFixed(2)),
          new_portfolio_net_value: Number(newTotalNet.toFixed(2)),
          key_features_gained: featuresGained.slice(0, 4)
        });
      }
    }

    // Evaluate Replacements for underperforming cards
    const underperforming = cardsSummary.filter(q => q.net_value < 1000);
    for (const under of underperforming) {
      const origCard = currentCards.find(c => c.id === under.card_id);
      if (!origCard) continue;

      const without = currentCards.filter(c => c.id !== under.card_id);
      for (const cand of candidates) {
        const testPortfolio = [...without, cand];
        const { cardsSummary: testSummary } = this.analyzePortfolio(testPortfolio, spendProfile, weights);
        const newTotalNet = testSummary.reduce((acc, q) => acc + q.net_value, 0);
        const netGain = newTotalNet - currentTotalNet;

        if (netGain > 1000) {
          const featuresGained = [];
          if (cand.is_ltf && !origCard.is_ltf) featuresGained.push("Eliminates Annual Fee (Lifetime Free)");
          if ((cand.perks?.domestic_lounges_per_year || 0) > (origCard.perks?.domestic_lounges_per_year || 0)) {
            featuresGained.push(`${cand.perks.domestic_lounges_per_year} Lounge visits`);
          }

          recommendations.push({
            action: "replace",
            card_id: cand.id,
            card_name: cand.name,
            replaces_card_id: origCard.id,
            replaces_card_name: origCard.name,
            reason: `Replace ${origCard.name} (which currently yields ₹${Math.round(under.net_value).toLocaleString("en-IN")}/yr) with ${cand.name} to gain an extra ₹${Math.round(netGain).toLocaleString("en-IN")} net annual return.`,
            projected_net_gain_inr: Number(netGain.toFixed(2)),
            new_portfolio_net_value: Number(newTotalNet.toFixed(2)),
            key_features_gained: featuresGained.slice(0, 4)
          });
        }
      }
    }

    recommendations.sort((a, b) => b.projected_net_gain_inr - a.projected_net_gain_inr);
    return recommendations.slice(0, 5);
  }

  runAnalysis(selectedCardIds, spendProfile, weights, customCards = []) {
    const allCards = [...this.catalogCards, ...customCards];
    const cardMap = new Map();
    allCards.forEach(c => cardMap.set(c.id, c));

    const selectedCards = selectedCardIds
      .map(id => cardMap.get(id))
      .filter(Boolean);

    const monthlySpend = spendProfile.monthly_spend || {};
    const totSpend = Object.values(monthlySpend).reduce((a, b) => a + (Number(b) || 0), 0) * 12.0;

    if (selectedCards.length === 0) {
      return {
        total_annual_spend: Number(totSpend.toFixed(2)),
        total_annual_rewards: 0,
        total_perk_value: 0,
        total_fees_paid: 0,
        net_annual_value: 0,
        net_portfolio_yield_percent: 0,
        best_spend_routing: {},
        cards_summary: [],
        gaps: [],
        recommendations: []
      };
    }

    const { cardsSummary, routingInfo } = this.analyzePortfolio(selectedCards, spendProfile, weights);
    const gaps = this.analyzeGaps(selectedCards, cardsSummary, spendProfile, routingInfo, weights);
    const recommendations = this.generateRecommendations(selectedCards, cardsSummary, spendProfile, gaps, weights);

    const totRewards = cardsSummary.reduce((acc, q) => acc + q.total_rewards_earned, 0);
    const totPerks = cardsSummary.reduce((acc, q) => acc + q.total_perk_value, 0);
    const totFees = cardsSummary.reduce((acc, q) => acc + q.effective_annual_fee, 0);
    const netVal = cardsSummary.reduce((acc, q) => acc + q.net_value, 0);
    const netYield = totSpend > 0 ? (netVal / totSpend * 100.0) : 0.0;

    return {
      total_annual_spend: Number(totSpend.toFixed(2)),
      total_annual_rewards: Number(totRewards.toFixed(2)),
      total_perk_value: Number(totPerks.toFixed(2)),
      total_fees_paid: Number(totFees.toFixed(2)),
      net_annual_value: Number(netVal.toFixed(2)),
      net_portfolio_yield_percent: Number(netYield.toFixed(2)),
      best_spend_routing: routingInfo,
      cards_summary: cardsSummary,
      gaps: gaps,
      recommendations: recommendations
    };
  }
}

// Expose globally for browser usage
window.ClientCreditCardEngine = ClientCreditCardEngine;

