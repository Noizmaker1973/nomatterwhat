/**
 * Field definitions for vacancies (units) and applicants, header aliases used
 * to auto-map imported spreadsheets, and value parsers/normalizers.
 *
 * Fair-housing note: applicant fields intentionally exclude protected
 * characteristics (race, religion, national origin, disability status,
 * familial status, source of income as a screening factor, etc.). The only
 * household facts collected are used for occupancy limits and to raise
 * landlord compliance obligations (e.g. MA Lead Law), never to exclude.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./ma-geo'));
  else (root.RM = root.RM || {}).schema = factory(root.RM.geo);
})(typeof self !== 'undefined' ? self : this, function (geo) {
  'use strict';

  const UNIT_FIELDS = [
    { key: 'id', label: 'Unit ID', type: 'string', aliases: ['unit id', 'listing id', 'listing #', 'mls', 'mls #', 'mls number', 'property id'] },
    { key: 'status', label: 'Status', type: 'enum', options: ['available', 'pending', 'leased', 'off market'], aliases: ['listing status', 'vacancy status'] },
    { key: 'landlord', label: 'Landlord / Mgmt', type: 'string', aliases: ['owner', 'management', 'management company', 'property manager', 'landlord name', 'owner name'] },
    { key: 'contact', label: 'Landlord contact', type: 'string', aliases: ['landlord contact', 'landlord email', 'landlord phone', 'owner contact', 'listing agent'] },
    { key: 'address', label: 'Street address', type: 'string', aliases: ['street', 'street address', 'property address', 'address line 1'] },
    { key: 'unitNumber', label: 'Unit #', type: 'string', aliases: ['unit', 'apt', 'apt #', 'unit number', 'apartment'] },
    { key: 'town', label: 'Town / City', type: 'string', aliases: ['city', 'municipality', 'town city'] },
    { key: 'neighborhood', label: 'Neighborhood', type: 'string', aliases: ['village', 'area', 'section'] },
    { key: 'zip', label: 'ZIP', type: 'string', aliases: ['zip code', 'zipcode', 'postal code'] },
    { key: 'rent', label: 'Monthly rent', type: 'money', aliases: ['monthly rent', 'price', 'list price', 'asking rent', 'rent amount', 'asking price'] },
    { key: 'bedrooms', label: 'Bedrooms', type: 'beds', aliases: ['beds', 'br', 'bed', 'bdrms', 'number of bedrooms'] },
    { key: 'bathrooms', label: 'Bathrooms', type: 'number', aliases: ['baths', 'ba', 'bath', 'full baths'] },
    { key: 'sqft', label: 'Sq ft', type: 'number', aliases: ['square feet', 'sq ft', 'size', 'living area'] },
    { key: 'availableDate', label: 'Available date', type: 'date', aliases: ['available', 'availability', 'date available', 'available on', 'move in date'] },
    { key: 'leaseTermMonths', label: 'Lease term (months)', type: 'number', aliases: ['lease term', 'lease', 'lease length', 'term', 'lease months'] },
    { key: 'petPolicy', label: 'Pets allowed', type: 'list', aliases: ['pets', 'pet policy', 'pets allowed'], hint: 'none, cats, dogs, or cats; dogs' },
    { key: 'amenities', label: 'Amenities', type: 'list', aliases: ['features', 'unit features', 'building amenities'], hint: 'parking; in-unit laundry; dishwasher; near transit…' },
    { key: 'yearBuilt', label: 'Year built', type: 'number', aliases: ['built', 'year'] },
    { key: 'leadCompliant', label: 'Lead compliance letter/certificate', type: 'bool', aliases: ['lead certificate', 'deleaded', 'lead compliant', 'lead safe', 'lead paint compliant'] },
    { key: 'maxOccupants', label: 'Max occupants', type: 'number', aliases: ['occupancy', 'max occupancy', 'occupancy limit'] },
    { key: 'minCreditScore', label: 'Min credit score', type: 'number', aliases: ['min credit', 'minimum credit score', 'credit score min', 'credit requirement', 'min fico'] },
    { key: 'incomeMultiple', label: 'Income requirement (× monthly rent)', type: 'multiple', aliases: ['income multiple', 'income requirement', 'income x rent', 'rent to income', 'income ratio'], hint: '3 (monthly) or 40x (annual)' },
    { key: 'allowsCosigner', label: 'Accepts co-signer / guarantor', type: 'bool', aliases: ['cosigner', 'co signer', 'guarantor', 'guarantors accepted', 'cosigner allowed'] },
    { key: 'allowsPriorEvictions', label: 'Considers prior evictions', type: 'bool', aliases: ['prior evictions ok', 'evictions considered', 'eviction policy'] },
    { key: 'acceptsVouchers', label: 'Accepts vouchers', type: 'bool', aliases: ['section 8', 'vouchers', 'accepts section 8', 'voucher', 'rental assistance'] },
    { key: 'lastMonthRequired', label: 'Last month required', type: 'bool', aliases: ['last month', 'last months rent', 'lmr'] },
    { key: 'securityDeposit', label: 'Security deposit', type: 'money', aliases: ['security', 'deposit', 'sec dep'] },
    { key: 'brokerFee', label: 'Broker fee', type: 'money', aliases: ['broker fee', 'fee', 'brokers fee'] },
    { key: 'brokerFeeTenantPays', label: 'Tenant pays broker fee', type: 'bool', aliases: ['tenant pays fee', 'fee paid by tenant', 'tenant fee'] },
    { key: 'applicationFee', label: 'Application fee', type: 'money', aliases: ['app fee', 'application fee'] },
    { key: 'notes', label: 'Notes', type: 'text', aliases: ['comments', 'description', 'remarks'] },
  ];

  const APPLICANT_FIELDS = [
    { key: 'id', label: 'Applicant ID', type: 'string', aliases: ['applicant id', 'client id', 'application id', 'lead id'] },
    { key: 'status', label: 'Status', type: 'enum', options: ['active', 'placed', 'inactive'], aliases: ['client status', 'search status'] },
    { key: 'name', label: 'Name', type: 'string', aliases: ['full name', 'applicant', 'applicant name', 'client', 'client name', 'tenant name'] },
    { key: 'email', label: 'Email', type: 'string', aliases: ['email address', 'e mail'] },
    { key: 'phone', label: 'Phone', type: 'string', aliases: ['phone number', 'mobile', 'cell'] },
    { key: 'householdSize', label: 'Household size', type: 'number', aliases: ['occupants', 'number of occupants', 'people', 'household'] },
    { key: 'childUnder6', label: 'Child under 6 in household', type: 'bool', aliases: ['child under 6', 'children under 6', 'kids under 6'], hint: 'Used only to flag landlord Lead Law duties — never to exclude' },
    { key: 'maxRent', label: 'Max rent', type: 'money', aliases: ['budget', 'max budget', 'rent budget', 'max monthly rent', 'price max'] },
    { key: 'minBedrooms', label: 'Min bedrooms', type: 'beds', aliases: ['bedrooms', 'beds', 'br', 'beds needed', 'min beds'] },
    { key: 'minBathrooms', label: 'Min bathrooms', type: 'number', aliases: ['bathrooms', 'baths', 'min baths'] },
    { key: 'locations', label: 'Desired towns / regions', type: 'list', aliases: ['desired locations', 'locations', 'towns', 'desired towns', 'areas', 'neighborhoods', 'preferred areas'], hint: 'Somerville; Cambridge; North Shore' },
    { key: 'moveInDate', label: 'Move-in date', type: 'date', aliases: ['move in', 'move in date', 'desired move in', 'target move in', 'start date'] },
    { key: 'moveInFlexDays', label: 'Move-in flexibility (days)', type: 'number', aliases: ['flexibility', 'flex days', 'date flexibility'] },
    { key: 'leaseTermMonths', label: 'Lease term wanted (months)', type: 'number', aliases: ['lease term', 'lease length', 'term'] },
    { key: 'pets', label: 'Pets', type: 'list', aliases: ['pet', 'pet type', 'animals'], hint: 'cat; dog' },
    { key: 'assistanceAnimal', label: 'Assistance / service animal', type: 'bool', aliases: ['service animal', 'esa', 'emotional support animal', 'assistance animal'] },
    { key: 'mustHaves', label: 'Must-haves', type: 'list', aliases: ['must haves', 'requirements', 'needs', 'required amenities'] },
    { key: 'niceToHaves', label: 'Nice-to-haves', type: 'list', aliases: ['nice to haves', 'wants', 'preferences', 'preferred amenities'] },
    { key: 'annualIncome', label: 'Gross annual income', type: 'money', aliases: ['income', 'annual income', 'household income', 'gross income', 'yearly income'] },
    { key: 'monthlyIncome', label: 'Gross monthly income', type: 'money', aliases: ['monthly income'], importOnly: true },
    { key: 'creditScore', label: 'Credit score', type: 'number', aliases: ['credit', 'fico', 'fico score'] },
    { key: 'hasVoucher', label: 'Has housing voucher', type: 'bool', aliases: ['voucher', 'section 8', 'mrvp', 'housing voucher', 'rental assistance'] },
    { key: 'voucherAmount', label: 'Voucher monthly subsidy', type: 'money', aliases: ['voucher amount', 'subsidy', 'hap', 'subsidy amount'] },
    { key: 'hasCosigner', label: 'Has co-signer / guarantor', type: 'bool', aliases: ['cosigner', 'co signer', 'guarantor'] },
    { key: 'cosignerAnnualIncome', label: 'Co-signer annual income', type: 'money', aliases: ['cosigner income', 'guarantor income'] },
    { key: 'priorEvictions', label: 'Prior evictions (count)', type: 'number', aliases: ['evictions', 'eviction history', 'prior eviction'] },
    { key: 'upfrontFunds', label: 'Funds available for move-in', type: 'money', aliases: ['move in funds', 'savings', 'cash available', 'upfront funds', 'funds available'] },
    { key: 'notes', label: 'Notes', type: 'text', aliases: ['comments', 'remarks'] },
  ];

  // Canonical amenity tokens and the phrases that map to them.
  const AMENITIES = {
    parking: ['parking', 'off street parking', 'garage', 'driveway', 'parking space', 'parking included', 'garage parking'],
    in_unit_laundry: ['in unit laundry', 'w d', 'wd', 'washer dryer', 'laundry in unit', 'wd in unit', 'w d in unit', 'washer and dryer'],
    laundry: ['laundry', 'laundry on site', 'laundry in building', 'coin laundry', 'shared laundry', 'on site laundry'],
    dishwasher: ['dishwasher', 'dw'],
    central_air: ['central air', 'ac', 'a c', 'air conditioning', 'central ac', 'cooling'],
    outdoor_space: ['outdoor space', 'balcony', 'deck', 'patio', 'yard', 'porch', 'roof deck', 'private yard'],
    heat_included: ['heat included', 'heat', 'heat incl'],
    hot_water_included: ['hot water included', 'hot water'],
    utilities_included: ['utilities included', 'all utilities included', 'utilities'],
    elevator: ['elevator'],
    accessible: ['accessible', 'wheelchair accessible', 'ada', 'handicap accessible', 'step free', 'no stairs'],
    first_floor: ['first floor', 'ground floor', '1st floor'],
    near_transit: ['near transit', 'near t', 'mbta', 'transit', 'commuter rail', 'near train', 'near bus', 'subway'],
    gym: ['gym', 'fitness center', 'fitness'],
    storage: ['storage', 'basement storage'],
    furnished: ['furnished'],
    concierge: ['concierge', 'doorman'],
    hardwood: ['hardwood', 'hardwood floors'],
  };
  const AMENITY_LABELS = {
    parking: 'Parking', in_unit_laundry: 'In-unit laundry', laundry: 'Laundry on-site',
    dishwasher: 'Dishwasher', central_air: 'A/C', outdoor_space: 'Outdoor space',
    heat_included: 'Heat included', hot_water_included: 'Hot water included',
    utilities_included: 'Utilities included', elevator: 'Elevator', accessible: 'Accessible',
    first_floor: 'First floor', near_transit: 'Near transit', gym: 'Gym', storage: 'Storage',
    furnished: 'Furnished', concierge: 'Concierge', hardwood: 'Hardwood floors',
  };
  // Having the key amenity also satisfies the listed ones.
  const AMENITY_IMPLIES = {
    in_unit_laundry: ['laundry'],
    utilities_included: ['heat_included', 'hot_water_included'],
    elevator: ['accessible'],
  };

  const norm = geo.norm;
  const amenityIndex = new Map();
  for (const [token, phrases] of Object.entries(AMENITIES)) {
    amenityIndex.set(norm(token), token);
    for (const p of phrases) amenityIndex.set(norm(p), token);
  }

  function canonicalAmenity(s) {
    const n = norm(s);
    return amenityIndex.get(n) || n.replace(/ /g, '_');
  }
  function amenityLabel(token) {
    return AMENITY_LABELS[token] || String(token).replace(/_/g, ' ');
  }
  /** Expand a unit's amenity list with implied amenities. */
  function expandAmenities(list) {
    const set = new Set((list || []).map(canonicalAmenity));
    for (const t of [...set]) for (const imp of AMENITY_IMPLIES[t] || []) set.add(imp);
    return set;
  }

  // ---- value parsers ----------------------------------------------------

  function parseMoney(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    let s = String(v).trim().toLowerCase().replace(/[$,\s]/g, '').replace(/\/(mo|month|yr|year)$/, '');
    let mult = 1;
    if (/k$/.test(s)) { mult = 1000; s = s.slice(0, -1); }
    const n = parseFloat(s);
    return Number.isFinite(n) ? Math.round(n * mult * 100) / 100 : null;
  }

  function parseNumber(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const m = String(v).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  }

  function parseBeds(v) {
    if (v === null || v === undefined || v === '') return null;
    if (/studio|efficiency/i.test(String(v))) return 0;
    return parseNumber(v);
  }

  /**
   * Income requirement as a multiple of monthly rent. Values above 12 are
   * treated as the common "annual income = 40× monthly rent" convention.
   */
  function parseMultiple(v) {
    const n = parseNumber(v);
    if (n === null) return null;
    return n > 12 ? Math.round((n / 12) * 100) / 100 : n;
  }

  function parseBool(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'boolean') return v;
    const s = String(v).trim().toLowerCase();
    if (['y', 'yes', 'true', '1', 'x', 'ok', 'allowed', 'accepted', 'required', 'included'].includes(s)) return true;
    if (['n', 'no', 'false', '0', 'none', 'not allowed', 'not accepted', 'n/a'].includes(s)) return false;
    if (/^(yes|y)\b/.test(s)) return true;
    if (/^(no|n)\b/.test(s)) return false;
    return null;
  }

  function parseList(v) {
    if (v === null || v === undefined || v === '') return [];
    if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
    return String(v).split(/[;|\n]|,(?![^(]*\))/).map((x) => x.trim()).filter(Boolean);
  }

  const pad = (n) => String(n).padStart(2, '0');
  function todayISO(now = new Date()) {
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  /** Parse a date-ish value to 'YYYY-MM-DD' (or null). */
  function parseDate(v, now = new Date()) {
    if (v === null || v === undefined || v === '') return null;
    const s = String(v).trim().toLowerCase();
    if (/^(now|immediate|immediately|asap|today|available now|vacant)$/.test(s)) return todayISO(now);
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    m = s.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/);
    if (m) {
      let y = m[3] ? parseInt(m[3], 10) : now.getFullYear();
      if (y < 100) y += 2000;
      return `${y}-${pad(m[1])}-${pad(m[2])}`;
    }
    m = s.match(/^([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?$/);
    if (m && MONTHS.includes(m[1])) {
      const mo = MONTHS.indexOf(m[1]) + 1;
      let y = m[3] ? parseInt(m[3], 10) : now.getFullYear();
      if (!m[3] && new Date(y, mo - 1, parseInt(m[2], 10)) < new Date(now.getFullYear(), now.getMonth(), now.getDate())) y++;
      return `${y}-${pad(mo)}-${pad(m[2])}`;
    }
    const d = new Date(String(v));
    return isNaN(d) ? null : todayISO(d);
  }

  const PARSERS = {
    string: (v) => (v === null || v === undefined ? '' : String(v).trim()),
    text: (v) => (v === null || v === undefined ? '' : String(v).trim()),
    enum: (v) => (v === null || v === undefined ? '' : String(v).trim().toLowerCase()),
    money: parseMoney, number: parseNumber, beds: parseBeds, multiple: parseMultiple,
    bool: parseBool, list: parseList, date: parseDate,
  };

  // ---- header mapping ---------------------------------------------------

  function fieldsFor(kind) { return kind === 'unit' ? UNIT_FIELDS : APPLICANT_FIELDS; }

  /** Map spreadsheet headers to field keys: {header: fieldKey|null}. */
  function autoMapHeaders(headers, kind) {
    const fields = fieldsFor(kind);
    const index = new Map();
    for (const f of fields) {
      for (const name of [f.key, f.label, ...(f.aliases || [])]) {
        const n = norm(name).replace(/ /g, '');
        if (!index.has(n)) index.set(n, f.key);
      }
    }
    const used = new Set();
    const mapping = {};
    for (const h of headers) {
      const key = index.get(norm(h).replace(/ /g, ''));
      if (key && !used.has(key)) { mapping[h] = key; used.add(key); } else mapping[h] = null;
    }
    return mapping;
  }

  /** Convert one raw row into a normalized unit/applicant using a header mapping. */
  function normalizeRecord(raw, kind, mapping) {
    const fields = fieldsFor(kind);
    const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
    const out = {};
    const extra = {};
    for (const [header, value] of Object.entries(raw)) {
      const key = mapping ? mapping[header] : (byKey[header] ? header : null);
      if (key && byKey[key]) out[key] = PARSERS[byKey[key].type](value);
      else if (value !== '' && value !== null && value !== undefined && header !== 'region' && header !== 'extra') extra[header] = value;
    }
    if (raw.extra && typeof raw.extra === 'object') Object.assign(extra, raw.extra);
    if (Object.keys(extra).length) out.extra = extra;
    return finalize(out, kind);
  }

  /** Fill defaults and derived values on a parsed record. */
  function finalize(rec, kind) {
    const fields = fieldsFor(kind);
    for (const f of fields) {
      if (f.importOnly) continue;
      if (!(f.key in rec)) rec[f.key] = f.type === 'list' ? [] : (['string', 'text', 'enum'].includes(f.type) ? '' : null);
    }
    if (kind === 'unit') {
      if (!rec.status) rec.status = 'available';
      // "Dorchester" in the town column → town Boston, neighborhood Dorchester.
      const place = geo.resolvePlace(rec.town);
      if (place && place.neighborhood) {
        if (!rec.neighborhood) rec.neighborhood = place.neighborhood;
        rec.town = place.town;
      } else if (place) {
        rec.town = place.town;
      } else if (rec.neighborhood) {
        const n = geo.resolvePlace(rec.neighborhood);
        if (n && n.neighborhood) rec.town = n.town;
      }
      rec.region = geo.regionOf(rec.town) || 'Other MA';
    } else {
      if (!rec.status) rec.status = 'active';
      if ((rec.annualIncome === null || rec.annualIncome === undefined) && rec.monthlyIncome) rec.annualIncome = rec.monthlyIncome * 12;
      delete rec.monthlyIncome;
    }
    return rec;
  }

  function templateCSVHeader(kind) {
    return fieldsFor(kind).filter((f) => !f.importOnly).map((f) => f.label);
  }

  return {
    UNIT_FIELDS, APPLICANT_FIELDS, AMENITIES, AMENITY_LABELS, fieldsFor,
    canonicalAmenity, amenityLabel, expandAmenities,
    parseMoney, parseNumber, parseBeds, parseMultiple, parseBool, parseList, parseDate, todayISO,
    PARSERS, autoMapHeaders, normalizeRecord, finalize, templateCSVHeader,
  };
});
