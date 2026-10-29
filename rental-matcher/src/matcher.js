/**
 * Matching engine: scores applicant ↔ unit pairs on three layers.
 *
 *   1. Dealbreakers – hard constraints (budget, size, location, timing,
 *      pets, must-have amenities, occupancy). Any dealbreaker → "not a fit".
 *   2. Application compatibility – would the applicant pass the landlord's
 *      screening (income, credit, eviction policy, move-in funds)?
 *      → qualified / conditional / not qualified.
 *   3. Fit score (0–100) – how well the unit matches what the client wants.
 *
 * Massachusetts rules are applied, not just flagged: income tests for voucher
 * holders use the tenant's share of rent, voucher refusals are ignored
 * (source-of-income discrimination, M.G.L. c.151B §4(10)), and assistance
 * animals are never treated as pets.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./ma-geo'), require('./schema'));
  else (root.RM = root.RM || {}).matcher = factory(root.RM.geo, root.RM.schema);
})(typeof self !== 'undefined' ? self : this, function (geo, schema) {
  'use strict';

  const DEFAULT_SETTINGS = {
    rentTolerancePct: 5,        // how far over budget is still shown (with a penalty)
    strictLocation: true,       // outside every preferred region → dealbreaker
    defaultFlexDays: 30,        // applicant move-in flexibility when not given
    earlyAvailabilityDays: 45,  // unit vacant this much before move-in → landlord may not wait
    weights: { budget: 25, location: 20, timing: 15, size: 10, amenities: 15, lease: 5, upfront: 10 },
  };

  const STATUS_ORDER = { qualified: 0, conditional: 1, not_qualified: 2, not_a_fit: 3 };
  const STATUS_LABELS = {
    qualified: 'Qualified', conditional: 'Conditional', not_qualified: 'Not qualified', not_a_fit: 'Not a fit',
  };

  const DAY = 86400000;
  const toDate = (iso) => (iso ? new Date(iso + 'T00:00:00') : null);
  const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
  const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

  function mergeSettings(s) {
    s = s || {};
    return { ...DEFAULT_SETTINGS, ...s, weights: { ...DEFAULT_SETTINGS.weights, ...(s.weights || {}) } };
  }

  /** Tenant's monthly share of rent (voucher subsidy subtracted). */
  function tenantPortion(applicant, unit) {
    if (applicant.hasVoucher && isNum(applicant.voucherAmount)) return Math.max(0, unit.rent - applicant.voucherAmount);
    return unit.rent;
  }

  /** Total cash due at lease signing under the unit's terms. */
  function moveInCost(applicant, unit) {
    const share = tenantPortion(applicant, unit);
    const items = [{ label: 'First month', amount: share }];
    if (unit.lastMonthRequired) items.push({ label: 'Last month', amount: share });
    if (isNum(unit.securityDeposit) && unit.securityDeposit > 0) items.push({ label: 'Security deposit', amount: unit.securityDeposit });
    if (unit.brokerFeeTenantPays && isNum(unit.brokerFee) && unit.brokerFee > 0) items.push({ label: 'Broker fee', amount: unit.brokerFee });
    return { total: items.reduce((a, b) => a + b.amount, 0), items };
  }

  /** Landlord-term compliance flags that don't depend on the applicant. */
  function unitCompliance(unit) {
    const flags = [];
    if (isNum(unit.applicationFee) && unit.applicationFee > 0) {
      flags.push({ level: 'warning', code: 'application_fee', message: `Application fee of ${money(unit.applicationFee)} listed. MA law (M.G.L. c.186 §15B) limits upfront charges to first month, last month, security deposit and a lock-change fee.` });
    }
    if (isNum(unit.securityDeposit) && isNum(unit.rent) && unit.securityDeposit > unit.rent) {
      flags.push({ level: 'warning', code: 'deposit_cap', message: `Security deposit (${money(unit.securityDeposit)}) exceeds one month's rent — not permitted under M.G.L. c.186 §15B.` });
    }
    if (unit.acceptsVouchers === false) {
      flags.push({ level: 'warning', code: 'voucher_refusal', message: 'Listed as not accepting vouchers. Refusing housing-subsidy holders is source-of-income discrimination in MA (M.G.L. c.151B §4(10)). Voucher holders are still matched to this unit.' });
    }
    if (unit.brokerFeeTenantPays && isNum(unit.brokerFee) && unit.brokerFee > 0) {
      flags.push({ level: 'info', code: 'broker_fee', message: 'Tenant-paid broker fee listed. Since Aug 1, 2025, MA requires the party who hired the broker to pay the fee — confirm the tenant engaged the broker.' });
    }
    if (isNum(unit.yearBuilt) && unit.yearBuilt < 1978 && unit.leadCompliant !== true) {
      flags.push({ level: 'info', code: 'lead_unknown', message: `Built ${unit.yearBuilt} (pre-1978) with no lead compliance letter on file.` });
    }
    return flags;
  }

  /** Where the unit sits relative to the applicant's preferred places. */
  function locationMatch(applicant, unit) {
    const prefs = applicant.locations || [];
    if (!prefs.length) return { level: 'open' };
    const unitTown = geo.norm(unit.town);
    const unitHood = geo.norm(unit.neighborhood);
    const unitRegion = unit.region || geo.regionOf(unit.town);
    const siblingRegions = new Set();
    for (const p of prefs) {
      const region = geo.asRegion(p);
      if (region) {
        if (region === unitRegion) return { level: 'exact', label: region };
        continue;
      }
      const place = geo.resolvePlace(p);
      if (place.neighborhood) {
        if (geo.norm(place.neighborhood) === unitHood) return { level: 'exact', label: place.neighborhood };
        if (geo.norm(place.town) === unitTown) siblingRegions.add('__town__:' + place.town);
      } else if (geo.norm(place.town) === unitTown) {
        return { level: 'exact', label: place.town };
      }
      if (place.region) siblingRegions.add(place.region);
    }
    for (const r of siblingRegions) {
      if (r.startsWith('__town__:')) return { level: 'town', label: r.slice(9) };
    }
    if (unitRegion && siblingRegions.has(unitRegion)) return { level: 'region', label: unitRegion };
    return { level: 'outside' };
  }

  function petConflicts(applicant, unit) {
    const pets = (applicant.pets || []).map((p) => geo.norm(p)).filter((p) => p && !['none', 'no', 'n a'].includes(p));
    if (!pets.length) return [];
    const policy = (unit.petPolicy || []).map((p) => geo.norm(p));
    if (!policy.length) return pets.map((p) => ({ pet: p, unknown: true }));
    const allowsAll = policy.some((p) => /^(yes|all|any|allowed|pets ok|pet friendly|negotiable|case by case)$/.test(p));
    const none = policy.every((p) => /^(none|no|no pets|not allowed)$/.test(p));
    const out = [];
    for (const pet of pets) {
      if (allowsAll) continue;
      if (none) { out.push({ pet }); continue; }
      const kind = /cat|kitten/.test(pet) ? 'cat' : /dog|pupp/.test(pet) ? 'dog' : pet;
      const ok = policy.some((p) => p.includes(kind) || (kind !== 'cat' && kind !== 'dog' && /small pets|other/.test(p)));
      if (!ok) out.push({ pet });
    }
    return out;
  }

  /**
   * Evaluate one applicant ↔ unit pair.
   * @returns {object} result with status, score, breakdown, reasons and flags.
   */
  function evaluate(applicant, unit, settings, now) {
    const S = mergeSettings(settings);
    const W = S.weights;
    const today = now ? new Date(now) : new Date();
    const dealbreakers = [];
    const highlights = [];
    const concerns = [];
    const checks = [];
    const compliance = unitCompliance(unit).filter((f) => f.code !== 'voucher_refusal' || applicant.hasVoucher);
    const fit = {};

    // ---- Budget --------------------------------------------------------
    if (!isNum(unit.rent)) {
      fit.budget = { score: 0, max: W.budget, note: 'Unit rent unknown' };
      concerns.push('Unit rent not listed');
    } else if (!isNum(applicant.maxRent)) {
      fit.budget = { score: W.budget * 0.5, max: W.budget, note: 'Client budget not set' };
    } else {
      const over = unit.rent - applicant.maxRent;
      const tol = applicant.maxRent * (S.rentTolerancePct / 100);
      if (over <= 0) {
        fit.budget = { score: W.budget, max: W.budget, note: `${money(-over)} under budget` };
        if (-over >= applicant.maxRent * 0.1) highlights.push(`${money(-over)}/mo under budget`);
      } else if (over <= tol) {
        const frac = tol > 0 ? over / tol : 1;
        fit.budget = { score: W.budget * (0.6 - 0.4 * frac), max: W.budget, note: `${money(over)} over budget` };
        concerns.push(`${money(over)}/mo over budget`);
      } else {
        fit.budget = { score: 0, max: W.budget, note: `${money(over)} over budget` };
        dealbreakers.push(`Rent ${money(unit.rent)} is ${money(over)} over the ${money(applicant.maxRent)} budget`);
      }
    }

    // ---- Location ------------------------------------------------------
    const loc = locationMatch(applicant, unit);
    const where = [unit.neighborhood, unit.town].filter(Boolean).join(', ');
    if (loc.level === 'exact') {
      fit.location = { score: W.location, max: W.location, note: `In ${loc.label}` };
      highlights.push(`In preferred area (${loc.label})`);
    } else if (loc.level === 'town') {
      fit.location = { score: W.location * 0.8, max: W.location, note: `Elsewhere in ${loc.label}` };
    } else if (loc.level === 'region') {
      fit.location = { score: W.location * 0.5, max: W.location, note: `Same region (${loc.label})` };
      concerns.push(`${where || 'Unit'} is nearby, not in a listed town`);
    } else if (loc.level === 'open') {
      fit.location = { score: W.location * 0.7, max: W.location, note: 'No location preference' };
    } else {
      fit.location = { score: 0, max: W.location, note: 'Outside preferred areas' };
      if (S.strictLocation) dealbreakers.push(`${where || 'Unit'} is outside the client's preferred areas`);
      else concerns.push(`${where || 'Unit'} is outside preferred areas`);
    }

    // ---- Timing --------------------------------------------------------
    const want = toDate(applicant.moveInDate);
    const avail = toDate(unit.availableDate) || today;
    const flex = isNum(applicant.moveInFlexDays) ? applicant.moveInFlexDays : S.defaultFlexDays;
    if (!want) {
      fit.timing = { score: W.timing * 0.6, max: W.timing, note: 'Move-in date not set' };
    } else {
      const diff = Math.round((avail - want) / DAY); // + = unit ready after client wants it
      if (diff > flex) {
        fit.timing = { score: 0, max: W.timing, note: `Available ${diff} days after move-in` };
        dealbreakers.push(`Available ${unit.availableDate} — ${diff} days after the ${applicant.moveInDate} move-in (flex ${flex}d)`);
      } else if (diff > 0) {
        fit.timing = { score: W.timing * (1 - 0.5 * (diff / Math.max(flex, 1))), max: W.timing, note: `Available ${diff} days after move-in` };
        concerns.push(`Client would wait ${diff} days to move in`);
      } else {
        const early = -diff;
        const win = S.earlyAvailabilityDays;
        if (early <= 14) {
          fit.timing = { score: W.timing, max: W.timing, note: 'Dates line up' };
          highlights.push('Availability lines up with move-in');
        } else if (early <= win) {
          fit.timing = { score: W.timing * (1 - 0.5 * ((early - 14) / Math.max(win - 14, 1))), max: W.timing, note: `Vacant ${early} days before move-in` };
        } else {
          fit.timing = { score: W.timing * 0.3, max: W.timing, note: `Vacant ${early} days before move-in` };
          concerns.push(`Unit is ready ${early} days early — landlord may not hold it`);
        }
      }
    }

    // ---- Size & occupancy ---------------------------------------------
    if (isNum(applicant.minBedrooms) && isNum(unit.bedrooms) && unit.bedrooms < applicant.minBedrooms) {
      dealbreakers.push(`${unit.bedrooms || 'Studio'} BR — client needs ${applicant.minBedrooms}+`);
      fit.size = { score: 0, max: W.size, note: 'Too few bedrooms' };
    } else {
      let bedScore = 0.7;
      let note = 'Bedrooms OK';
      if (isNum(applicant.minBedrooms) && isNum(unit.bedrooms)) {
        const extra = unit.bedrooms - applicant.minBedrooms;
        bedScore = extra === 0 ? 1 : extra === 1 ? 0.85 : 0.7;
        if (extra >= 1) note = `${extra} extra bedroom${extra > 1 ? 's' : ''}`;
      }
      let bathScore = 1;
      if (isNum(applicant.minBathrooms) && isNum(unit.bathrooms) && unit.bathrooms < applicant.minBathrooms) {
        bathScore = 0.3;
        concerns.push(`${unit.bathrooms} bath — client wants ${applicant.minBathrooms}`);
      }
      fit.size = { score: W.size * (0.7 * bedScore + 0.3 * bathScore), max: W.size, note };
    }
    if (isNum(unit.maxOccupants) && isNum(applicant.householdSize) && applicant.householdSize > unit.maxOccupants) {
      dealbreakers.push(`Household of ${applicant.householdSize} exceeds the ${unit.maxOccupants}-occupant limit`);
      compliance.push({ level: 'info', code: 'occupancy', message: 'Occupancy limits must be based on the State Sanitary Code (105 CMR 410), not a landlord preference — verify the limit if it seems low.' });
    }

    // ---- Pets ----------------------------------------------------------
    for (const c of petConflicts(applicant, unit)) {
      if (c.unknown) concerns.push(`Pet policy unknown (client has ${c.pet})`);
      else dealbreakers.push(`No ${c.pet}s allowed`);
    }
    if (applicant.assistanceAnimal) {
      compliance.push({ level: 'info', code: 'assistance_animal', message: 'Client has an assistance animal. It is not a pet: no-pet policies and pet fees do not apply (reasonable accommodation under fair housing law).' });
    }

    // ---- Amenities -----------------------------------------------------
    const have = schema.expandAmenities(unit.amenities);
    const missingMust = (applicant.mustHaves || []).map(schema.canonicalAmenity).filter((a) => !have.has(a));
    for (const a of missingMust) dealbreakers.push(`Missing must-have: ${schema.amenityLabel(a)}`);
    const nice = (applicant.niceToHaves || []).map(schema.canonicalAmenity);
    const must = (applicant.mustHaves || []).map(schema.canonicalAmenity);
    const wanted = [...new Set([...must, ...nice])];
    if (!wanted.length) {
      fit.amenities = { score: W.amenities * 0.7, max: W.amenities, note: 'No amenity preferences' };
    } else {
      const got = wanted.filter((a) => have.has(a));
      fit.amenities = { score: W.amenities * (got.length / wanted.length), max: W.amenities, note: `${got.length}/${wanted.length} wanted amenities` };
      const niceGot = nice.filter((a) => have.has(a) && !must.includes(a));
      if (niceGot.length) highlights.push('Has ' + niceGot.map(schema.amenityLabel).join(', '));
      const niceMissing = nice.filter((a) => !have.has(a));
      if (niceMissing.length) concerns.push('No ' + niceMissing.map(schema.amenityLabel).join(', '));
    }

    // ---- Lease term ----------------------------------------------------
    if (!isNum(applicant.leaseTermMonths) || !isNum(unit.leaseTermMonths)) {
      fit.lease = { score: W.lease * 0.8, max: W.lease, note: 'Term flexible / unknown' };
    } else {
      const d = Math.abs(applicant.leaseTermMonths - unit.leaseTermMonths);
      fit.lease = { score: W.lease * (d === 0 ? 1 : d <= 3 ? 0.6 : 0.2), max: W.lease, note: `${unit.leaseTermMonths}-mo lease` };
      if (d > 3) concerns.push(`${unit.leaseTermMonths}-month lease (client wants ${applicant.leaseTermMonths})`);
    }

    // ---- Application compatibility ------------------------------------
    const share = isNum(unit.rent) ? tenantPortion(applicant, unit) : null;
    const monthlyIncome = isNum(applicant.annualIncome) ? applicant.annualIncome / 12 : null;

    // Income
    if (!isNum(unit.incomeMultiple) || share === null) {
      checks.push({ check: 'Income', result: 'pass', note: 'No income requirement listed' });
    } else {
      const required = unit.incomeMultiple * share;
      const basis = applicant.hasVoucher ? `${unit.incomeMultiple}× tenant share ${money(share)}` : `${unit.incomeMultiple}× rent`;
      if (applicant.hasVoucher && !isNum(applicant.voucherAmount)) {
        checks.push({ check: 'Income', result: 'unknown', note: 'Voucher amount unknown — income test should apply only to the tenant’s share of rent' });
      } else if (monthlyIncome === null) {
        checks.push({ check: 'Income', result: 'unknown', note: `Needs ${money(required)}/mo (${basis}); client income not on file` });
      } else if (monthlyIncome >= required) {
        checks.push({ check: 'Income', result: 'pass', note: `${money(monthlyIncome)}/mo ≥ ${money(required)} (${basis})` });
      } else if (unit.allowsCosigner !== false && applicant.hasCosigner && isNum(applicant.cosignerAnnualIncome) && applicant.cosignerAnnualIncome / 12 >= required) {
        checks.push({ check: 'Income', result: 'conditional', note: `Short on own income (${money(monthlyIncome)} < ${money(required)}); qualifies with co-signer` });
      } else if (monthlyIncome >= required * 0.9) {
        checks.push({ check: 'Income', result: 'conditional', note: `${money(monthlyIncome)}/mo is just under ${money(required)} (${basis})` });
      } else {
        checks.push({ check: 'Income', result: 'fail', note: `${money(monthlyIncome)}/mo < ${money(required)} required (${basis})` });
      }
    }

    // Credit
    if (!isNum(unit.minCreditScore)) {
      checks.push({ check: 'Credit', result: 'pass', note: 'No minimum listed' });
    } else if (!isNum(applicant.creditScore)) {
      checks.push({ check: 'Credit', result: 'unknown', note: `Minimum ${unit.minCreditScore}; client score not on file` });
    } else if (applicant.creditScore >= unit.minCreditScore) {
      checks.push({ check: 'Credit', result: 'pass', note: `${applicant.creditScore} ≥ ${unit.minCreditScore}` });
    } else if (unit.allowsCosigner !== false && applicant.hasCosigner) {
      checks.push({ check: 'Credit', result: 'conditional', note: `${applicant.creditScore} < ${unit.minCreditScore}; may qualify with co-signer` });
    } else if (applicant.creditScore >= unit.minCreditScore - 20) {
      checks.push({ check: 'Credit', result: 'conditional', note: `${applicant.creditScore} is just under ${unit.minCreditScore}` });
    } else {
      checks.push({ check: 'Credit', result: 'fail', note: `${applicant.creditScore} < ${unit.minCreditScore} minimum` });
    }

    // Rental history
    if (isNum(applicant.priorEvictions) && applicant.priorEvictions > 0) {
      if (unit.allowsPriorEvictions === false) {
        checks.push({ check: 'Rental history', result: 'conditional', note: `${applicant.priorEvictions} prior eviction(s); landlord policy excludes evictions — discuss circumstances before applying` });
      } else {
        checks.push({ check: 'Rental history', result: 'conditional', note: `${applicant.priorEvictions} prior eviction(s) — be ready to explain` });
      }
    } else {
      checks.push({ check: 'Rental history', result: 'pass', note: 'No evictions reported' });
    }

    // Move-in funds
    let cost = null;
    if (share !== null) {
      cost = moveInCost(applicant, unit);
      if (!isNum(applicant.upfrontFunds)) {
        checks.push({ check: 'Move-in funds', result: 'unknown', note: `${money(cost.total)} due at signing; client funds not on file` });
        fit.upfront = { score: W.upfront * 0.5, max: W.upfront, note: `${money(cost.total)} due at signing` };
      } else if (applicant.upfrontFunds >= cost.total) {
        checks.push({ check: 'Move-in funds', result: 'pass', note: `${money(applicant.upfrontFunds)} covers ${money(cost.total)}` });
        fit.upfront = { score: W.upfront, max: W.upfront, note: `${money(cost.total)} due at signing` };
      } else {
        const ratio = applicant.upfrontFunds / cost.total;
        checks.push({ check: 'Move-in funds', result: ratio >= 0.75 ? 'conditional' : 'fail', note: `${money(applicant.upfrontFunds)} of ${money(cost.total)} due at signing` });
        fit.upfront = { score: W.upfront * Math.max(0, ratio - 0.5), max: W.upfront, note: `Short ${money(cost.total - applicant.upfrontFunds)}` };
      }
    } else {
      fit.upfront = { score: 0, max: W.upfront, note: 'Unknown' };
    }

    // Applicant-specific compliance
    if (applicant.childUnder6 && isNum(unit.yearBuilt) && unit.yearBuilt < 1978 && unit.leadCompliant !== true) {
      compliance.push({ level: 'warning', code: 'lead_law', message: 'Child under 6 + pre-1978 unit without a lead compliance letter: the MA Lead Law requires the owner to delead, and the owner cannot refuse to rent for this reason (M.G.L. c.111 §199A).' });
    }
    if (applicant.hasVoucher) {
      compliance.push({ level: 'info', code: 'voucher_process', message: 'Voucher holder: the unit must pass the housing authority’s inspection and rent-reasonableness review before lease-up — plan extra time.' });
    }

    // ---- Roll-up -------------------------------------------------------
    const maxTotal = Object.values(fit).reduce((a, f) => a + f.max, 0) || 1;
    const rawTotal = Object.values(fit).reduce((a, f) => a + f.score, 0);
    const score = Math.round((rawTotal / maxTotal) * 100);

    let status;
    if (dealbreakers.length) status = 'not_a_fit';
    else if (checks.some((c) => c.result === 'fail')) status = 'not_qualified';
    else if (checks.some((c) => c.result === 'conditional' || c.result === 'unknown')) status = 'conditional';
    else status = 'qualified';

    return {
      applicantId: applicant.id,
      unitId: unit.id,
      status,
      statusLabel: STATUS_LABELS[status],
      score,
      fit,
      checks,
      dealbreakers,
      highlights,
      concerns,
      compliance,
      tenantPortion: share,
      moveIn: cost,
    };
  }

  function compareResults(a, b) {
    return (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) || (b.score - a.score);
  }

  const isActiveUnit = (u) => !u.status || u.status === 'available';
  const isActiveApplicant = (a) => !a.status || a.status === 'active';

  /** Rank all available units for an applicant. */
  function matchApplicant(applicant, units, settings, now) {
    return units.filter(isActiveUnit).map((u) => evaluate(applicant, u, settings, now)).sort(compareResults);
  }

  /** Rank all active applicants for a unit. */
  function matchUnit(unit, applicants, settings, now) {
    return applicants.filter(isActiveApplicant).map((a) => evaluate(a, unit, settings, now)).sort(compareResults);
  }

  /** Every active applicant × available unit pair, best first. */
  function matchAll(applicants, units, settings, now) {
    const out = [];
    for (const a of applicants.filter(isActiveApplicant)) {
      for (const u of units.filter(isActiveUnit)) out.push(evaluate(a, u, settings, now));
    }
    return out.sort(compareResults);
  }

  return {
    DEFAULT_SETTINGS, STATUS_LABELS, STATUS_ORDER, mergeSettings,
    evaluate, matchApplicant, matchUnit, matchAll, compareResults,
    tenantPortion, moveInCost, unitCompliance, locationMatch, isActiveUnit, isActiveApplicant,
  };
});
