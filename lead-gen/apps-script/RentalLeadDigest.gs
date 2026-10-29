/**
 * ============================================================================
 *  RENTAL LEAD DIGEST  —  Massachusetts renter-prospect aggregator
 *  Built for: James E. Guilford III  |  DiBiasio Realty
 * ============================================================================
 *
 *  WHAT IT DOES
 *    Every morning it pulls renter prospects from two legitimate pipes:
 *      PIPE 1 — Gmail: inbound lead notifications from Zillow, Apartments.com,
 *               Rentals.com, Realtor.com, Craigslist relay, Facebook, and any
 *               generic inquiry that hits your inbox. Normalizes 5+ different
 *               email formats into one row shape.
 *      PIPE 2 — RSS: Google Alerts feeds for public "apartment wanted" posts.
 *      PIPE 3 — Nextdoor Search API: public 'anyone' posts inside a geofence.
 *               DORMANT until Nextdoor approves you and you paste credentials.
 *               See NEXTDOOR_NOTES at the bottom of this file.
 *
 *    Then it dedupes, scores, logs to a Google Sheet, and emails you one
 *    consolidated HTML digest.
 *
 *    AD ATTRIBUTION (pairs with AdEngine.gs / AdConverter.gs)
 *    Every ad the Listing -> Lead Ads web app writes carries a ref like
 *    DBR-7K3Q-CL. When a lead's message contains one, the digest records which
 *    unit and which platform produced it ("Ad Ref" column + a tag in the email).
 *
 *  SETUP (five clicks, no server)
 *    1. script.google.com -> New Project -> paste this whole file
 *    2. Edit CONFIG below (at minimum: REPORT_TO, and your Alert feed URLs)
 *    3. Run  setup()   -> approve the OAuth prompt when Google shows it
 *    4. Run  testFeeds()  -> confirms which RSS feeds actually return items
 *    5. Run  runDailyReport()  -> sends one now so you can see the output
 *
 *  Google's OAuth consent screen is user-gated. Nobody can complete it for you.
 *
 *  FAIR HOUSING — READ THIS
 *    This tool scores leads ONLY on transaction readiness: stated budget,
 *    move-in timeline, bedroom count, target city, and completeness of contact
 *    info. It never scores on, and actively refuses to extract, any protected
 *    characteristic. Under MA law (G.L. c.151B) source of income — including
 *    Section 8, HomeBASE, RAFT, MRVP and any other subsidy — is PROTECTED.
 *    Voucher mentions are therefore tagged as a positive program-match signal,
 *    never a negative. Do not edit SCORING to change that.
 * ============================================================================
 */


/* ==========================================================================
 *  CONFIG
 * ========================================================================== */

const CONFIG = {

  // Where the morning digest lands.
  REPORT_TO: 'james.guilford@gmail.com',

  // Hour of day to send, 24h, script timezone. 6 = between 6am and 7am.
  SEND_HOUR: 6,

  // How far back Gmail is searched on each run. 1 = yesterday forward.
  GMAIL_LOOKBACK_DAYS: 1,

  // Send the email even when zero new leads were found?
  // false = quiet mornings stay quiet.
  SEND_WHEN_EMPTY: false,

  // Optional: label processed threads in Gmail so you can audit what was read.
  APPLY_GMAIL_LABEL: true,
  GMAIL_LABEL_NAME: 'Lead Digest/Processed',

  /* ----------------------------------------------------------------------
   *  PIPE 1 — Gmail sources.
   *  Each entry is a Gmail search query plus which parser to run on the hit.
   *  Adjust the `from:` values to match how these platforms actually reach
   *  you — check your inbox and correct any that differ.
   * -------------------------------------------------------------------- */
  GMAIL_SOURCES: [
    { source: 'Zillow',         parser: 'zillow',     query: 'from:(zillow.com) subject:(inquiry OR "is interested" OR contacted OR lead)' },
    { source: 'Apartments.com', parser: 'apartments', query: 'from:(apartments.com OR apartmentlist.com) subject:(lead OR inquiry OR "new contact")' },
    { source: 'Rentals.com',    parser: 'generic',    query: 'from:(rentals.com OR rent.com)' },
    { source: 'Realtor.com',    parser: 'generic',    query: 'from:(realtor.com) subject:(lead OR inquiry)' },
    { source: 'Craigslist',     parser: 'craigslist', query: 'from:(craigslist.org) subject:(re:)' },
    { source: 'Facebook',       parser: 'generic',    query: 'from:(facebookmail.com) (marketplace OR "is interested")' },
    { source: 'Direct',         parser: 'generic',    query: 'subject:("looking for" OR "apartment" OR "rental inquiry" OR "housing") -from:(zillow.com OR apartments.com OR craigslist.org OR facebookmail.com)' },
    // Replies that quote an ad ref (Nextdoor, Google, outreach emails...). Keep
    // the search term in sync with AD_CONFIG.REF_PREFIX. Overlap with the
    // queries above is harmless: fingerprints dedupe it.
    { source: 'Ad Reply',       parser: 'generic',    query: 'DBR -from:me' }
  ],

  /* ----------------------------------------------------------------------
   *  PIPE 2 — RSS feeds.
   *
   *  To create a Google Alerts feed:
   *    google.com/alerts -> enter query -> Show options ->
   *    Deliver to: RSS feed -> Create Alert -> copy the feed URL
   *
   *  Suggested queries (make one alert each):
   *    "apartment wanted" Massachusetts
   *    "looking for an apartment" Worcester OR Framingham OR Springfield
   *    "housing wanted" Massachusetts rental
   *    "need a 2 bedroom" Massachusetts rent
   *    "apartment needed" Boston metrowest
   *
   *  Run testFeeds() after adding any feed. Feeds rot; the verifier tells you
   *  which ones are actually returning items before you trust the digest.
   * -------------------------------------------------------------------- */
  FEEDS: [
    // { source: 'Alert: apartment wanted MA', url: 'https://www.google.com/alerts/feeds/XXXXXXXXXXXX/YYYYYYYYYYYY' },
    // { source: 'Alert: looking for apartment Worcester', url: 'https://www.google.com/alerts/feeds/XXXXXXXXXXXX/ZZZZZZZZZZZZ' },
  ],

  /* ----------------------------------------------------------------------
   *  PIPE 3 — Nextdoor Search API.
   *
   *  Stays off until ENABLED is true AND credentials are stored. Credentials
   *  live in Script Properties, never in this file — run
   *  setNextdoorCredentials('your_id','your_secret') once from the editor,
   *  then delete the call from the editor's execution history.
   *
   *  Apply: https://forms.gle/Njbiq8mT9EqtZKh88
   *  Nextdoor Partnerships issues client_id / client_secret on approval.
   * -------------------------------------------------------------------- */
  NEXTDOOR: {
    ENABLED: false,

    // Each point is one API call per query term. Keep the matrix small:
    // POINTS x QUERIES = total calls per run.
    // radius units are undocumented — assume miles, verify with testNextdoor().
    POINTS: [
      { label: 'MetroWest',  lat: 42.2793, lon: -71.4162, radius: 12 },  // Framingham
      { label: 'Worcester',  lat: 42.2626, lon: -71.8023, radius: 12 },
      { label: 'Boston',     lat: 42.3601, lon: -71.0589, radius: 10 },
      { label: 'Springfield',lat: 42.1015, lon: -72.5898, radius: 10 }
    ],

    QUERIES: [
      'looking for apartment',
      'apartment wanted',
      'need a rental',
      'housing needed',
      'moving to the area rental'
    ],

    INCLUDE_COMMENTS: true,

    // The endpoint only returns the last 7 days regardless. This is a local
    // guard so a re-run after an outage doesn't flood the digest.
    MAX_AGE_DAYS: 7
  },

  /* ----------------------------------------------------------------------
   *  Geography filter for RSS results. A feed item must mention at least one
   *  of these to survive. Gmail leads skip this filter (they came to you).
   * -------------------------------------------------------------------- */
  GEO_TERMS: [
    'massachusetts', ' ma ', ', ma', 'mass.',
    // MetroWest core
    'framingham', 'natick', 'ashland', 'holliston', 'marlborough', 'hudson',
    'sudbury', 'wayland', 'weston', 'wellesley', 'needham', 'newton',
    'southborough', 'northborough', 'westborough', 'milford', 'hopkinton',
    // Worcester County
    'worcester', 'fitchburg', 'leominster', 'gardner', 'clinton', 'webster',
    'southbridge', 'shrewsbury', 'auburn', 'millbury', 'grafton', 'oxford',
    // Gateway cities / high volume
    'boston', 'springfield', 'lowell', 'brockton', 'lynn', 'new bedford',
    'fall river', 'lawrence', 'haverhill', 'chicopee', 'holyoke', 'pittsfield',
    'quincy', 'somerville', 'cambridge', 'malden', 'medford', 'revere',
    'everett', 'chelsea', 'taunton', 'attleboro', 'methuen', 'peabody',
    'salem', 'waltham', 'brookline', 'watertown', 'dedham', 'randolph'
  ],

  // An RSS item must also read like someone SEEKING housing, not offering it.
  INTENT_TERMS: [
    'looking for', 'in search of', 'iso ', 'need a', 'needed', 'wanted',
    'seeking', 'anyone know of', 'any leads', 'help finding', 'trying to find',
    'apartment hunting', 'house hunting', 'relocating to', 'moving to'
  ],

  // Kills landlord/agent listings that match the intent terms by accident.
  EXCLUDE_TERMS: [
    'for rent by owner', 'now leasing', 'available now', 'schedule a tour',
    'apply today', 'no fee apartments', 'sq ft', 'call to view',
    'open house', 'we have', 'our community', 'amenities include'
  ]
};


/* ==========================================================================
 *  FAIR HOUSING GUARD
 *  Terms in this list are never used for scoring, ranking or filtering.
 *  Subsidy terms are separated out because MA protects source of income and
 *  they are affirmatively useful for program matching (HomeBASE, NEHS, RAFT).
 * ========================================================================== */

const PROTECTED_NEVER_SCORE = [
  'child', 'children', 'kids', 'pregnant', 'baby', 'family of',
  'disabled', 'disability', 'wheelchair', 'service animal', 'handicap',
  'church', 'muslim', 'christian', 'jewish', 'catholic',
  'black', 'white', 'hispanic', 'latino', 'asian', 'immigrant', 'refugee',
  'single mother', 'single father', 'married', 'divorced', 'veteran',
  'gay', 'lesbian', 'trans', 'elderly', 'senior citizen'
];

const SUBSIDY_PROGRAMS = [
  'section 8', 'section eight', 'housing choice', 'hcv', 'voucher',
  'homebase', 'home base', 'raft', 'mrvp', 'mrvp voucher', 'vash',
  'rental assistance', 'housing authority', 'emergency assistance',
  'shelter', 'caseworker', 'case manager', 'subsidy', 'subsidized'
];


/* ==========================================================================
 *  SETUP / MAINTENANCE
 * ========================================================================== */

/**
 * Run once. Creates the log spreadsheet, the Gmail label, and the daily trigger.
 */
function setup() {
  const props = PropertiesService.getScriptProperties();

  // 1. Log spreadsheet
  let sheetId = props.getProperty('SHEET_ID');
  if (!sheetId) {
    const ss = SpreadsheetApp.create('Rental Lead Digest — Log');
    sheetId = ss.getId();
    props.setProperty('SHEET_ID', sheetId);

    const leads = ss.getActiveSheet();
    leads.setName('Leads');
    leads.appendRow([
      'First Seen', 'Source', 'Name', 'Email', 'Phone', 'City',
      'Bedrooms', 'Budget', 'Move-In', 'Program Signal', 'Score',
      'Summary', 'Link', 'Fingerprint', 'Ad Ref'
    ]);
    leads.setFrozenRows(1);
    leads.getRange('A1:O1').setFontWeight('bold').setBackground('#1a3a52').setFontColor('#ffffff');

    const seen = ss.insertSheet('_seen');
    seen.appendRow(['Fingerprint', 'Date']);
    seen.hideSheet();

    Logger.log('Created log spreadsheet: ' + ss.getUrl());
  }

  // 2. Gmail label
  if (CONFIG.APPLY_GMAIL_LABEL) {
    if (!GmailApp.getUserLabelByName(CONFIG.GMAIL_LABEL_NAME)) {
      GmailApp.createLabel(CONFIG.GMAIL_LABEL_NAME);
    }
  }

  // 3. Daily trigger (clear any duplicates first)
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runDailyReport') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runDailyReport')
    .timeBased()
    .atHour(CONFIG.SEND_HOUR)
    .everyDays(1)
    .create();

  Logger.log('SETUP COMPLETE. Digest will send daily around %s:00.', CONFIG.SEND_HOUR);
  Logger.log('Log sheet: https://docs.google.com/spreadsheets/d/' + sheetId);
  Logger.log('Next: run testFeeds(), then runDailyReport().');
}


/**
 * Verifies every configured RSS feed. Feeds break silently — run this whenever
 * the digest looks thin.
 */
function testFeeds() {
  if (!CONFIG.FEEDS.length) {
    Logger.log('No feeds configured. Add Google Alerts RSS URLs to CONFIG.FEEDS.');
    return;
  }
  CONFIG.FEEDS.forEach(function (f) {
    try {
      const res = UrlFetchApp.fetch(f.url, { muteHttpExceptions: true, followRedirects: true });
      const code = res.getResponseCode();
      if (code !== 200) {
        Logger.log('FAIL  [%s]  HTTP %s  — %s', f.source, code, f.url);
        return;
      }
      const items = parseFeedXml_(res.getContentText(), f.source);
      Logger.log('OK    [%s]  %s items', f.source, items.length);
    } catch (err) {
      Logger.log('ERROR [%s]  %s', f.source, err.message);
    }
  });
}


/**
 * Run ONCE from the editor after Nextdoor approves you, with your real values.
 * Then clear the arguments so the secret isn't left sitting in the source.
 */
function setNextdoorCredentials(clientId, clientSecret) {
  if (!clientId || !clientSecret) {
    throw new Error('Pass both client_id and client_secret.');
  }
  PropertiesService.getScriptProperties().setProperties({
    ND_CLIENT_ID: clientId,
    ND_CLIENT_SECRET: clientSecret
  });
  Logger.log('Nextdoor credentials stored. Set CONFIG.NEXTDOOR.ENABLED = true, then run testNextdoor().');
}


/**
 * Proves the whole chain: credentials -> token -> one live search call.
 * Logs the raw first result so you can confirm the response field names
 * against what normalizeNextdoorPost_() expects.
 */
function testNextdoor() {
  const token = ndToken_(true);
  if (!token) { Logger.log('No token. Check credentials and approved scopes.'); return; }
  Logger.log('Token OK.');

  const p = CONFIG.NEXTDOOR.POINTS[0];
  const url = 'https://nextdoor.com/content_api/v2/search_post' +
              '?query=' + encodeURIComponent(CONFIG.NEXTDOOR.QUERIES[0]) +
              '&lat=' + p.lat + '&lon=' + p.lon + '&radius=' + p.radius +
              '&include_comments=' + CONFIG.NEXTDOOR.INCLUDE_COMMENTS;

  const res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });

  Logger.log('HTTP %s', res.getResponseCode());
  const txt = res.getContentText();
  Logger.log('Raw response (first 2500 chars):\n%s', txt.slice(0, 2500));

  try {
    const posts = extractPostArray_(JSON.parse(txt));
    Logger.log('Parsed %s posts.', posts.length);
    if (posts.length) Logger.log('First post keys: %s', Object.keys(posts[0]).join(', '));
  } catch (e) {
    Logger.log('Could not parse: %s', e.message);
  }
}


/* ==========================================================================
 *  MAIN
 * ========================================================================== */

function runDailyReport() {
  const started = new Date();
  let leads = [];

  try { leads = leads.concat(collectGmailLeads_()); }
  catch (e) { Logger.log('Gmail pipe failed: ' + e.message); }

  try { leads = leads.concat(collectFeedLeads_()); }
  catch (e) { Logger.log('Feed pipe failed: ' + e.message); }

  try { leads = leads.concat(collectNextdoorLeads_()); }
  catch (e) { Logger.log('Nextdoor pipe failed: ' + e.message); }

  // Dedupe against everything ever seen
  const fresh = filterUnseen_(leads);

  fresh.forEach(function (l) { tagAdRef_(l); l.score = scoreLead_(l); });
  fresh.sort(function (a, b) { return b.score - a.score; });

  if (fresh.length) {
    logLeads_(fresh);
    markSeen_(fresh);
  }

  if (!fresh.length && !CONFIG.SEND_WHEN_EMPTY) {
    Logger.log('No new leads. Digest suppressed.');
    return;
  }

  MailApp.sendEmail({
    to: CONFIG.REPORT_TO,
    subject: buildSubject_(fresh),
    htmlBody: buildHtml_(fresh, started),
    name: 'Rental Lead Digest'
  });

  Logger.log('Sent %s leads in %ss.', fresh.length, (new Date() - started) / 1000);
}


/* ==========================================================================
 *  PIPE 1 — GMAIL
 * ========================================================================== */

function collectGmailLeads_() {
  const out = [];
  const label = CONFIG.APPLY_GMAIL_LABEL
    ? GmailApp.getUserLabelByName(CONFIG.GMAIL_LABEL_NAME)
    : null;

  CONFIG.GMAIL_SOURCES.forEach(function (src) {
    const q = src.query + ' newer_than:' + CONFIG.GMAIL_LOOKBACK_DAYS + 'd';
    let threads = [];
    try { threads = GmailApp.search(q, 0, 50); }
    catch (e) { Logger.log('Query failed [%s]: %s', src.source, e.message); return; }

    threads.forEach(function (thread) {
      thread.getMessages().forEach(function (msg) {
        // Skip anything you sent
        if (msg.getFrom().indexOf(CONFIG.REPORT_TO) !== -1) return;

        const body = stripHtml_(msg.getBody()).slice(0, 4000);
        const lead = parseMessage_(src.parser, src.source, msg, body);
        if (lead) out.push(lead);
      });
      if (label) { try { thread.addLabel(label); } catch (e) {} }
    });
  });

  return out;
}


function parseMessage_(parserName, source, msg, body) {
  const base = {
    source: source,
    subject: msg.getSubject() || '',
    body: body,
    received: msg.getDate(),
    link: 'https://mail.google.com/mail/u/0/#inbox/' + msg.getThread().getId(),
    inbound: true,
    name: '', email: '', phone: '', city: '', bedrooms: '', budget: '', moveIn: ''
  };

  switch (parserName) {
    case 'zillow':     return parseZillow_(base, msg);
    case 'apartments': return parseApartments_(base, msg);
    case 'craigslist': return parseCraigslist_(base, msg);
    default:           return parseGeneric_(base, msg);
  }
}


function parseZillow_(l, msg) {
  const b = l.body;
  l.name    = first_(b, [/^([A-Z][a-z]+ [A-Z][a-z']+)\s+is interested/m,
                         /Name:\s*(.+)/i,
                         /From:\s*([A-Z][a-z]+ [A-Z][a-z']+)/]) || nameFromSubject_(l.subject);
  l.email   = firstEmail_(b, msg);
  l.phone   = firstPhone_(b);
  l.moveIn  = first_(b, [/Move[- ]?in(?: date)?:?\s*([A-Za-z0-9 ,\/]{3,25})/i]);
  l.bedrooms= first_(b, [/(\d)\s*(?:\+)?\s*(?:bed|bd|br\b)/i]);
  l.budget  = first_(b, [/\$\s?([\d,]{3,7})\s*(?:\/mo|per month|month|budget)?/i]);
  l.city    = detectCity_(b + ' ' + l.subject);
  return l;
}


function parseApartments_(l, msg) {
  const b = l.body;
  l.name    = first_(b, [/(?:Name|Renter|Contact)\s*:?\s*(.+)/i]) || nameFromSubject_(l.subject);
  l.email   = firstEmail_(b, msg);
  l.phone   = firstPhone_(b);
  l.moveIn  = first_(b, [/Move[- ]?in:?\s*(.+)/i, /Desired move.*?:\s*(.+)/i]);
  l.bedrooms= first_(b, [/Bedrooms?:?\s*(\d)/i, /(\d)\s*bed/i]);
  l.budget  = first_(b, [/(?:Budget|Price range|Max rent):?\s*\$?\s?([\d,]{3,7})/i]);
  l.city    = detectCity_(b + ' ' + l.subject);
  return l;
}


function parseCraigslist_(l, msg) {
  // CL relays through anonymous addresses; the reply-to IS the lead channel.
  const b = l.body;
  l.name    = nameFromSubject_(l.subject) || first_(b, [/^(?:Hi|Hello|Hey)[,!]?\s*.{0,20}\n+.*?\n+.*?([A-Z][a-z]+)\s*$/m]);
  l.email   = firstEmail_(b, msg);
  l.phone   = firstPhone_(b);
  l.city    = detectCity_(b + ' ' + l.subject);
  l.bedrooms= first_(b, [/(\d)\s*(?:bed|bd|br\b)/i]);
  l.budget  = first_(b, [/\$\s?([\d,]{3,7})/]);
  return l;
}


function parseGeneric_(l, msg) {
  const b = l.body;
  l.email   = firstEmail_(b, msg);
  l.phone   = firstPhone_(b);
  l.name    = senderName_(msg) || nameFromSubject_(l.subject);
  l.city    = detectCity_(b + ' ' + l.subject);
  l.bedrooms= first_(b, [/(\d)\s*(?:bed|bedroom|bd|br\b)/i]);
  l.budget  = first_(b, [/\$\s?([\d,]{3,7})/]);
  l.moveIn  = first_(b, [/move[- ]?in(?: date)?:?\s*([A-Za-z0-9 ,\/]{3,25})/i,
                         /(?:available|need it|moving)\s+(?:by|on|in)\s+([A-Za-z0-9 ,\/]{3,20})/i]);
  return l;
}


/* ==========================================================================
 *  PIPE 2 — RSS
 * ========================================================================== */

function collectFeedLeads_() {
  const out = [];

  CONFIG.FEEDS.forEach(function (f) {
    let xml;
    try {
      const res = UrlFetchApp.fetch(f.url, { muteHttpExceptions: true, followRedirects: true });
      if (res.getResponseCode() !== 200) {
        Logger.log('Feed %s returned HTTP %s', f.source, res.getResponseCode());
        return;
      }
      xml = res.getContentText();
    } catch (e) {
      Logger.log('Feed %s unreachable: %s', f.source, e.message);
      return;
    }

    parseFeedXml_(xml, f.source).forEach(function (item) {
      const hay = (item.title + ' ' + item.body).toLowerCase();

      if (!containsAny_(hay, CONFIG.GEO_TERMS))    return;  // not Massachusetts
      if (!containsAny_(hay, CONFIG.INTENT_TERMS)) return;  // not someone seeking
      if (containsAny_(hay, CONFIG.EXCLUDE_TERMS)) return;  // it's a listing

      out.push({
        source:   f.source,
        subject:  item.title,
        body:     item.body,
        received: item.date || new Date(),
        link:     item.link,
        inbound:  false,
        name:     '',
        email:    firstEmail_(item.body, null),
        phone:    firstPhone_(item.body),
        city:     detectCity_(hay),
        bedrooms: first_(item.body, [/(\d)\s*(?:bed|bedroom|bd|br\b)/i]),
        budget:   first_(item.body, [/\$\s?([\d,]{3,7})/]),
        moveIn:   first_(item.body, [/(?:move[- ]?in|moving|need(?:ed)? by)\s*:?\s*([A-Za-z0-9 ,\/]{3,25})/i])
      });
    });
  });

  return out;
}


/**
 * Handles both Atom (Google Alerts) and RSS 2.0.
 */
function parseFeedXml_(xml, source) {
  const items = [];
  let doc;
  try { doc = XmlService.parse(xml); }
  catch (e) { Logger.log('Malformed XML from %s', source); return items; }

  const root = doc.getRootElement();
  const atom = XmlService.getNamespace('http://www.w3.org/2005/Atom');

  // Atom
  let entries = root.getChildren('entry', atom);
  if (!entries.length) entries = root.getChildren('entry');
  entries.forEach(function (e) {
    const linkEl = e.getChild('link', atom) || e.getChild('link');
    items.push({
      title: decode_(childText_(e, 'title', atom)),
      body:  decode_(childText_(e, 'content', atom) || childText_(e, 'summary', atom)),
      link:  linkEl ? cleanAlertLink_(linkEl.getAttribute('href') ? linkEl.getAttribute('href').getValue() : '') : '',
      date:  parseDate_(childText_(e, 'published', atom) || childText_(e, 'updated', atom))
    });
  });
  if (items.length) return items;

  // RSS 2.0
  const channel = root.getChild('channel');
  const rssItems = channel ? channel.getChildren('item') : root.getChildren('item');
  rssItems.forEach(function (i) {
    items.push({
      title: decode_(childText_(i, 'title', null)),
      body:  decode_(childText_(i, 'description', null)),
      link:  childText_(i, 'link', null),
      date:  parseDate_(childText_(i, 'pubDate', null))
    });
  });

  return items;
}


/* ==========================================================================
 *  PIPE 3 — NEXTDOOR SEARCH API
 *
 *  Token:  POST https://auth.nextdoor.com/v2/token
 *          Basic base64(client_id:client_secret)
 *          grant_type=client_credentials
 *          scope="content_api.search_post openid"
 *
 *  Search: GET https://nextdoor.com/content_api/v2/search_post
 *          ?query=&lat=&lon=&radius=&include_comments=
 *          Authorization: Bearer <token>
 *
 *  Only posts from the last 7 days are eligible, and only posts whose author
 *  set visibility to 'anyone' are returned at all.
 * ========================================================================== */

/**
 * Fetches (and caches) a bearer token. Cached 50 min; tokens are typically
 * longer-lived but there's no reason to sit near the expiry edge.
 */
function ndToken_(verbose) {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('ND_CLIENT_ID');
  const secret = props.getProperty('ND_CLIENT_SECRET');

  if (!id || !secret) {
    if (verbose) Logger.log('No Nextdoor credentials. Run setNextdoorCredentials() first.');
    return null;
  }

  const cache = CacheService.getScriptCache();
  const hit = cache.get('ND_TOKEN');
  if (hit) return hit;

  const res = UrlFetchApp.fetch('https://auth.nextdoor.com/v2/token', {
    method: 'post',
    headers: {
      Authorization: 'Basic ' + Utilities.base64Encode(id + ':' + secret),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    payload: {
      grant_type: 'client_credentials',
      scope: 'content_api.search_post openid'
    },
    muteHttpExceptions: true
  });

  if (res.getResponseCode() !== 200) {
    Logger.log('Nextdoor token failed: HTTP %s — %s',
               res.getResponseCode(), res.getContentText().slice(0, 400));
    return null;
  }

  let token;
  try { token = JSON.parse(res.getContentText()).access_token; }
  catch (e) { Logger.log('Token response unparseable.'); return null; }

  if (token) cache.put('ND_TOKEN', token, 3000);
  return token || null;
}


function collectNextdoorLeads_() {
  const nd = CONFIG.NEXTDOOR;
  if (!nd.ENABLED) return [];

  const token = ndToken_(false);
  if (!token) return [];

  const out = [];
  const cutoff = new Date(Date.now() - nd.MAX_AGE_DAYS * 86400000);

  nd.POINTS.forEach(function (point) {
    nd.QUERIES.forEach(function (q) {
      const url = 'https://nextdoor.com/content_api/v2/search_post' +
                  '?query=' + encodeURIComponent(q) +
                  '&lat=' + point.lat +
                  '&lon=' + point.lon +
                  '&radius=' + point.radius +
                  '&include_comments=' + nd.INCLUDE_COMMENTS;

      let res;
      try {
        res = UrlFetchApp.fetch(url, {
          method: 'get',
          headers: { Authorization: 'Bearer ' + token },
          muteHttpExceptions: true
        });
      } catch (e) {
        Logger.log('Nextdoor call failed [%s / %s]: %s', point.label, q, e.message);
        return;
      }

      if (res.getResponseCode() !== 200) {
        Logger.log('Nextdoor HTTP %s [%s / %s]', res.getResponseCode(), point.label, q);
        return;
      }

      let posts;
      try { posts = extractPostArray_(JSON.parse(res.getContentText())); }
      catch (e) { Logger.log('Nextdoor JSON unparseable [%s]', point.label); return; }

      posts.forEach(function (raw) {
        const lead = normalizeNextdoorPost_(raw, point);
        if (!lead) return;
        if (lead.received && lead.received < cutoff) return;

        const hay = (lead.subject + ' ' + lead.body).toLowerCase();
        if (!containsAny_(hay, CONFIG.INTENT_TERMS)) return;  // not someone seeking
        if (containsAny_(hay, CONFIG.EXCLUDE_TERMS)) return;  // it's a listing

        out.push(lead);
      });

      Utilities.sleep(400);  // be a good citizen; no published rate limit
    });
  });

  return out;
}


/**
 * The response schema isn't published, so walk the object for the first array
 * of post-shaped things rather than assuming a key name.
 */
function extractPostArray_(json) {
  if (Array.isArray(json)) return json;
  const candidates = ['posts', 'results', 'data', 'items', 'content', 'search_results'];
  for (let i = 0; i < candidates.length; i++) {
    const v = json[candidates[i]];
    if (Array.isArray(v)) return v;
    if (v && Array.isArray(v.posts)) return v.posts;
    if (v && Array.isArray(v.results)) return v.results;
  }
  // Last resort: first array-valued property holding objects
  for (const k in json) {
    if (Array.isArray(json[k]) && json[k].length && typeof json[k][0] === 'object') {
      return json[k];
    }
  }
  return [];
}


/**
 * Defensive field mapping. Nextdoor doesn't publish the post object's field
 * names, so each value tries several plausible keys. Run testNextdoor() and
 * check the logged "First post keys" line — if a field is empty in your
 * digest, add the real key name to the relevant pick_() list here.
 */
function normalizeNextdoorPost_(raw, point) {
  if (!raw || typeof raw !== 'object') return null;

  const title = pick_(raw, ['title', 'subject', 'headline']);
  const body  = pick_(raw, ['body', 'description', 'text', 'content', 'message', 'snippet']);
  if (!title && !body) return null;

  const author = pick_(raw, ['author_name', 'author', 'neighbor_name', 'user_name', 'display_name']);
  const hood   = pick_(raw, ['neighborhood_name', 'neighborhood', 'group_name', 'city']);
  const link   = pick_(raw, ['url', 'permalink', 'link', 'post_url', 'web_url']);
  const when   = pick_(raw, ['created_at', 'creation_date', 'published_at', 'timestamp', 'date']);

  const text = stripHtml_(title + '\n' + body);

  return {
    source:   'Nextdoor / ' + point.label,
    subject:  stripHtml_(title) || 'Nextdoor post',
    body:     text,
    received: parseDate_(when) || new Date(),
    link:     link || '',
    inbound:  false,
    name:     typeof author === 'string' ? author : '',
    // No contact details come back from the API — you reply inside Nextdoor.
    email:    '',
    phone:    '',
    city:     (typeof hood === 'string' && hood) ? hood : detectCity_(text.toLowerCase()) || point.label,
    bedrooms: first_(text, [/(\d)\s*(?:bed|bedroom|bd|br\b)/i]),
    budget:   first_(text, [/\$\s?([\d,]{3,7})/]),
    moveIn:   first_(text, [/(?:move[- ]?in|moving|need(?:ed)? by)\s*:?\s*([A-Za-z0-9 ,\/]{3,25})/i])
  };
}


function pick_(obj, keys) {
  for (let i = 0; i < keys.length; i++) {
    const v = obj[keys[i]];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (v && typeof v === 'object') {
      const nested = v.name || v.text || v.value || v.display_name;
      if (typeof nested === 'string' && nested.trim()) return nested.trim();
    }
  }
  return '';
}


/* ==========================================================================
 *  SCORING  —  transaction readiness only. See FAIR HOUSING note at top.
 * ========================================================================== */

function scoreLead_(l) {
  let s = 0;
  const hay = (l.subject + ' ' + l.body).toLowerCase();

  // Reachability — can you actually respond?
  if (l.phone) s += 25;
  if (l.email) s += 20;
  if (l.name)  s += 5;

  // Specificity — a specific ask is a real ask
  if (l.city)     s += 12;
  if (l.bedrooms) s += 8;
  if (l.budget)   s += 12;
  if (l.moveIn)   s += 10;

  // Urgency
  if (/asap|immediately|urgent|right away|this week|need.{0,10}(now|today)/i.test(hay)) s += 15;
  if (/within (?:a |the )?(?:month|30 days|two weeks)/i.test(hay)) s += 8;

  // Qualification signals the prospect volunteered
  if (/pre[- ]?approved|credit score|employed|income|pay stub|references/i.test(hay)) s += 10;

  // Inbound beats discovered — they came to you
  if (l.inbound) s += 15;

  // Discovered posts carry no contact details; the reply channel is the
  // platform itself. Credit reachability-by-link so they aren't all buried.
  if (!l.phone && !l.email && l.link) s += 12;

  // MA protects source of income. A subsidy is a POSITIVE program-match signal
  // (HomeBASE / NEHS / RAFT pipelines) and never a deduction.
  if (containsAny_(hay, SUBSIDY_PROGRAMS)) s += 10;

  return Math.min(s, 100);
}


function programSignal_(l) {
  const hay = (l.subject + ' ' + l.body).toLowerCase();
  const hits = SUBSIDY_PROGRAMS.filter(function (p) { return hay.indexOf(p) !== -1; });
  return hits.length ? hits.slice(0, 2).join(', ') : '';
}


/* ==========================================================================
 *  AD ATTRIBUTION  —  which ad produced this lead?
 *  parseAdRef() lives in AdEngine.gs. Without it (digest deployed alone) this
 *  is a no-op.
 * ========================================================================== */

function tagAdRef_(l) {
  l.adRef = '';
  l.adPlatform = '';
  if (typeof parseAdRef !== 'function') return;
  const prefix = typeof AD_CONFIG !== 'undefined' ? AD_CONFIG.REF_PREFIX : 'DBR';
  const hit = parseAdRef((l.subject || '') + '\n' + (l.body || ''), prefix);
  if (hit) {
    l.adRef = hit.ref;
    l.adPlatform = hit.platform;
  }
}


/* ==========================================================================
 *  DEDUPE + LOGGING
 * ========================================================================== */

function fingerprint_(l) {
  const key = [
    (l.email || '').toLowerCase(),
    (l.phone || '').replace(/\D/g, ''),
    (l.link || ''),
    (l.subject || '').toLowerCase().slice(0, 60)
  ].join('|');
  return Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, key)
  ).slice(0, 22);
}


function seenSheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('Run setup() first.');
  return SpreadsheetApp.openById(id).getSheetByName('_seen');
}


function filterUnseen_(leads) {
  const sheet = seenSheet_();
  const last = sheet.getLastRow();
  const known = {};
  if (last > 1) {
    sheet.getRange(2, 1, last - 1, 1).getValues()
      .forEach(function (r) { known[r[0]] = true; });
  }

  const out = [];
  const batch = {};
  leads.forEach(function (l) {
    const fp = fingerprint_(l);
    if (known[fp] || batch[fp]) return;
    batch[fp] = true;
    l.fingerprint = fp;
    out.push(l);
  });
  return out;
}


function markSeen_(leads) {
  const sheet = seenSheet_();
  const now = new Date();
  const rows = leads.map(function (l) { return [l.fingerprint, now]; });
  if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 2).setValues(rows);
}


function logLeads_(leads) {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const sheet = SpreadsheetApp.openById(id).getSheetByName('Leads');

  // Sheets created before ad attribution existed have 14 columns; label the 15th.
  if (!sheet.getRange('O1').getValue()) {
    sheet.getRange('O1').setValue('Ad Ref')
      .setFontWeight('bold').setBackground('#1a3a52').setFontColor('#ffffff');
  }

  const rows = leads.map(function (l) {
    return [
      new Date(), l.source, l.name, l.email, l.phone, l.city,
      l.bedrooms, l.budget, l.moveIn, programSignal_(l), l.score,
      summarize_(l), l.link, l.fingerprint, l.adRef || ''
    ];
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}


/* ==========================================================================
 *  EMAIL RENDERING
 * ========================================================================== */

function buildSubject_(leads) {
  if (!leads.length) return 'Rental Leads — none overnight';
  const hot = leads.filter(function (l) { return l.score >= 60; }).length;
  const d = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMM d');
  return 'Rental Leads — ' + leads.length + ' new' +
         (hot ? ', ' + hot + ' priority' : '') + ' — ' + d;
}


function buildHtml_(leads, started) {
  const tz = Session.getScriptTimeZone();
  const today = Utilities.formatDate(new Date(), tz, 'EEEE, MMMM d, yyyy');

  let h = '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;' +
          'max-width:680px;margin:0 auto;color:#1a1a1a;">';

  h += '<div style="background:#1a3a52;color:#fff;padding:20px 24px;border-radius:6px 6px 0 0;">' +
       '<div style="font-size:19px;font-weight:600;">Rental Lead Digest</div>' +
       '<div style="font-size:13px;opacity:.8;margin-top:3px;">' + today + '</div></div>';

  if (!leads.length) {
    h += '<div style="padding:28px 24px;border:1px solid #e2e2e2;border-top:none;">' +
         'No new prospects since the last run.</div></div>';
    return h;
  }

  // Counters
  const hot = leads.filter(function (l) { return l.score >= 60; });
  const program = leads.filter(function (l) { return programSignal_(l); });
  const fromAds = leads.filter(function (l) { return l.adRef; });
  h += '<div style="display:block;padding:14px 24px;background:#f5f7f9;border:1px solid #e2e2e2;border-top:none;font-size:13px;">' +
       '<b>' + leads.length + '</b> new &nbsp;·&nbsp; ' +
       '<b>' + hot.length + '</b> priority &nbsp;·&nbsp; ' +
       '<b>' + program.length + '</b> with a program signal' +
       (fromAds.length ? ' &nbsp;·&nbsp; <b>' + fromAds.length + '</b> from your ads' : '') + '</div>';

  leads.forEach(function (l) {
    const band = l.score >= 60 ? '#0b7a3b' : (l.score >= 35 ? '#b8860b' : '#8a8a8a');
    const prog = programSignal_(l);

    h += '<div style="border:1px solid #e2e2e2;border-top:none;padding:18px 24px;">';

    h += '<div style="display:block;margin-bottom:8px;">' +
         '<span style="background:' + band + ';color:#fff;font-size:11px;font-weight:700;' +
         'padding:3px 8px;border-radius:3px;">' + l.score + '</span> ' +
         '<span style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.5px;' +
         'margin-left:6px;">' + esc_(l.source) + '</span>' +
         (l.adRef ? ' <span style="font-size:11px;color:#1a5490;border:1px solid #1a5490;border-radius:3px;' +
                    'padding:2px 6px;margin-left:6px;">Ad ' + esc_(l.adRef) + ' · ' + esc_(l.adPlatform) + '</span>' : '') +
         '</div>';

    h += '<div style="font-size:16px;font-weight:600;margin-bottom:6px;">' +
         esc_(l.name || l.subject || 'Unnamed prospect') + '</div>';

    const facts = [];
    if (l.phone)    facts.push('<b>Phone</b> ' + esc_(l.phone));
    if (l.email)    facts.push('<b>Email</b> ' + esc_(l.email));
    if (l.city)     facts.push('<b>City</b> ' + esc_(l.city));
    if (l.bedrooms) facts.push('<b>Beds</b> ' + esc_(l.bedrooms));
    if (l.budget)   facts.push('<b>Budget</b> $' + esc_(l.budget));
    if (l.moveIn)   facts.push('<b>Move-in</b> ' + esc_(l.moveIn));
    if (facts.length) {
      h += '<div style="font-size:13px;color:#333;line-height:1.7;margin-bottom:8px;">' +
           facts.join(' &nbsp;·&nbsp; ') + '</div>';
    }

    if (prog) {
      h += '<div style="font-size:12px;background:#eef4ea;border-left:3px solid #0b7a3b;' +
           'padding:7px 10px;margin-bottom:8px;color:#245c36;">' +
           'Program signal: ' + esc_(prog) +
           ' — source of income is protected in MA; treat as a match opportunity.</div>';
    }

    h += '<div style="font-size:13px;color:#555;line-height:1.6;">' +
         esc_(summarize_(l)) + '</div>';

    if (l.link) {
      h += '<div style="margin-top:10px;"><a href="' + esc_(l.link) + '" ' +
           'style="font-size:13px;color:#1a5490;text-decoration:none;font-weight:600;">Open source &rsaquo;</a></div>';
    }

    h += '</div>';
  });

  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  h += '<div style="border:1px solid #e2e2e2;border-top:none;border-radius:0 0 6px 6px;' +
       'padding:14px 24px;background:#fafafa;font-size:12px;color:#777;line-height:1.6;">' +
       '<a href="https://docs.google.com/spreadsheets/d/' + sheetId + '" style="color:#1a5490;">Full lead log</a>' +
       ' &nbsp;·&nbsp; scored on transaction readiness only' +
       ' &nbsp;·&nbsp; run took ' + ((new Date() - started) / 1000).toFixed(1) + 's<br>' +
       'Screen every prospect on identical, documented criteria. G.L. c.151B protects source of income.' +
       '</div></div>';

  return h;
}


function summarize_(l) {
  let t = (l.body || l.subject || '').replace(/\s+/g, ' ').trim();
  // Strip boilerplate footers common to platform emails
  t = t.replace(/(unsubscribe|view this|privacy policy|do not reply).*/i, '');
  return t.length > 260 ? t.slice(0, 260).trim() + '…' : t;
}


/* ==========================================================================
 *  UTILITIES
 * ========================================================================== */

function first_(text, patterns) {
  if (!text) return '';
  for (let i = 0; i < patterns.length; i++) {
    const m = text.match(patterns[i]);
    if (m && m[1]) return m[1].toString().trim().replace(/\s+/g, ' ').slice(0, 60);
  }
  return '';
}

function firstEmail_(text, msg) {
  const m = (text || '').match(/[\w.+-]+@[\w-]+\.[\w.-]{2,}/);
  if (m && !/(noreply|no-reply|donotreply|mailer|notification)/i.test(m[0])) return m[0];
  if (msg) {
    const from = msg.getReplyTo() || msg.getFrom();
    const fm = from.match(/[\w.+-]+@[\w-]+\.[\w.-]{2,}/);
    if (fm && !/(noreply|no-reply|donotreply)/i.test(fm[0])) return fm[0];
  }
  return '';
}

function firstPhone_(text) {
  const m = (text || '').match(/(?:\+?1[-.\s]?)?\(?([2-9]\d{2})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})\b/);
  return m ? '(' + m[1] + ') ' + m[2] + '-' + m[3] : '';
}

function senderName_(msg) {
  const m = (msg.getFrom() || '').match(/^"?([^"<]+?)"?\s*</);
  return m ? m[1].trim() : '';
}

function nameFromSubject_(subject) {
  const m = (subject || '').match(/(?:from|by)\s+([A-Z][a-z]+ [A-Z][a-z']+)/);
  return m ? m[1] : '';
}

function detectCity_(text) {
  const t = (text || '').toLowerCase();
  for (let i = 0; i < CONFIG.GEO_TERMS.length; i++) {
    const term = CONFIG.GEO_TERMS[i].trim();
    if (term.length < 4) continue;                 // skip 'ma' variants
    if (t.indexOf(term) !== -1) {
      return term.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    }
  }
  return '';
}

function containsAny_(hay, terms) {
  for (let i = 0; i < terms.length; i++) {
    if (hay.indexOf(terms[i]) !== -1) return true;
  }
  return false;
}

function childText_(el, name, ns) {
  const c = ns ? (el.getChild(name, ns) || el.getChild(name)) : el.getChild(name);
  return c ? c.getText() : '';
}

function stripHtml_(html) {
  return (html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decode_(s) { return stripHtml_(s || ''); }

function cleanAlertLink_(url) {
  // Google Alerts wraps targets in a redirect
  const m = (url || '').match(/[?&]url=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : url;
}

function parseDate_(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function esc_(s) {
  return (s || '').toString()
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}


/* ==========================================================================
 *  NEXTDOOR_NOTES — read before you rely on Pipe 3
 * ==========================================================================
 *
 *  ACTIVATION ORDER
 *    1. Apply: https://forms.gle/Njbiq8mT9EqtZKh88
 *       Ask specifically for the Search API with scope content_api.search_post.
 *    2. On approval, Partnerships sends client_id + client_secret.
 *    3. Run setNextdoorCredentials('id','secret') once, then clear the args.
 *    4. Set CONFIG.NEXTDOOR.ENABLED = true.
 *    5. Run testNextdoor(). Read the logged response before trusting anything.
 *
 *  KNOWN UNCERTAINTIES — all resolved by testNextdoor(), none by guessing
 *
 *    Post window. Nextdoor's product page advertises 30 days; the endpoint
 *    reference says only posts from the last 7 days are eligible. The
 *    reference is more likely current. MAX_AGE_DAYS is set to 7 to match.
 *
 *    Response schema. Nextdoor does not publish the post object's field names.
 *    normalizeNextdoorPost_() therefore tries several plausible keys per field.
 *    testNextdoor() logs the raw payload and the actual key list — paste the
 *    real names into the pick_() arrays and the guessing disappears.
 *
 *    Radius units. Documented only as a float defaulting to 5. Miles is the
 *    likely unit. Compare a 12-radius Framingham call against a 1-radius one;
 *    if both return the same neighborhoods, the unit is not what you assumed.
 *
 *    Rate limits. None published for the Search API. The 400ms sleep between
 *    calls is a courtesy, not a documented requirement. Current matrix is
 *    4 points x 5 queries = 20 calls per run.
 *
 *  WHAT THIS PIPE CANNOT GIVE YOU
 *    No email, no phone. The API returns post content and metadata, not
 *    contact details. Every Nextdoor lead is a "go reply inside Nextdoor"
 *    lead, which is why scoreLead_ credits reachability-by-link instead.
 *
 *    Only 'anyone' posts. A neighbor asking their own neighborhood for
 *    housing leads has no reason to set visibility to public, so expect the
 *    returned slice to be a small fraction of real Nextdoor volume. If Pipe 3
 *    runs clean for two weeks and still returns almost nothing, that is the
 *    answer to the question, not a bug to chase.
 *
 *  FAIR HOUSING
 *    Same rules as every other pipe. Nextdoor posts often volunteer household
 *    details nobody asked for. PROTECTED_NEVER_SCORE keeps those out of the
 *    math; do not add them back as filters because the post made it easy.
 * ========================================================================== */
