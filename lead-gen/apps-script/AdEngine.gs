/**
 * ============================================================================
 *  AD ENGINE  —  one rental listing in, ready-to-post ads for every channel out
 *  Built for: James E. Guilford III  |  DiBiasio Realty
 * ============================================================================
 *
 *  WHAT IT DOES
 *    1. parseListing()  — takes the text you copy off a Zillow or Facebook
 *                         Marketplace listing and pulls out rent, beds, baths,
 *                         address, features, description.
 *    2. lintListing()   — fair housing + MA landlord-tenant check. Flags
 *                         language that is illegal or risky in an ad.
 *    3. generateAds()   — writes platform-native copy for Craigslist, FB
 *                         Marketplace, Zillow, Apartments.com, Nextdoor,
 *                         Instagram/Facebook, Meta Ads, Google Ads, Google
 *                         Business Profile, and past-prospect outreach.
 *                         Every ad carries a tracking ref (DBR-XXXX-CL) so the
 *                         Rental Lead Digest can tell you which ad produced
 *                         each lead.
 *    4. matchProspects()— finds past leads whose stated city / bedrooms /
 *                         budget fit this unit, for re-marketing.
 *
 *  This file is PURE JavaScript — no Google services — so the same code runs
 *  in Apps Script, in the standalone browser page, and in the Node tests.
 *  Google-specific glue lives in AdConverter.gs.
 *
 *  FAIR HOUSING
 *    Same rules as the digest. Ads describe the UNIT, never the tenant.
 *    Sentences the linter rates 'block' are dropped from every generated ad.
 *    Prospect matching uses only what the prospect asked for (city, bedrooms,
 *    budget) — never anything about who they are.
 * ============================================================================
 */


/* ==========================================================================
 *  PLATFORM CATALOG
 * ========================================================================== */

function adPlatforms() {
  return [
    { key: 'craigslist',     code: 'CL', label: 'Craigslist',                      kind: 'Free listing',   medium: 'classified',  source: 'craigslist',
      postUrl: 'https://post.craigslist.org/' },
    { key: 'marketplace',    code: 'FB', label: 'Facebook Marketplace',            kind: 'Free listing',   medium: 'classified',  source: 'facebook_marketplace',
      postUrl: 'https://www.facebook.com/marketplace/create/rental' },
    { key: 'zillow',         code: 'ZL', label: 'Zillow Rental Manager',           kind: 'Free listing',   medium: 'listing',     source: 'zillow',
      postUrl: 'https://www.zillow.com/rental-manager/' },
    { key: 'apartments',     code: 'AP', label: 'Apartments.com',                  kind: 'Free listing',   medium: 'listing',     source: 'apartments_com',
      postUrl: 'https://www.apartments.com/' },
    { key: 'nextdoor',       code: 'ND', label: 'Nextdoor',                        kind: 'Community post', medium: 'social',      source: 'nextdoor',
      postUrl: 'https://nextdoor.com/' },
    { key: 'social',         code: 'IG', label: 'Instagram / Facebook post',       kind: 'Organic social', medium: 'social',      source: 'instagram',
      postUrl: 'https://www.instagram.com/' },
    { key: 'metaAds',        code: 'MA', label: 'Meta Ads (Facebook + Instagram)', kind: 'Paid',           medium: 'paid_social', source: 'meta_ads',
      postUrl: 'https://adsmanager.facebook.com/' },
    { key: 'googleAds',      code: 'GA', label: 'Google Ads (Search)',             kind: 'Paid',           medium: 'cpc',         source: 'google_ads',
      postUrl: 'https://ads.google.com/' },
    { key: 'googleBusiness', code: 'GB', label: 'Google Business Profile',         kind: 'Free post',      medium: 'organic',     source: 'google_business',
      postUrl: 'https://business.google.com/' },
    { key: 'outreach',       code: 'EM', label: 'Past-prospect outreach',          kind: 'Re-marketing',   medium: 'email',       source: 'lead_outreach',
      postUrl: '' }
  ];
}


/* ==========================================================================
 *  MASSACHUSETTS GEOGRAPHY  —  city detection + regional hashtags
 * ========================================================================== */

function aeMaCities_() {
  return {
    'MetroWest': ['framingham', 'natick', 'ashland', 'holliston', 'marlborough', 'hudson',
      'sudbury', 'wayland', 'southborough', 'northborough', 'westborough', 'milford',
      'hopkinton', 'sherborn', 'medway', 'franklin', 'bellingham'],
    'Worcester County': ['worcester', 'fitchburg', 'leominster', 'gardner', 'clinton', 'webster',
      'southbridge', 'shrewsbury', 'auburn', 'millbury', 'grafton', 'oxford', 'spencer',
      'leicester', 'holden', 'west boylston', 'uxbridge', 'whitinsville', 'northbridge'],
    'Greater Boston': ['boston', 'quincy', 'somerville', 'cambridge', 'malden', 'medford',
      'revere', 'everett', 'chelsea', 'waltham', 'brookline', 'watertown', 'dedham',
      'randolph', 'newton', 'needham', 'wellesley', 'weston', 'braintree', 'weymouth',
      'dorchester', 'roxbury', 'jamaica plain', 'brighton', 'allston', 'east boston'],
    'Western Mass': ['springfield', 'west springfield', 'chicopee', 'holyoke', 'pittsfield',
      'westfield', 'agawam', 'ludlow', 'northampton', 'amherst', 'east longmeadow', 'longmeadow'],
    'North Shore': ['lynn', 'salem', 'peabody', 'beverly', 'gloucester', 'danvers', 'saugus'],
    'Merrimack Valley': ['lowell', 'lawrence', 'haverhill', 'methuen', 'andover', 'dracut', 'chelmsford'],
    'South Shore & South Coast': ['brockton', 'new bedford', 'fall river', 'taunton', 'attleboro',
      'plymouth', 'stoughton', 'easton', 'mansfield']
  };
}

function aeRegionFor_(city) {
  const c = (city || '').toLowerCase().trim();
  const map = aeMaCities_();
  for (const region in map) {
    if (map[region].indexOf(c) !== -1) return region;
  }
  return '';
}

function aeDetectCity_(text) {
  const t = ' ' + (text || '').toLowerCase().replace(/[^a-z ]/g, ' ') + ' ';
  const map = aeMaCities_();
  let best = '';
  for (const region in map) {
    map[region].forEach(function (city) {
      // Longest match wins so "west springfield" beats "springfield".
      if (t.indexOf(' ' + city + ' ') !== -1 && city.length > best.length) best = city;
    });
  }
  return best ? aeTitleCase_(best) : '';
}


/* ==========================================================================
 *  1. PARSE  —  pasted listing text -> structured listing
 * ========================================================================== */

/**
 * @param {string} text   Everything you selected and copied off the listing page.
 * @param {string} hint   Optional: 'zillow' | 'marketplace' | 'other'. Auto-detected if blank.
 * @return {Object} listing
 */
function parseListing(text, hint) {
  const raw = (text || '').replace(/ /g, ' ').replace(/\r/g, '');
  const lines = raw.split('\n').map(function (l) { return l.trim(); }).filter(String);
  const flat = lines.join('\n');
  const head = lines.slice(0, 20).join('\n');

  const L = {
    source: hint && hint !== 'auto' ? hint : aeDetectSource_(flat),
    title: '', propertyType: '', address: '', unit: '', city: '', state: 'MA', zip: '',
    rent: '', beds: '', baths: '', sqft: '', available: '', leaseTerm: '', deposit: '',
    pets: '', laundry: '', parking: '', utilities: [], amenities: [], description: '',
    missing: []
  };

  // --- Money ---------------------------------------------------------------
  L.rent = aeParseRent_(lines);
  const dep = flat.match(/security\s+deposit[^$\d\n]{0,20}\$?\s?([\d,]{3,6})/i) ||
              flat.match(/\bdeposit[^$\d\n]{0,12}\$\s?([\d,]{3,6})/i);
  if (dep) L.deposit = aeNum_(dep[1]);

  // --- Size ----------------------------------------------------------------
  let m = flat.match(/\bbedrooms?\s*:\s*(\d{1,2})\b/i) ||
          flat.match(/\b(\d{1,2})\s*(?:bd|bds|beds?|bedrooms?|br|bdrms?)\b/i);
  if (m) L.beds = m[1];
  else if (/\bstudio\b/i.test(head)) L.beds = '0';

  m = flat.match(/\b(?:full\s+)?bathrooms?\s*:\s*(\d{1,2}(?:\.\d)?)\b/i) ||
      flat.match(/\b(\d{1,2}(?:\.\d)?)\s*(?:ba|baths?|bathrooms?|bth)\b/i);
  if (m) L.baths = m[1];

  m = flat.match(/\b(\d{1,2},\d{3}|\d{3,5})\s*(?:sq\.?\s*ft\.?|sqft|square\s+f(?:ee|oo)t|sf)\b/i);
  if (m) L.sqft = aeNum_(m[1]);

  // --- Location ------------------------------------------------------------
  aeParseAddress_(lines, L);

  // --- Dates & terms -------------------------------------------------------
  m = flat.match(/\bavailable\s*(?:on|from|starting|date)?\s*:?\s*(now|immediately|today|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?)/i) ||
      flat.match(/\bmove[- ]in(?:\s+date)?\s*:?\s*(now|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?)/i);
  if (m) L.available = aeCleanDate_(m[1]);

  m = flat.match(/\blease(?:\s+(?:term|length|duration))?\s*:?\s*(\d{1,2})\s*(?:-|\s)?\s*months?\b/i) ||
      flat.match(/\b(\d{1,2})[- ]month\s+lease\b/i);
  if (m) L.leaseTerm = m[1] + ' months';
  else if (/\b(1|one)[- ]year lease\b|\byearly lease\b|\bannual lease\b/i.test(flat)) L.leaseTerm = '12 months';
  else if (/\bmonth[- ]to[- ]month\b/i.test(flat)) L.leaseTerm = 'Month-to-month';

  // --- Features ------------------------------------------------------------
  L.propertyType = aeParseType_(lines);
  L.pets = aeParsePets_(flat);
  L.laundry = aeParseLaundry_(flat);
  L.parking = aeParseParking_(flat);
  L.utilities = aeParseUtilities_(flat);
  L.amenities = aeParseAmenities_(flat);

  // --- Words ---------------------------------------------------------------
  L.title = aeParseTitle_(lines, L);
  L.description = aeParseDescription_(lines);

  L.missing = listingMissing(L);
  return L;
}


/** Fields a good ad needs that the parser couldn't find. */
function listingMissing(L) {
  const need = { rent: 'Rent', beds: 'Bedrooms', baths: 'Bathrooms', city: 'City', available: 'Available date' };
  return Object.keys(need).filter(function (k) { return L[k] === '' || L[k] == null; })
    .map(function (k) { return need[k]; });
}


function aeDetectSource_(t) {
  if (/zillow|zestimate|rental manager|facts\s*&\s*features|what's special/i.test(t)) return 'zillow';
  if (/marketplace|listed .{1,30} ago|seller information|is this still available|send seller a message|rental details/i.test(t)) return 'marketplace';
  return 'other';
}


function aeParseRent_(lines) {
  const perMonth = /\$\s?(\d{1,2},\d{3}|\d{3,5})(?:\.\d{2})?\s*(?:\+\s*)?(?:\/\s*mo(?:nth)?\b|per\s+month|a\s+month|\/\s*month|monthly|mo\b)/i;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(perMonth);
    if (m) return aeNum_(m[1]);
  }
  // Fallback: first plausible dollar amount on a line that isn't a fee/deposit.
  for (let i = 0; i < lines.length; i++) {
    if (/deposit|fee|zestimate|income|credit|save|\$\s?\d+\s*off/i.test(lines[i])) continue;
    const m = lines[i].match(/\$\s?(\d{1,2},\d{3}|\d{3,5})\b/);
    if (m) {
      const n = Number(aeNum_(m[1]));
      if (n >= 300 && n <= 25000) return String(n);
    }
  }
  return '';
}


function aeParseAddress_(lines, L) {
  const suffix = '(?:St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Ct|Court|Pl|Place|Way|Blvd|Boulevard|' +
                 'Ter|Terrace|Cir|Circle|Pkwy|Parkway|Hwy|Highway|Sq|Square|Pike|Tpke|Turnpike|Row|Path|Trl|Trail|Ext|Hill|Park)';
  const addrRe = new RegExp('\\b(\\d{1,6}[A-Za-z]?(?:\\s+[A-Za-z0-9.\'-]+){1,4}?\\s+' + suffix + ')\\b\\.?' +
                            '(?:\\s*,?\\s*(?:#|Apt\\.?|Unit|Ste\\.?|Fl\\.?|Floor)\\s*([\\w-]+))?', 'i');
  const cszRe = /([A-Z][A-Za-z.' -]{1,30}?),\s*(MA|Massachusetts)\b\.?\s*(\d{5})?/;

  const top = lines.slice(0, 25);
  for (let i = 0; i < top.length; i++) {
    const a = top[i].match(addrRe);
    if (a && !/\b(bed|bath|sq|ago)\b/i.test(a[1])) {
      L.address = a[1].replace(/\s+/g, ' ');
      if (a[2]) L.unit = a[2];
      break;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const c = lines[i].match(cszRe);
    if (c) {
      const city = c[1].replace(/^(?:listed .* in|located in|in)\s+/i, '').trim();
      // Reject a match that swallowed part of the street line.
      if (!/\d/.test(city) && city.split(' ').length <= 3) {
        L.city = aeTitleCase_(city);
        L.zip = c[3] || L.zip;
        break;
      }
    }
  }
  if (!L.zip) {
    const z = lines.join(' ').match(/\bMA\s+(0[12]\d{3})\b/);
    if (z) L.zip = z[1];
  }
  if (!L.city) L.city = aeDetectCity_(lines.join(' '));
}


function aeParseType_(lines) {
  const exact = /^(apartment|condo|condominium|townhouse|townhome|house|single[- ]family(?: residence| home)?|multi[- ]family|duplex|room|studio|loft)$/i;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(exact);
    if (m) return aeNormType_(m[1]);
  }
  const t = lines.slice(0, 30).join(' ');
  const m = t.match(/\b(apartment|condo|townhouse|townhome|single[- ]family home|house|loft|room for rent|studio)\b/i);
  return m ? aeNormType_(m[1]) : 'Apartment';
}

function aeNormType_(t) {
  t = t.toLowerCase();
  if (/town/.test(t)) return 'Townhouse';
  if (/condo/.test(t)) return 'Condo';
  if (/single|house/.test(t)) return 'House';
  if (/room/.test(t)) return 'Room';
  if (/loft/.test(t)) return 'Loft';
  return 'Apartment';  // studio, duplex, multi-family units all advertise as apartments
}


function aePetSentences_(t) {
  return (t.match(/[^.\n]*\b(pets?|cats?|dogs?|animals?)\b[^.\n]*/gi) || []).join(' ').toLowerCase();
}

function aeParsePets_(t) {
  const s = aePetSentences_(t);
  if (!s) return '';
  if (/\bno (pets|animals|dogs or cats|cats or dogs)\b|pets? not (allowed|permitted)|no pets allowed/.test(s)) return 'No pets';
  const cats = /\bcats?\b/.test(s);
  const dogs = /\bdogs?\b/.test(s);
  const small = /small dogs?/.test(s);
  if (/negotiable|case[- ]by[- ]case/.test(s)) return 'Pets negotiable';
  if (cats && dogs) return small ? 'Cats & small dogs OK' : 'Cats & dogs OK';
  if (cats) return 'Cats OK';
  if (dogs) return small ? 'Small dogs OK' : 'Dogs OK';
  if (/pet[- ]friendly|pets? (ok|allowed|welcome)/.test(s)) return 'Pet friendly';
  return '';
}


function aeParseLaundry_(t) {
  if (/in[- ]unit (laundry|washer)|washer\s*(?:\/|and|&)\s*dryer\s+(?:in[- ]unit|in the unit|included|in apartment)|w\/d in[- ]unit|laundry in[- ]unit|in[- ]unit w\/d/i.test(t)) return 'In-unit washer/dryer';
  if (/laundry (?:in|on)[- ](?:the\s+)?(?:building|site|premises|basement)|shared laundry|coin[- ]op|on[- ]site laundry|laundry room|free laundry|basement laundry/i.test(t)) return 'Laundry on site';
  if (/hook[- ]?ups?/i.test(t)) return 'Washer/dryer hookups';
  return '';
}


function aeParseParking_(t) {
  let m = t.match(/\b(\d)\s*(?:off[- ]street\s+|assigned\s+|deeded\s+|dedicated\s+)?parking\s+spaces?\b/i) ||
          t.match(/\bparking\s+for\s+(\d)\s+cars?\b/i) ||
          t.match(/\b(\d)\s+(?:car|vehicle)\s+(?:off[- ]street\s+)?parking\b/i);
  const offStreet = /off[- ]street|driveway|assigned parking|private parking|parking lot/i.test(t);
  if (/\bgarage\b/i.test(t) && !/no garage/i.test(t)) {
    return m ? 'Garage + ' + m[1] + (m[1] === '1' ? ' space' : ' spaces') : 'Garage parking';
  }
  if (m) {
    const n = m[1];
    return n + (offStreet ? ' off-street parking ' : ' parking ') + (n === '1' ? 'space' : 'spaces');
  }
  if (offStreet) return 'Off-street parking';
  if (/street parking/i.test(t)) return 'Street parking';
  return '';
}


function aeParseUtilities_(t) {
  const out = [];
  const segs = t.match(/[^.\n;]{0,90}\b(?:included|includes|incl\.?|paid by (?:the )?(?:landlord|owner))\b[^.\n;]{0,70}/gi) || [];
  const util = [
    ['Heat',        /\bheat(?:ing)?\b/i],
    ['Hot water',   /\bhot water\b/i],
    ['Electricity', /\belectric(?:ity)?\b/i],
    ['Gas',         /\b(?:cooking )?gas\b(?! stove| range)/i],
    ['Water/sewer', /(?:^|[^t] )\bwater\b(?! heater)|\bsewer\b/i],
    ['Trash',       /\btrash|garbage|rubbish\b/i],
    ['Internet',    /\binternet|wi-?fi\b/i]
  ];
  segs.forEach(function (seg) {
    if (/\bnot included|\bno utilities|\btenant pays|\bexcluded\b/i.test(seg)) return;
    // A segment like "Heat included  Hardwood floors" — only look left of "included".
    const left = seg.split(/\b(?:included|includes|incl\.?)\b/i);
    const scope = /utilities (?:included|include)/i.test(seg) ? seg : (left[0] || seg);
    util.forEach(function (u) {
      if (u[1].test(scope) && out.indexOf(u[0]) === -1) out.push(u[0]);
    });
  });
  // "Hot water" match must not also count as Water/sewer.
  if (out.indexOf('Hot water') !== -1 && out.indexOf('Water/sewer') !== -1 &&
      !/\bsewer\b|water\s*(?:\/|and|&)\s*sewer|cold water/i.test(segs.join(' '))) {
    out.splice(out.indexOf('Water/sewer'), 1);
  }
  if (!out.length && /\ball utilities included|utilities included\b/i.test(t) &&
      !/no utilities included|utilities not included/i.test(t)) out.push('All utilities');
  return out;
}


function aeAmenityRules_() {
  return [
    ['Central air',           /central (?:air|a\/?c)\b/i],
    ['Air conditioning',      /\b(?:a\/c|air[- ]condition(?:ing|er|ed)?|mini[- ]splits?|ac units?)\b/i],
    ['Dishwasher',            /dish\s?washer/i],
    ['Updated kitchen',       /(?:updated|renovated|new|remodeled|modern) kitchen/i],
    ['Stainless appliances',  /stainless/i],
    ['Stone countertops',     /granite|quartz/i],
    ['Hardwood floors',       /hardwood/i],
    ['Recently renovated',    /\b(?:fully |newly |recently )?(?:renovated|remodeled|rehabbed)\b/i],
    ['Private deck',          /\bdeck\b/i],
    ['Porch',                 /\bporch\b/i],
    ['Balcony',               /\bbalcon(?:y|ies)\b/i],
    ['Patio',                 /\bpatio\b/i],
    ['Fenced yard',           /fenced(?:[- ]in)? (?:back)?yard/i],
    ['Yard',                  /\b(?:back|front|side|private|shared|large|big)?\s?yard\b/i],
    ['Extra storage',         /\bstorage\b|\bbasement\b/i],
    ['Walk-in closet',        /walk[- ]in closet/i],
    ['Fireplace',             /fireplace/i],
    ['Elevator',              /\belevator\b/i],
    ['Fitness center',        /\bgym\b|fitness (?:center|room)/i],
    ['Pool',                  /\bpool\b/i],
    ['Near commuter rail',    /commuter rail|mbta|train station|\bt[- ]stop\b|\bt station\b|walk to (?:the )?train/i],
    ['Easy highway access',   /\b(?:i-?\s?\d{2,3}|route\s?\d{1,3}|rte\.?\s?\d{1,3}|rt\.?\s?\d{1,3}|mass\s?pike|interstate)\b/i],
    ['Walk to downtown',      /walk(?:ing distance)? to (?:downtown|town center|the center|shops|restaurants)/i],
    ['On a bus line',         /bus (?:line|stop|route)/i]
  ];
}

function aeParseAmenities_(t) {
  const out = [];
  aeAmenityRules_().forEach(function (r) {
    if (r[1].test(t)) out.push(r[0]);
  });
  // Collapse overlaps so the feature list doesn't say the same thing twice.
  if (out.indexOf('Central air') !== -1) aeRemove_(out, 'Air conditioning');
  if (out.indexOf('Fenced yard') !== -1) aeRemove_(out, 'Yard');
  if (out.indexOf('Updated kitchen') !== -1 && /renovated kitchen|remodeled kitchen/i.test(t) &&
      !/\b(?:fully |newly |recently )(?:renovated|remodeled)\b/i.test(t)) aeRemove_(out, 'Recently renovated');
  return out;
}


function aeNoiseLine_(l) {
  return /^(skip|zillow|marketplace|share|save|hide|more|contact|request a tour|message|send|apply|report|back to search|see (?:all|more)|show more|listed by|seller|location is approximate|today|is this still available|send seller a message|rental details|map|directions|street view|photos?|\d+\s*photos?|\d+\s*\/\s*\d+|zestimate|price history|nearby|schools|neighborhood|similar|commute|facts\s*&\s*features|interior|exterior|building|bedrooms & bathrooms|tour|get pre-?qualified|ad|sponsored|·)\b/i.test(l) ||
    /^[\d$,.\s·|\/-]+$/.test(l);
}


function aeParseTitle_(lines, L) {
  for (let i = 0; i < Math.min(lines.length, 12); i++) {
    const l = lines[i];
    if (aeNoiseLine_(l) || l.length < 12 || l.length > 110) continue;
    if (/^(available|move[- ]in|cats?|dogs?|pets?|no pets|in[- ]unit|laundry|\d+\s*parking|parking|heat|apartment|condo|townhouse|house)\b/i.test(l)) continue;
    if (/\$/.test(l) && !/\b(bed|br|bd|room)\b/i.test(l)) continue;
    if (L.address && l.indexOf(L.address) !== -1) continue;
    if (/[a-z]/i.test(l)) return l;
  }
  return '';
}


function aeParseDescription_(lines) {
  const startRe = /^(description|what'?s special|about (?:this|the) (?:home|property|rental|unit|apartment)|seller'?s description|overview|property description|details)\s*:?$/i;
  const stopRe = /^(facts|features|interior|exterior|building|amenities|contact|listed by|seller information|seller details|map|nearby|schools|neighborhood|price history|similar|today|rental price|location is approximate|send seller|is this still available|rental details|commute|getting around|tour|request a tour)\b/i;

  let picked = [];
  for (let i = 0; i < lines.length; i++) {
    if (!startRe.test(lines[i])) continue;
    for (let j = i + 1; j < lines.length; j++) {
      if (stopRe.test(lines[j]) || startRe.test(lines[j])) break;
      picked.push(lines[j]);
    }
    if (picked.length) break;
  }
  // Only keep prose: chip rows like "Heat included  Hardwood floors" aren't sentences.
  picked = picked.filter(function (l) { return /[.!?]/.test(l) || l.length >= 80; });

  if (!picked.length) {
    picked = lines.filter(function (l) {
      return !aeNoiseLine_(l) && l.length >= 60 && l.split(/\s+/).length >= 9 && /[a-z]/.test(l);
    });
  }
  return picked.join(' ').replace(/\s+/g, ' ').trim().slice(0, 2000);
}


/* ==========================================================================
 *  2. LINT  —  fair housing + MA landlord-tenant rules
 *  severity 'block' = illegal ad language; dropped from every generated ad.
 *  severity 'warn'  = risky; review before posting.
 *  severity 'info'  = something MA law makes you handle a specific way.
 * ========================================================================== */

function aeLintRules_() {
  const SOI = 'Source of income: M.G.L. c.151B §4(10)';
  return [
    { id: 'source-of-income', severity: 'block', law: SOI,
      re: /\b(?:no|not accepting|won'?t accept|will not accept|does not accept|doesn'?t accept|cannot accept|can'?t accept|not taking)\s+(?:any\s+)?(?:section\s*(?:8|eight)|vouchers?|housing (?:choice |assistance|programs?)|programs?|subsidi[sz]ed|subsid(?:y|ies)|rental assistance|mrvp|raft|home ?base|welfare|public assistance|ssi|ssdi|government assistance|third[- ]party (?:payments?|payers?))\b/i,
      fix: 'Remove it. In MA you must accept every lawful source of income, including vouchers. "All lawful sources of income welcome" brings in more leads.' },
    { id: 'source-of-income-2', severity: 'block', law: SOI,
      re: /\b(?:section\s*(?:8|eight)|vouchers?|programs?|subsidies)\s+(?:not accepted|not allowed|need not apply|not considered|ineligible|not welcome)\b/i,
      fix: 'Remove it. Voucher holders are a protected class in Massachusetts.' },
    { id: 'employment-only', severity: 'warn', law: SOI,
      re: /\b(?:must (?:be|have) (?:employed|a job|full[- ]time (?:job|employment|work))|employed (?:applicants|tenants|persons) only|proof of employment required|working (?:professionals?|people|persons) only|must work)\b/i,
      fix: 'Screen on ability to pay rent from any lawful income (wages, SSI/SSDI, child support, vouchers), not on having a job.' },
    { id: 'income-multiple', severity: 'warn', law: SOI,
      re: /\b\d(?:\.\d)?\s*(?:x|times)\s+(?:the\s+)?(?:monthly\s+)?rent\b|\bincome (?:of |must be )?(?:at least )?\d(?:\.\d)?\s*(?:x|times)\b/i,
      fix: 'If a voucher pays part of the rent, apply the income ratio only to the tenant\'s share. Applying it to full rent screens out voucher holders.' },
    { id: 'familial-status', severity: 'block', law: 'Familial status: Fair Housing Act §3604(c), c.151B; MA lead law c.111 §199A',
      re: /\b(?:no (?:kids|children|child|infants?|babies|toddlers|families)|adults? only|adult (?:community|building|living)|not (?:suitable|ideal|appropriate|safe) for (?:kids|children|families|young children)|(?:perfect|ideal|great) for (?:an? )?(?:working |young |professional |retired |quiet )*(?:couples?|singles?|single (?:person|professional|adult)|individuals?|empty[- ]nesters?|bachelors?)|one person only|single (?:person|occupant|adult) only|lead paint)\b/i,
      fix: 'Describe the unit, not the tenant. MA also bars refusing families with children under 6 because of lead paint; the owner must delead.' },
    { id: 'professional', severity: 'warn', law: 'Familial status / source of income (HUD and MA AG guidance)',
      re: /\b(?:perfect|ideal|great|suited) for (?:an? )?(?:working |young |busy )?(?:professionals?|grad(?:uate)? students?|students?|nurses?|doctors?)\b/i,
      fix: 'Saying who the unit is "perfect for" implies who it isn\'t for. Describe commute, space and features instead.' },
    { id: 'occupancy', severity: 'warn', law: 'Familial status',
      re: /\b(?:max(?:imum)?\.? (?:of )?\d+ (?:people|persons|occupants|tenants)|no more than \d+ (?:people|persons|occupants))\b/i,
      fix: 'Occupancy limits come from the State Sanitary Code (105 CMR 410), not the ad. Leave them out.' },
    { id: 'marital-status', severity: 'block', law: 'Marital status: c.151B',
      re: /\b(?:married couples? only|must be married|no (?:unmarried|single parents?|single moms?|single mothers?|single dads?|single fathers?))\b/i,
      fix: 'Remove it. Marital status is protected in Massachusetts.' },
    { id: 'age', severity: 'block', law: 'Age: c.151B',
      re: /\b(?:mature|older|young|younger|retired)\s+(?:person|persons|tenants?|adults?|couples?|individuals?|professionals?|people|residents?|applicants?)\b|\bno (?:seniors|elderly|retirees|young people)\b/i,
      fix: 'Remove it. Age is protected. Only certified 55+/62+ housing may advertise an age preference.' },
    { id: 'age-senior', severity: 'warn', law: 'Age: c.151B (housing-for-older-persons exemption)',
      re: /\b(?:seniors? only|55\s?\+|62\s?\+|senior (?:housing|community|building))\b/i,
      fix: 'Only allowed if the property legally qualifies as housing for older persons. Remove it otherwise.' },
    { id: 'disability', severity: 'block', law: 'Disability: Fair Housing Act, c.151B',
      re: /\b(?:able[- ]bodied|no wheelchairs\b|must (?:be able to )?(?:climb|walk)|no (?:service|assistance|emotional support|support|therapy) (?:animals?|dogs?)|no esas?\b|no mental(?:ly)?|must be (?:in good health|healthy|physically fit)|no (?:disabled|handicapped)|no (?:oxygen|walkers))\b/i,
      fix: 'Remove it. Describe physical facts instead ("third-floor walk-up, no elevator").' },
    { id: 'religion', severity: 'block', law: 'Religion: Fair Housing Act, c.151B',
      re: /\b(?:christian|catholic|muslim|jewish|protestant|mormon|hindu|buddhist|sikh)s?\s+(?:only|preferred|home|household|tenants?|family|families|community|neighborhood)\b|\b(?:church|synagogue|mosque|temple)[- ]going\b/i,
      fix: 'Remove it. Naming a nearby church as a landmark is fine; describing the tenant\'s faith is not.' },
    { id: 'race-national-origin', severity: 'block', law: 'Race / color / national origin / ancestry: Fair Housing Act, c.151B',
      re: /\b(?:english[- ]speaking(?: only| tenants?)?|must speak english|no (?:foreigners|immigrants|refugees)|(?:american|u\.?s\.?) citizens? only|must be (?:a )?(?:u\.?s\.? )?citizens?|no green cards?|(?:white|black|hispanic|latino|asian|ethnic|integrated)\s+(?:neighborhood|area|community|tenants?|only|family|families|building))\b/i,
      fix: 'Remove it. Never describe the people in a neighborhood or building.' },
    { id: 'sex', severity: 'warn', law: 'Sex: Fair Housing Act, c.151B',
      re: /\b(?:male|female|men|women|man|woman|gentlem[ae]n|lad(?:y|ies)|girls?|guys?)\s+only\b|\bprefer(?:red|s)?\s+(?:a\s+)?(?:male|female|man|woman)\b/i,
      fix: 'Only allowed for a room in an owner-occupied or shared-living unit. Remove it for a whole apartment.' },
    { id: 'orientation-identity', severity: 'block', law: 'Sexual orientation / gender identity: c.151B',
      re: /\bno (?:gays?|lesbians?|lgbt\w*|queer|trans\w*|same[- ]sex couples?)\b/i,
      fix: 'Remove it. Sexual orientation and gender identity are protected in Massachusetts.' },
    { id: 'military-veteran', severity: 'block', law: 'Veteran / military status: c.151B',
      re: /\bno (?:veterans?|military|service members?|soldiers)\b/i,
      fix: 'Remove it. Veteran and military status are protected in Massachusetts.' },
    { id: 'ma-upfront-fees', severity: 'warn', law: 'MA security deposit law: M.G.L. c.186 §15B',
      re: /\b(?:application fee|app fee|non[- ]?refundable (?:holding )?(?:fee|deposit)|pet (?:fee|deposit)|cleaning fee|move[- ]in fee|administrative fee|admin fee|amenity fee)\b/i,
      fix: 'At or before move-in a MA landlord may collect only first month, last month, a security deposit (up to one month) and a lock-change fee. Remove other fees.' },
    { id: 'ma-broker-fee', severity: 'info', law: 'MA broker-fee reform (effective Aug 1, 2025)',
      re: /\b(?:broker'?s? fee|one month(?:'s)? fee|full fee|half fee|tenant pays (?:the )?(?:broker )?fee|fee applies)\b/i,
      fix: 'Since Aug 2025, a MA tenant can\'t be charged the fee of a broker the landlord hired. If you represent the landlord, turn on "No broker fee". It also gets more clicks.' }
  ];
}


/**
 * Lint any text. Returns [{id, severity, law, match, sentence, fix}].
 */
function lintText(text) {
  const out = [];
  const sentences = aeSentences_(text || '');
  const rules = aeLintRules_();
  sentences.forEach(function (s) {
    rules.forEach(function (r) {
      const m = s.match(r.re);
      if (m) out.push({ id: r.id, severity: r.severity, law: r.law, match: m[0], sentence: s.trim(), fix: r.fix });
    });
  });
  return out;
}


/**
 * Lint a structured listing: its text plus MA rules that depend on numbers.
 */
function lintListing(L) {
  const text = [L.title, L.description, L.pets].concat(L.amenities || []).join('\n');
  const out = lintText(text);
  const rent = Number(L.rent), dep = Number(L.deposit);
  if (rent && dep && dep > rent) {
    out.push({ id: 'ma-deposit-cap', severity: 'warn', law: 'MA security deposit law: M.G.L. c.186 §15B',
      match: '$' + aeMoney_(dep) + ' deposit', sentence: 'Security deposit $' + aeMoney_(dep) + ' > rent $' + aeMoney_(rent),
      fix: 'A MA security deposit can\'t be more than one month\'s rent.' });
  }
  return out;
}


/** Drop any sentence that trips a 'block' rule. */
function aeSanitize_(text) {
  const removed = [];
  const keep = aeSentences_(text || '').filter(function (s) {
    const hits = lintText(s).filter(function (h) { return h.severity === 'block'; });
    if (hits.length) { removed.push(s.trim()); return false; }
    return true;
  });
  return { text: keep.join(' ').replace(/\s+/g, ' ').trim(), removed: removed };
}


/* ==========================================================================
 *  3. GENERATE  —  listing -> ads for every platform
 * ========================================================================== */

/**
 * @param {Object} L     A listing from parseListing() (possibly hand-edited).
 * @param {Object} opts  { agentName, brokerage, phone, email, landingUrl, refPrefix,
 *                         noBrokerFee, welcomeVouchers, showAddress, platforms[] }
 * @return {{listingId, ads[], lint[], removed[]}}
 */
function generateAds(L, opts) {
  opts = aeOpts_(opts);
  L = aeNormalizeListing_(L);

  const clean = aeSanitize_(aeStripContact_(L.description));
  const ctx = aeContext_(L, opts, clean.text);
  const builders = {
    craigslist: aeCraigslist_, marketplace: aeMarketplace_, zillow: aeZillow_,
    apartments: aeApartments_, nextdoor: aeNextdoor_, social: aeSocial_,
    metaAds: aeMetaAds_, googleAds: aeGoogleAds_, googleBusiness: aeGoogleBusiness_,
    outreach: aeOutreach_
  };

  const wanted = opts.platforms && opts.platforms.length ? opts.platforms : null;
  const ads = adPlatforms()
    .filter(function (p) { return !wanted || wanted.indexOf(p.key) !== -1; })
    .map(function (p) {
      const ref = adRef(opts.refPrefix, ctx.listingId, p.code);
      const url = opts.landingUrl ? buildTrackedUrl(opts.landingUrl, p, ctx.listingId, ref) : '';
      const ad = builders[p.key](ctx, ref, url);
      ad.key = p.key; ad.code = p.code; ad.label = p.label; ad.kind = p.kind;
      ad.postUrl = p.postUrl; ad.ref = ref; ad.trackedUrl = url;
      ad.isSource = (L.source === 'zillow' && p.key === 'zillow') ||
                    (L.source === 'marketplace' && p.key === 'marketplace');
      ad.lint = lintText(ad.fields.map(function (f) { return f.value; }).join('\n'))
        .filter(function (h) { return h.severity !== 'info'; });
      ad.fields.forEach(function (f) { f.over = !!(f.limit && f.value.length > f.limit); });
      return ad;
    });

  return { listingId: ctx.listingId, ads: ads, lint: lintListing(L), removed: clean.removed };
}


function aeOpts_(o) {
  o = o || {};
  return {
    agentName: o.agentName || '',
    brokerage: o.brokerage || '',
    phone: o.phone || '',
    email: o.email || '',
    landingUrl: (o.landingUrl || '').trim(),
    refPrefix: (o.refPrefix || 'DBR').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'DBR',
    noBrokerFee: !!o.noBrokerFee,
    welcomeVouchers: o.welcomeVouchers !== false,
    showAddress: o.showAddress !== false,
    platforms: o.platforms || null
  };
}


function aeNormalizeListing_(L) {
  L = L || {};
  const list = function (v) {
    if (Array.isArray(v)) return v.map(String).map(function (s) { return s.trim(); }).filter(String);
    return String(v || '').split(/[,;\n]/).map(function (s) { return s.trim(); }).filter(String);
  };
  return {
    source: L.source || 'other',
    title: String(L.title || ''),
    propertyType: L.propertyType || 'Apartment',
    address: String(L.address || '').trim(),
    unit: String(L.unit || '').trim(),
    city: aeTitleCase_(String(L.city || '').trim()),
    state: (L.state || 'MA').toUpperCase(),
    zip: String(L.zip || '').trim(),
    rent: aeNum_(L.rent),
    beds: L.beds === 0 ? '0' : String(L.beds || '').trim(),
    baths: String(L.baths || '').trim(),
    sqft: aeNum_(L.sqft),
    available: String(L.available || '').trim(),
    leaseTerm: String(L.leaseTerm || '').trim(),
    deposit: aeNum_(L.deposit),
    pets: String(L.pets || '').trim(),
    laundry: String(L.laundry || '').trim(),
    parking: String(L.parking || '').trim(),
    utilities: list(L.utilities),
    amenities: list(L.amenities),
    description: String(L.description || '')
  };
}


/** Everything the per-platform writers share. */
function aeContext_(L, o, desc) {
  const beds = L.beds;
  const isStudio = beds === '0' || /^studio$/i.test(beds);
  const type = L.propertyType || 'Apartment';
  const typeLc = type.toLowerCase();
  const city = L.city || 'Massachusetts';
  const rent = L.rent ? '$' + aeMoney_(L.rent) : '';
  const bathsNum = L.baths ? L.baths.replace(/\.0$/, '') : '';

  const c = {
    L: L, o: o, desc: desc, city: city, type: type, typeLc: typeLc,
    listingId: listingId(L),
    rent: rent,
    rentMo: rent ? rent + '/mo' : '',
    isStudio: isStudio,
    // "2BR" / "Studio"
    bedsShort: isStudio ? 'Studio' : (beds ? beds + 'BR' : ''),
    // "2-bedroom" / "studio"
    bedsAdj: isStudio ? 'studio' : (beds ? beds + '-bedroom' : ''),
    // "2 Bedroom" / "Studio"
    bedsWord: isStudio ? 'Studio' : (beds ? beds + ' Bedroom' : ''),
    bathsShort: bathsNum ? bathsNum + 'BA' : '',
    bathsWord: bathsNum ? bathsNum + (bathsNum === '1' ? ' bath' : ' baths') : '',
    available: aeAvailablePhrase_(L.available),
    region: aeRegionFor_(city),
    phone: o.phone,
    contactLine: aeContactLine_(o)
  };

  // "2BR/1BA apartment" / "Studio apartment"
  c.unitShort = (c.isStudio ? 'Studio' : [c.bedsShort, c.bathsShort].filter(String).join('/')) +
                (c.isStudio && typeLc === 'apartment' ? ' apartment' : ' ' + typeLc);
  c.unitShort = c.unitShort.trim();
  // "2-bedroom apartment" / "studio apartment"
  c.unitPhrase = c.isStudio ? 'studio' + (typeLc === 'apartment' ? ' apartment' : ' ' + typeLc)
                            : ((c.bedsAdj ? c.bedsAdj + ' ' : '') + typeLc);

  c.location = o.showAddress && L.address
    ? L.address + (L.unit ? ' #' + L.unit : '') + ', ' + city
    : city + ', ' + L.state;

  c.features = aeFeatureList_(L, o);
  c.eho = 'Equal Housing Opportunity.' +
          (o.welcomeVouchers ? ' All lawful sources of income welcome, including Section 8 and other rental assistance.' : '');
  c.ehoShort = o.welcomeVouchers ? 'Vouchers welcome · Equal Housing Opportunity' : 'Equal Housing Opportunity';
  c.hook = aeHook_(c);
  return c;
}


/** Features in the order renters care about most. */
function aeFeatureList_(L, o) {
  const f = [];
  if (o.noBrokerFee) f.push('No broker fee');
  if (L.utilities.length) f.push(aeUtilitiesPhrase_(L.utilities));
  if (L.laundry) f.push(L.laundry);
  if (L.parking) f.push(L.parking);
  if (L.pets) f.push(L.pets === 'No pets' ? 'No pets (assistance animals welcome)' : L.pets);
  L.amenities.forEach(function (a) { if (f.indexOf(a) === -1) f.push(a); });
  return f;
}

function aeUtilitiesPhrase_(u) {
  if (u.indexOf('All utilities') !== -1) return 'All utilities included';
  if (u.length === 1) return u[0] + ' included';
  return aeJoinAnd_(u.map(function (x, i) { return i ? x.toLowerCase() : x; }), '&') + ' included';
}

function aeHook_(c) {
  const first = aeSentences_(c.desc)[0] || '';
  if (first && first.length >= 30 && first.length <= 170) return first.trim();
  return 'Welcome home to this ' + c.unitPhrase + ' in ' + c.city + '.';
}

function aeContactLine_(o) {
  const who = [o.agentName, o.brokerage].filter(String).join(', ');
  const how = [o.phone, o.email].filter(String).join(' · ');
  return [who, how].filter(String).join(' — ');
}

function aeAvailablePhrase_(a) {
  if (!a) return '';
  if (/^(now|immediately|today)$/i.test(a)) return 'now';
  return a;
}


/* ----- Per-platform writers. Each returns { fields:[], notes:[] } ----- */

function aeField_(name, value, limit, extra) {
  const f = { name: name, value: String(value == null ? '' : value), limit: limit || 0 };
  if (extra) for (const k in extra) f[k] = extra[k];
  return f;
}

function aeDetailRows_(c) {
  const L = c.L, rows = [];
  if (c.rent) rows.push('Rent: ' + c.rent + '/month');
  if (c.isStudio) rows.push('Bedrooms: Studio');
  else if (L.beds) rows.push('Bedrooms: ' + L.beds);
  if (L.baths) rows.push('Bathrooms: ' + L.baths);
  if (L.sqft) rows.push('Size: ' + aeMoney_(L.sqft) + ' sq ft');
  if (c.available) rows.push('Available: ' + (c.available === 'now' ? 'Now' : c.available));
  if (L.leaseTerm) rows.push('Lease: ' + L.leaseTerm);
  if (L.deposit) rows.push('Security deposit: $' + aeMoney_(L.deposit));
  rows.push('Location: ' + c.location);
  return rows;
}

function aeAskLine_() {
  // Asking for move-in date and bedroom count makes replies score higher in
  // the Lead Digest (both are transaction-readiness fields).
  return 'When you reach out, please include your desired move-in date and how many bedrooms you need.';
}


function aeCraigslist_(c, ref, url) {
  const L = c.L;
  const title = aeJoinFit_([aeCap_(c.unitShort), c.features[0] || '', c.city], ' – ', 70);
  const body = [
    c.hook,
    c.desc && c.desc !== c.hook ? aeTrimTo_(c.desc.replace(c.hook, '').trim(), 900) : '',
    c.features.length ? 'HIGHLIGHTS\n' + c.features.slice(0, 8).map(function (x) { return '- ' + x; }).join('\n') : '',
    'DETAILS\n' + aeDetailRows_(c).map(function (x) { return '- ' + x; }).join('\n'),
    'TO SCHEDULE A SHOWING\n' +
      (c.phone ? 'Call or text ' + c.phone + ', or reply to this post. ' : 'Reply to this post. ') + aeAskLine_() +
      (url ? '\nMore photos and details: ' + url : ''),
    c.contactLine,
    'Ref: ' + ref,
    c.eho
  ].filter(String).join('\n\n');

  return {
    fields: [
      aeField_('Posting title', title, 70),
      aeField_('Price', L.rent ? L.rent : ''),
      aeField_('City / neighborhood', c.city),
      aeField_('ZIP code', L.zip),
      aeField_('Bedrooms / bathrooms', [c.isStudio ? 'Studio' : L.beds, L.baths].filter(String).join(' / ')),
      aeField_('Sq ft', L.sqft),
      aeField_('Available on', c.available === 'now' ? 'Now' : c.available),
      aeField_('Posting body', body, 0, { multiline: true })
    ],
    notes: [
      'Category: housing → apts/housing for rent. Set "laundry", "parking" and "cats/dogs OK" in the attribute boxes to match the body.',
      'Craigslist relays replies through an anonymous address. The Lead Digest\'s Craigslist parser already reads those replies, and the Ref line tells it which ad they came from.',
      'Renew the post every 48 hours (allowed for paid housing posts in most MA areas) to stay near the top.',
      'Upload the same photos, leading with the best interior shot. Craigslist strips captions.'
    ]
  };
}


function aeMarketplace_(c, ref, url) {
  const L = c.L;
  const desc = [
    c.hook,
    c.features.length ? c.features.slice(0, 6).map(function (x) { return '✓ ' + x; }).join('\n') : '',
    c.desc && c.desc !== c.hook ? aeTrimTo_(c.desc.replace(c.hook, '').trim(), 600) : '',
    aeDetailRows_(c).join('\n'),
    (c.phone ? 'Message me here or call/text ' + c.phone + ' to set up a showing. ' : 'Message me here to set up a showing. ') + aeAskLine_(),
    url ? 'Photos & details: ' + url : '',
    'Ref: ' + ref,
    c.eho
  ].filter(String).join('\n\n');

  return {
    fields: [
      aeField_('Home type', c.type === 'House' ? 'House' : c.type === 'Townhouse' ? 'Townhouse' : c.type === 'Room' ? 'Room only' : 'Apartment'),
      aeField_('Number of bedrooms', c.isStudio ? 'Studio' : L.beds),
      aeField_('Number of bathrooms', L.baths),
      aeField_('Price per month', L.rent),
      aeField_('Rental address', c.o.showAddress ? [L.address + (L.unit ? ' #' + L.unit : ''), c.city, (L.state + ' ' + L.zip).trim()].filter(String).join(', ') : c.city + ', ' + L.state),
      aeField_('Square feet', L.sqft),
      aeField_('Date available', c.available === 'now' ? 'Today' : c.available),
      aeField_('Laundry type', /in-unit/i.test(L.laundry) ? 'In-unit laundry' : /on site/i.test(L.laundry) ? 'Laundry in building' : /hookup/i.test(L.laundry) ? 'Laundry available' : 'None'),
      aeField_('Parking type', /garage/i.test(L.parking) ? 'Garage parking' : /off-street/i.test(L.parking) ? 'Off-street parking' : /street/i.test(L.parking) ? 'Street parking' : L.parking ? 'Off-street parking' : 'None'),
      aeField_('Cat friendly', /cat|pet friendly/i.test(L.pets) && !/no pets/i.test(L.pets) ? 'Yes' : 'No'),
      aeField_('Dog friendly', /dog|pet friendly/i.test(L.pets) && !/no pets/i.test(L.pets) ? 'Yes' : 'No'),
      aeField_('Rental description', desc, 0, { multiline: true })
    ],
    notes: [
      'Marketplace shows the first ~2 lines before "See more". The hook and checkmark list are there so those lines sell the unit.',
      'After posting, share the listing to local Facebook groups (town "rentals" and "community" groups). Most allow one housing post per week.',
      'Marketplace inquiries land in Messenger. Forward serious ones to your email so the Lead Digest picks them up.'
    ]
  };
}


function aeZillow_(c, ref, url) {
  const L = c.L;
  const desc = [
    c.hook,
    c.desc && c.desc !== c.hook ? c.desc.replace(c.hook, '').trim() : '',
    c.features.length ? 'Highlights: ' + c.features.join(' · ') + '.' : '',
    (c.phone ? 'Call or text ' + c.phone + ' or use the Contact button to book a tour. ' : 'Use the Contact button to book a tour. ') + aeAskLine_(),
    'Ref: ' + ref,
    c.eho
  ].filter(String).join('\n\n');

  return {
    fields: [
      aeField_('Property type', c.type),
      aeField_('Monthly rent', L.rent),
      aeField_('Bedrooms', c.isStudio ? 'Studio' : L.beds),
      aeField_('Bathrooms', L.baths),
      aeField_('Square footage', L.sqft),
      aeField_('Date available', c.available === 'now' ? 'Available now' : c.available),
      aeField_('Lease duration', L.leaseTerm),
      aeField_('Security deposit', L.deposit),
      aeField_('Pet policy', L.pets),
      aeField_('Laundry', L.laundry),
      aeField_('Parking', L.parking),
      aeField_('Utilities included', L.utilities.join(', ')),
      aeField_('Amenities to check', L.amenities.join(', ')),
      aeField_('Description', desc, 0, { multiline: true })
    ],
    notes: [
      'One Zillow Rental Manager listing also shows on Trulia and HotPads.',
      'Zillow inquiries arrive by email, and the Lead Digest\'s Zillow parser reads them automatically.',
      'Turn on online applications only if you can offer them to every applicant. Never ask for an application fee in MA.'
    ]
  };
}


function aeApartments_(c, ref, url) {
  const L = c.L;
  const desc = [
    c.hook,
    c.desc && c.desc !== c.hook ? aeTrimTo_(c.desc.replace(c.hook, '').trim(), 1500) : '',
    (c.phone ? 'Call or text ' + c.phone + ' to schedule a showing. ' : '') + aeAskLine_(),
    'Ref: ' + ref,
    c.eho
  ].filter(String).join('\n\n');

  return {
    fields: [
      aeField_('Listing headline', aeJoinFit_([aeCap_(c.unitShort) + ' in ' + c.city, c.features[0] || ''], ' · ', 60), 60),
      aeField_('Rent', L.rent),
      aeField_('Beds / baths', [c.isStudio ? 'Studio' : L.beds, L.baths].filter(String).join(' / ')),
      aeField_('Sq ft', L.sqft),
      aeField_('Available', c.available === 'now' ? 'Now' : c.available),
      aeField_('Unique features', c.features.slice(0, 10).join('\n'), 0, { multiline: true }),
      aeField_('Description', desc, 0, { multiline: true })
    ],
    notes: [
      'Apartments.com\'s free landlord listing tools also syndicate to partner sites in its network. Check the listing flow for which ones.',
      'Leads come in by email. Add the sender address to the "Apartments.com" query in the digest CONFIG if it differs.'
    ]
  };
}


function aeNextdoor_(c, ref, url) {
  const L = c.L;
  const parts = [
    'Hi neighbors! I have a ' + c.unitPhrase + ' for rent in ' + c.city +
      (c.rent ? ' at ' + c.rent + '/month' : '') +
      (c.available ? ', available ' + c.available : '') + '.',
    c.features.length ? 'Highlights: ' + aeJoinAnd_(c.features.slice(0, 4).map(aeLowerFirst_), 'and') + '.' : '',
    'If you or someone you know is looking, I\'m happy to answer questions here or by direct message' +
      (c.phone ? ', or call/text ' + c.phone : '') + '.',
    url ? 'Photos: ' + url : '',
    'Ref: ' + ref,
    c.ehoShort
  ];
  return {
    fields: [
      aeField_('Post title', aeJoinFit_([aeCap_(c.unitShort) + ' for rent', c.city, c.rentMo], ' · ', 80), 80),
      aeField_('Post', parts.filter(String).join('\n\n'), 0, { multiline: true })
    ],
    notes: [
      'Nextdoor limits promotional posts in the main feed. Post under For Sale & Free → Housing, or from a Nextdoor Business Page.',
      'Neighbor referrals are the real value here. Ask people to tag someone who\'s looking.',
      'Once you\'re approved for the Nextdoor API, the digest\'s Pipe 3 also watches for neighbors posting that they\'re looking.'
    ]
  };
}


function aeSocial_(c, ref, url) {
  const L = c.L;
  const tags = aeHashtags_(c);
  const caption = [
    'NOW LEASING · ' + c.city.toUpperCase(),
    [aeCap_(c.unitShort), c.rentMo].filter(String).join(' · '),
    c.features.slice(0, 5).map(function (x) { return '✔ ' + x; }).join('\n'),
    c.available ? '📅 Available ' + c.available : '',
    (c.phone ? '📲 DM us or call/text ' + c.phone + ' to book a showing.' : '📲 DM us to book a showing.') +
      (url ? '\n🔗 Link in bio' : ''),
    'Ref ' + ref,
    c.eho,
    tags.join(' ')
  ].filter(String).join('\n\n');

  return {
    fields: [
      aeField_('Caption', caption, 2200, { multiline: true }),
      aeField_('Hashtags', tags.join(' '), 0),
      aeField_('Link-in-bio URL', url || '(add a landing page URL in options to get a tracked link)'),
      aeField_('Story text overlay', aeJoinFit_([aeCap_(c.unitShort), c.city, c.rentMo], '\n', 60), 60, { multiline: true })
    ],
    notes: [
      'Post as a carousel: best exterior, kitchen, living room, bedroom, bath, then a slide with rent and how to reach you.',
      'Cross-post to your Facebook business page and Instagram Story. Use the Story link sticker with the tracked URL.',
      'Hashtags are location- and unit-based on purpose. Never tag for a type of tenant.'
    ]
  };
}


function aeHashtags_(c) {
  const city = c.city.replace(/[^A-Za-z]/g, '');
  const t = [];
  if (city && city !== 'Massachusetts') t.push('#' + city + 'MA', '#' + city + 'Rentals', '#' + city + 'Apartments');
  if (c.region) t.push('#' + c.region.replace(/[^A-Za-z]/g, ''));
  t.push('#MassachusettsRentals', '#MARentals', '#ApartmentForRent', '#ForRent', '#NowLeasing');
  if (c.bedsShort) t.push('#' + (c.isStudio ? 'Studio' : c.L.beds + 'Bedroom') + 'Apartment');
  if (c.o.noBrokerFee) t.push('#NoBrokerFee');
  if (c.o.welcomeVouchers) t.push('#VouchersWelcome');
  if (/dog|cat|pet friendly/i.test(c.L.pets) && !/no pets/i.test(c.L.pets)) t.push('#PetFriendlyRentals');
  return t.slice(0, 15);
}


function aeMetaAds_(c, ref, url) {
  const primary = aeFirstFit_([
    aeCap_(c.unitPhrase) + ' in ' + c.city + (c.rentMo ? ' for ' + c.rentMo : '') + '. ' +
      aeFeatureSentence_(c.features.slice(0, 2)) + '. Book a showing today.',
    aeCap_(c.unitPhrase) + ' in ' + c.city + (c.rentMo ? ' for ' + c.rentMo : '') + '. ' + aeCap_(aeLowerFirst_(c.features[0] || 'Available ' + (c.available || 'soon'))) + '. Book a showing.',
    aeCap_(c.unitPhrase) + ' in ' + c.city + (c.rentMo ? ', ' + c.rentMo : '') + '. Book a showing today.'
  ], 125);
  const headlines = aeFitAll_([
    c.bedsShort + ' in ' + c.city + (c.rentMo ? ' · ' + c.rentMo : ''),
    c.bedsShort + ' for Rent in ' + c.city,
    'Now Leasing in ' + c.city,
    c.city + ' ' + c.type + ' for Rent'
  ], 40);
  const descs = aeFitAll_([
    c.available ? 'Available ' + c.available : '',
    c.features[0] || '',
    'Book a showing today'
  ], 30);

  return {
    fields: [
      aeField_('Primary text', primary, 125, { multiline: true }),
      aeField_('Headline', headlines[0] || '', 40),
      aeField_('Headline (A/B variant)', headlines[1] || '', 40),
      aeField_('Description', descs[0] || '', 30),
      aeField_('Call-to-action button', url ? 'Learn more' : 'Send message'),
      aeField_('Destination URL', url || 'Messenger (no landing page set)'),
      aeField_('Instant Form questions', 'Full name\nPhone number\nEmail\nDesired move-in date\nNumber of bedrooms needed\nMonthly budget', 0, { multiline: true })
    ],
    notes: [
      'REQUIRED: in Ads Manager, declare the Special Ad Category "Housing". Meta then blocks age, gender and ZIP-code targeting and enforces a minimum location radius (15 miles).',
      'Target the city with a radius, and let the ad copy do the qualifying. Don\'t try to narrow the audience by who they are.',
      'Instant Form questions are limited to move-in date, bedrooms and budget: transaction readiness only, the same fields the Lead Digest scores.',
      'Starting point: $10–20/day for 7 days, then keep whichever headline variant costs less per lead.'
    ]
  };
}


function aeGoogleAds_(c, ref, url) {
  const L = c.L;
  const cityS = c.city;
  const heads = aeFitAll_([
    cityS + ' Apartments for Rent',
    c.bedsShort + ' ' + c.type + ' in ' + cityS,
    c.bedsShort + ' for Rent in ' + cityS,
    c.bedsWord + ' Rental in ' + cityS,
    c.rentMo ? c.rentMo + ' ' + c.bedsShort + ' in ' + cityS : '',
    c.rentMo ? c.bedsShort + ' ' + c.type + ' ' + c.rentMo : '',
    'Now Leasing in ' + cityS,
    cityS + ', MA Rentals',
    c.available ? 'Available ' + aeCap_(c.available) : '',
    c.o.noBrokerFee ? 'No Broker Fee' : '',
    c.o.welcomeVouchers ? 'Housing Vouchers Welcome' : '',
    'Schedule a Showing Today',
    'Tour This ' + c.type + ' Today',
    L.sqft ? aeMoney_(L.sqft) + ' Sq Ft ' + c.bedsShort : ''
  ].concat(c.features.slice(0, 8)), 30).slice(0, 15);

  const descs = aeFitAll_([
    aeCap_(c.unitPhrase) + ' in ' + cityS + (c.rentMo ? ' for ' + c.rentMo : '') + '. Schedule a showing today.',
    aeFeatureSentence_(c.features.slice(0, 3)) + '.' + (c.available ? ' Available ' + c.available + '.' : ''),
    aeFeatureSentence_(c.features.slice(0, 2)) + '. Call or apply online.',
    c.o.welcomeVouchers ? 'All lawful sources of income welcome. Equal Housing Opportunity.' : 'Equal Housing Opportunity. Tour this week.',
    aeSentences_(c.desc)[0] || ''
  ], 90).slice(0, 4);

  const bedKw = c.isStudio ? 'studio' : (L.beds ? L.beds + ' bedroom' : '');
  const city = cityS.toLowerCase();
  const kws = [
    '"' + city + ' apartments for rent"',
    '"' + city + ' rentals"',
    '"apartments for rent in ' + city + ' ma"',
    bedKw ? '"' + bedKw + ' apartment ' + city + '"' : '',
    bedKw ? '"' + bedKw + ' for rent ' + city + '"' : '',
    '"' + c.typeLc + ' for rent ' + city + '"',
    c.o.welcomeVouchers ? '"section 8 apartments ' + city + '"' : '',
    c.o.noBrokerFee ? '"no fee apartments ' + city + '"' : ''
  ].filter(String);

  const fields = heads.map(function (h, i) { return aeField_('Headline ' + (i + 1), h, 30); })
    .concat(descs.map(function (d, i) { return aeField_('Description ' + (i + 1), d, 90); }))
    .concat([
      aeField_('Display path 1', 'Rentals', 15),
      aeField_('Display path 2', cityS.replace(/\s+/g, '-').slice(0, 15), 15),
      aeField_('Final URL', url || '(add a landing page URL in options; Search ads need one)'),
      aeField_('Keywords (phrase match)', kws.join('\n'), 0, { multiline: true }),
      aeField_('Negative keywords', 'for sale\nbuy\nmortgage\nzestimate\njobs\nhotel\nairbnb\nstorage unit\nfurniture', 0, { multiline: true })
    ]);

  return {
    fields: fields,
    notes: [
      'Responsive search ad: Google mixes these 15 headlines and 4 descriptions. Pin the "' + (heads[0] || '') + '" headline to position 1 if you want it always shown.',
      'Google\'s US housing policy bars targeting or excluding by age, gender, parental status, marital status or ZIP code. Target the city or a radius around it.',
      'Put your phone number in a Call asset, not in headline text (Google rejects phone numbers in ad text).',
      'The Final URL carries UTM tags, so leads from this ad show up in Google Analytics and the Ref shows in the digest.'
    ]
  };
}


function aeGoogleBusiness_(c, ref, url) {
  const post = [
    'Now leasing: ' + c.unitPhrase + ' in ' + c.city + (c.rentMo ? ' for ' + c.rentMo : '') + '.',
    c.features.length ? aeFeatureSentence_(c.features.slice(0, 5)) + '.' : '',
    c.available ? 'Available ' + c.available + '.' : '',
    c.phone ? 'Call ' + c.phone + ' to schedule a showing.' : 'Contact us to schedule a showing.',
    'Ref ' + ref + '. ' + c.eho
  ].filter(String).join(' ');
  return {
    fields: [
      aeField_('Post type', 'Update'),
      aeField_('Post text', post, 1500, { multiline: true }),
      aeField_('Button', url ? 'Learn more' : 'Call now'),
      aeField_('Button link', url || '(uses your profile phone number)')
    ],
    notes: [
      'Google Business Profile posts show in Maps and search results for your office. Add one photo of the unit.',
      'Repost every 7 days while the unit is open. Older posts drop out of the top spot.'
    ]
  };
}


function aeOutreach_(c, ref, url) {
  const subject = aeFirstFit_([
    'Just listed: ' + aeCap_(c.unitShort) + ' in ' + c.city + (c.rentMo ? ', ' + c.rentMo : ''),
    aeCap_(c.unitShort) + ' in ' + c.city + (c.rentMo ? ', ' + c.rentMo : '')
  ], 78);
  const body = [
    'Hi {{first_name}},',
    'You reached out recently about rentals' + (c.city ? ' in the ' + c.city + ' area' : '') +
      ', so I wanted you to see this one first. A ' + c.unitPhrase + ' just opened up' +
      (c.rent ? ' at ' + c.rent + '/month' : '') + (c.available ? ', available ' + c.available : '') + '.',
    c.features.length ? c.features.slice(0, 5).map(function (x) { return '• ' + x; }).join('\n') : '',
    url ? 'Photos and details: ' + url : '',
    'If you\'d like to see it, reply with a couple of times that work' + (c.phone ? ' or call/text me at ' + c.phone : '') +
      '. If you\'ve already found a place, just let me know and I\'ll stop sending listings.',
    [c.o.agentName, c.o.brokerage].filter(String).join('\n'),
    'Ref: ' + ref,
    c.eho
  ].filter(String).join('\n\n');

  const who = (c.o.agentName || '').split(' ')[0] || c.o.brokerage || 'Rentals';
  const sms = aeFirstFit_([
    who + ': ' + c.bedsShort + ' in ' + c.city + (c.rentMo ? ', ' + c.rentMo : '') + (c.available ? ', avail ' + c.available : '') + '. Want a showing? Reply YES. Reply STOP to opt out.',
    who + ': ' + c.bedsShort + ' in ' + c.city + (c.rentMo ? ', ' + c.rentMo : '') + '. Want a showing? Reply YES. STOP to opt out.',
    c.bedsShort + ' in ' + c.city + ' ' + c.rentMo + '. Showing? Reply YES. STOP to opt out.'
  ], 160);

  return {
    fields: [
      aeField_('Email subject', subject, 78),
      aeField_('Email body', body, 0, { multiline: true }),
      aeField_('Text message', sms, 160, { multiline: true })
    ],
    notes: [
      'Send only to people who contacted you about renting. In the Apps Script version, "Find matching prospects" pulls them from the digest\'s lead log by city, bedrooms and budget.',
      'Texting: message only people who gave you their number for this purpose, keep the STOP line, and honor opt-outs right away.',
      '{{first_name}} is filled in for each prospect when Gmail drafts are created.'
    ]
  };
}


/* ==========================================================================
 *  TRACKING
 * ========================================================================== */

/** Stable 4-char ID per unit, so regenerating ads keeps the same refs. */
function listingId(L) {
  const key = [L.address, L.unit, L.city, L.beds, L.rent].join('|').toLowerCase().replace(/\s+/g, ' ');
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h * 33) ^ key.charCodeAt(i)) >>> 0;
  const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';   // no 0/O, 1/I/L confusion
  let id = '';
  for (let i = 0; i < 4; i++) { id += alphabet[h % alphabet.length]; h = Math.floor(h / alphabet.length); }
  return id;
}

function adRef(prefix, id, code) {
  return (prefix || 'DBR') + '-' + id + '-' + code;
}

/** Find a tracking ref in a lead's text. Returns {ref, listingId, code} or null. */
function parseAdRef(text, prefix) {
  const p = (prefix || 'DBR').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const m = (text || '').match(new RegExp('\\b' + p + '-([2-9A-HJKMNP-Z]{4})-([A-Z]{2})\\b', 'i'));
  if (!m) return null;
  const id = m[1].toUpperCase(), code = m[2].toUpperCase();
  const plat = adPlatforms().filter(function (x) { return x.code === code; })[0];
  return { ref: p + '-' + id + '-' + code, listingId: id, code: code, platform: plat ? plat.label : code };
}

function buildTrackedUrl(base, platform, id, ref) {
  if (!base) return '';
  const hashAt = base.indexOf('#');
  const hash = hashAt === -1 ? '' : base.slice(hashAt);
  let url = hashAt === -1 ? base : base.slice(0, hashAt);
  const params = [
    ['utm_source', platform.source],
    ['utm_medium', platform.medium],
    ['utm_campaign', 'rental-' + id.toLowerCase()],
    ['utm_content', ref]
  ].map(function (kv) { return kv[0] + '=' + encodeURIComponent(kv[1]); }).join('&');
  url += (url.indexOf('?') === -1 ? '?' : '&') + params;
  return url + hash;
}


/* ==========================================================================
 *  4. MATCH  —  past prospects who asked for something this unit satisfies
 * ========================================================================== */

/**
 * @param {Object} L      listing
 * @param {Array}  leads  [{name, email, phone, city, bedrooms, budget, moveIn, firstSeen, source}]
 * @param {Object} opts   { maxAgeDays: 90, now: Date|ms }
 * @return {Array} matching leads, best first, each with .matchScore and .matchReasons
 */
function matchProspects(L, leads, opts) {
  opts = opts || {};
  const now = opts.now ? new Date(opts.now).getTime() : Date.now();
  const maxAge = (opts.maxAgeDays || 90) * 86400000;
  const rent = Number(aeNum_(L.rent)) || 0;
  const beds = L.beds === '' || L.beds == null ? null : Number(L.beds);
  const city = (L.city || '').toLowerCase().trim();
  const region = aeRegionFor_(city);
  const seen = {};

  return (leads || []).map(function (p) {
    if (!p.email && !p.phone) return null;
    const key = (p.email || '').toLowerCase() || (p.phone || '').replace(/\D/g, '');
    if (seen[key]) return null;
    seen[key] = true;

    const t = p.firstSeen ? new Date(p.firstSeen).getTime() : now;
    if (isNaN(t) || now - t > maxAge) return null;

    let score = 0;
    const why = [];

    const pCity = (p.city || '').toLowerCase().trim();
    if (pCity && city) {
      if (pCity === city) { score += 3; why.push('wants ' + aeTitleCase_(pCity)); }
      else if (region && aeRegionFor_(pCity) === region) { score += 1; why.push('wants nearby ' + aeTitleCase_(pCity)); }
    }

    const pBeds = p.bedrooms === '' || p.bedrooms == null ? null : Number(String(p.bedrooms).replace(/\D/g, ''));
    if (pBeds != null && !isNaN(pBeds) && beds != null && !isNaN(beds)) {
      if (pBeds > beds) return null;                       // unit too small for what they asked
      if (pBeds === beds) { score += 2; why.push(beds === 0 ? 'wants a studio' : 'wants ' + beds + ' BR'); }
    }

    const budget = Number(aeNum_(p.budget)) || 0;
    if (budget && rent) {
      if (budget < rent * 0.9) return null;                // stated budget well under rent
      score += budget >= rent ? 2 : 1;
      why.push('budget $' + aeMoney_(budget));
    }

    if (score < 2) return null;
    const out = {};
    for (const k in p) out[k] = p[k];
    out.matchScore = score;
    out.matchReasons = why;
    out._t = t;
    return out;
  }).filter(Boolean).sort(function (a, b) {
    return (b.matchScore - a.matchScore) || (b._t - a._t);
  }).map(function (x) { delete x._t; return x; });
}


/* ==========================================================================
 *  TEXT UTILITIES  (ae prefix: this file shares a global namespace with the
 *  Lead Digest in Apps Script, so nothing here may collide with its helpers)
 * ========================================================================== */

function aeNum_(v) {
  if (v === 0) return '0';
  const s = String(v == null ? '' : v).replace(/[^\d.]/g, '');
  if (!s) return '';
  return String(Math.round(Number(s)));
}

function aeMoney_(n) {
  return String(Math.round(Number(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function aeTitleCase_(s) {
  return (s || '').toLowerCase().replace(/\b([a-z])/g, function (c) { return c.toUpperCase(); });
}

function aeCap_(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

function aeLowerFirst_(s) {
  // Keep acronyms / proper nouns ("MBTA", "Route 9") intact.
  if (!s || /^[A-Z]{2,}|^(?:Route|I-|Mass)/.test(s)) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function aeRemove_(arr, v) {
  const i = arr.indexOf(v);
  if (i !== -1) arr.splice(i, 1);
}

function aeCleanDate_(s) {
  s = (s || '').trim().replace(/(\d)(st|nd|rd|th)\b/i, '$1').replace(/\.$/, '');
  if (/^(now|immediately|today)$/i.test(s)) return 'now';
  return s.replace(/^([a-z]+)\.?(\s)/i, function (m, mon, sp) {
    return aeCap_(mon.toLowerCase().slice(0, 3)) + sp;
  });
}

function aeSentences_(text) {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  return t.match(/[^.!?]+(?:[.!?]+|$)/g).map(function (s) { return s.trim(); }).filter(String);
}

function aeTrimTo_(text, max) {
  if (!text || text.length <= max) return text || '';
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return end > max * 0.5 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '') + '…';
}

/** Every ad gets your contact block, so drop sentences carrying the old one. */
function aeStripContact_(text) {
  const contact = /https?:\/\/|www\.|[\w.+-]+@[\w-]+\.[\w.-]{2,}|(?:\+?1[-.\s]?)?\(?[2-9]\d{2}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b|^(?:call|text|contact|email|message)\b.{0,30}(?:today|now|info|details|showing)?[.!]?$/i;
  return aeSentences_(text).filter(function (s) { return !contact.test(s); }).join(' ');
}

/** "No broker fee, heat & hot water included and in-unit washer/dryer" */
function aeFeatureSentence_(items) {
  return aeCap_(aeJoinAnd_(items.map(aeLowerFirst_), 'and'));
}

function aeJoinAnd_(items, conj) {
  items = items.filter(String);
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return items[0] + ' ' + conj + ' ' + items[1];
  return items.slice(0, -1).join(', ') + ', ' + conj + ' ' + items[items.length - 1];
}

/** Add parts left to right while the result stays within max. */
function aeJoinFit_(parts, sep, max) {
  let out = '';
  parts.filter(String).forEach(function (p) {
    const next = out ? out + sep + p : p;
    if (next.length <= max) out = next;
  });
  return out;
}

/** First candidate that fits; else the shortest one, cut at a word boundary. */
function aeFirstFit_(cands, max) {
  cands = cands.filter(String).map(function (s) { return s.replace(/\s+/g, ' ').replace(/\.\./g, '.').trim(); });
  for (let i = 0; i < cands.length; i++) if (cands[i].length <= max) return cands[i];
  const shortest = cands.slice().sort(function (a, b) { return a.length - b.length; })[0] || '';
  return shortest.slice(0, max).replace(/\s+\S*$/, '');
}

/** Every distinct candidate that fits within max. */
function aeFitAll_(cands, max) {
  const seen = {};
  return cands.map(function (s) { return (s || '').replace(/\s+/g, ' ').trim(); })
    .filter(function (s) {
      const k = s.toLowerCase();
      if (!s || s.length > max || seen[k] || /^(?:\/|\d+BR\b ?$)/.test(s) || /\s(?:in|for)\s*$/.test(s)) return false;
      seen[k] = true;
      return true;
    });
}
