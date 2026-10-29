/**
 * ============================================================================
 *  LISTING -> LEAD ADS  —  web app + Google glue for AdEngine.gs
 *  Built for: James E. Guilford III  |  DiBiasio Realty
 * ============================================================================
 *
 *  Lives in the SAME Apps Script project as the Rental Lead Digest. The two
 *  close a loop:
 *
 *    Zillow / Marketplace listing
 *        -> paste into this web app
 *        -> ads for 10 channels, each tagged with a ref like DBR-7K3Q-CL
 *        -> renters reply / inquire
 *        -> Lead Digest reads the reply, spots the ref, logs which ad it came from
 *        -> next listing: "Find matching prospects" re-markets to past leads
 *
 *  SETUP
 *    1. Add AdEngine.gs, AdConverter.gs and AdConverterUI.html to the digest's
 *       Apps Script project (or a new one — it works standalone too).
 *    2. Fill in AD_CONFIG below (at minimum PHONE).
 *    3. Deploy -> New deployment -> Web app
 *         Execute as: Me      Who has access: Only myself
 *       "Only myself" matters: the app reads your lead log and creates Gmail
 *       drafts as you.
 *    4. Open the web app URL and bookmark it.
 *    5. Optional: run setClaudeKey('sk-ant-...') once from the editor to turn
 *       on the "Polish with Claude" button, then clear the argument.
 * ============================================================================
 */


const AD_CONFIG = {

  // Shown in every ad's call to action.
  AGENT_NAME: 'James E. Guilford III',
  BROKERAGE:  'DiBiasio Realty',
  PHONE:      '',                           // e.g. '(508) 555-0123'
  EMAIL:      'james.guilford@gmail.com',

  // Optional: a page with photos + an inquiry form (your website listing, a
  // Google Form, a Zillow listing link). Each platform gets its own UTM-tagged
  // copy so Google Analytics shows which ad sent the click.
  LANDING_URL: '',

  // Ref codes look like DBR-7K3Q-CL. The Lead Digest searches for this prefix.
  REF_PREFIX: 'DBR',

  // Defaults for the checkboxes in the web app.
  NO_BROKER_FEE:    false,   // true when you represent the landlord (MA 2025 fee law)
  WELCOME_VOUCHERS: true,    // adds "All lawful sources of income welcome"
  SHOW_ADDRESS:     true,

  // Past-prospect matching looks this far back in the lead log.
  MATCH_LOOKBACK_DAYS: 90,

  // Claude model for the optional "Polish" button.
  CLAUDE_MODEL: 'claude-opus-5-5'
};


/* ==========================================================================
 *  WEB APP
 * ========================================================================== */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('AdConverterUI')
    .setTitle('Listing → Lead Ads')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}


/** Defaults the page loads on open. */
function getAdDefaults() {
  return {
    agentName: AD_CONFIG.AGENT_NAME,
    brokerage: AD_CONFIG.BROKERAGE,
    phone: AD_CONFIG.PHONE,
    email: AD_CONFIG.EMAIL,
    landingUrl: AD_CONFIG.LANDING_URL,
    refPrefix: AD_CONFIG.REF_PREFIX,
    noBrokerFee: AD_CONFIG.NO_BROKER_FEE,
    welcomeVouchers: AD_CONFIG.WELCOME_VOUCHERS,
    showAddress: AD_CONFIG.SHOW_ADDRESS,
    hasClaude: !!PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY'),
    hasLeadLog: !!PropertiesService.getScriptProperties().getProperty('SHEET_ID')
  };
}


/* ==========================================================================
 *  AD LOG  —  one row per platform per listing, in the digest's spreadsheet
 * ========================================================================== */

function adLogSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SHEET_ID') || props.getProperty('AD_SHEET_ID');
  if (id) return SpreadsheetApp.openById(id);

  // Running without the digest: keep a log of our own.
  const ss = SpreadsheetApp.create('Listing → Lead Ads — Log');
  props.setProperty('AD_SHEET_ID', ss.getId());
  return ss;
}

function adLogSheet_() {
  const ss = adLogSpreadsheet_();
  let sh = ss.getSheetByName('Ads');
  if (!sh) {
    sh = ss.insertSheet('Ads');
    sh.appendRow(['Created', 'Listing ID', 'Address', 'City', 'Beds', 'Rent',
                  'Platform', 'Ref', 'Tracked URL', 'Status']);
    sh.setFrozenRows(1);
    sh.getRange('A1:J1').setFontWeight('bold').setBackground('#1a3a52').setFontColor('#ffffff');
  }
  return sh;
}


/**
 * Records every ad you generated so lead refs can be traced back to a unit.
 * @param {Object} listing
 * @param {Array}  ads   [{label, ref, trackedUrl}]
 */
function logAds(listing, ads) {
  const sh = adLogSheet_();
  const now = new Date();
  const id = listingId(listing);
  const addr = [listing.address, listing.unit ? '#' + listing.unit : ''].filter(String).join(' ');
  const rows = (ads || []).map(function (a) {
    return [now, id, addr, listing.city, listing.beds, listing.rent, a.label, a.ref, a.trackedUrl || '', 'Generated'];
  });
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  return { logged: rows.length, url: sh.getParent().getUrl() + '#gid=' + sh.getSheetId() };
}


/* ==========================================================================
 *  PAST-PROSPECT MATCHING  —  reads the digest's Leads sheet
 * ========================================================================== */

function findMatchingProspects(listing) {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('No lead log yet. Run the Lead Digest setup() first.');
  const sh = SpreadsheetApp.openById(id).getSheetByName('Leads');
  if (!sh || sh.getLastRow() < 2) return [];

  // Columns per the digest: First Seen, Source, Name, Email, Phone, City,
  // Bedrooms, Budget, Move-In, ...
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 9).getValues();
  const leads = rows.map(function (r) {
    return {
      firstSeen: r[0] instanceof Date ? r[0].getTime() : r[0],
      source: String(r[1] || ''), name: String(r[2] || ''), email: String(r[3] || ''),
      phone: String(r[4] || ''), city: String(r[5] || ''), bedrooms: String(r[6] || ''),
      budget: String(r[7] || ''), moveIn: String(r[8] || '')
    };
  });

  // Newest first so the dedupe in matchProspects keeps each person's latest ask.
  leads.reverse();
  return matchProspects(listing, leads, { maxAgeDays: AD_CONFIG.MATCH_LOOKBACK_DAYS })
    .slice(0, 50)
    .map(function (p) {
      // google.script.run can't return Date objects.
      p.firstSeen = p.firstSeen ? new Date(p.firstSeen).toISOString().slice(0, 10) : '';
      return p;
    });
}


/**
 * Creates one Gmail DRAFT per prospect. Nothing is sent: review in Gmail first.
 * @param {Array}  prospects  [{name, email}]
 * @param {string} subject
 * @param {string} body       may contain {{first_name}}
 */
function createOutreachDrafts(prospects, subject, body) {
  let made = 0;
  (prospects || []).forEach(function (p) {
    if (!p.email) return;
    const first = (p.name || '').trim().split(/\s+/)[0] || 'there';
    GmailApp.createDraft(p.email, subject, body.replace(/\{\{first_name\}\}/g, first), {
      name: [AD_CONFIG.AGENT_NAME, AD_CONFIG.BROKERAGE].filter(String).join(' | ')
    });
    made++;
  });
  return { drafts: made };
}


/* ==========================================================================
 *  OPTIONAL: POLISH WITH CLAUDE
 *  Rewrites one platform's copy for punch while keeping every fact, limit and
 *  fair-housing rule. The result is re-linted here; a field that comes back
 *  over its limit or with a 'block' hit keeps the original text.
 * ========================================================================== */

/** Run ONCE from the editor, then clear the argument. */
function setClaudeKey(key) {
  if (!key) throw new Error('Pass your Anthropic API key.');
  PropertiesService.getScriptProperties().setProperty('ANTHROPIC_API_KEY', key);
  Logger.log('Claude key stored. Reload the web app to see the Polish buttons.');
}


function polishAd(listing, ad) {
  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) throw new Error('No Claude key. Run setClaudeKey() from the editor first.');

  // Only rewrite prose. Structured fields (price, beds, URLs) stay exactly as generated.
  const editable = ad.fields
    .map(function (f, i) { return { i: i, name: f.name, value: f.value, limit: f.limit || null }; })
    .filter(function (f) {
      return f.value.length > 25 && !/^https?:|URL|link|Keywords|Negative|Instant Form|Hashtags/i.test(f.name + ' ' + f.value.slice(0, 8));
    });
  if (!editable.length) return ad;

  const system =
    'You write rental listing ads for a Massachusetts real estate agent. Rewrite the given ad fields ' +
    'so they are more compelling for ' + ad.label + ', in that platform\'s native style. Rules:\n' +
    '- Keep every fact (rent, beds, baths, dates, features, phone numbers, the "Ref:" code and the ' +
    'Equal Housing line) exactly as given. Do not invent features.\n' +
    '- Stay within each field\'s character limit when one is given.\n' +
    '- Describe the unit, never the ideal tenant. Never mention or imply a preference about family ' +
    'status, age, disability, religion, race, national origin, sex, sexual orientation, marital status, ' +
    'veteran status, or source of income (vouchers must always be welcome).\n' +
    '- Plain, confident language. No ALL CAPS sentences, no clickbait.';

  const payload = {
    model: AD_CONFIG.CLAUDE_MODEL,
    max_tokens: 16000,
    fallbacks: 'default',
    output_config: {
      effort: 'low',
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            fields: {
              type: 'array',
              items: {
                type: 'object',
                properties: { i: { type: 'integer' }, value: { type: 'string' } },
                required: ['i', 'value'],
                additionalProperties: false
              }
            }
          },
          required: ['fields'],
          additionalProperties: false
        }
      }
    },
    system: system,
    messages: [{
      role: 'user',
      content: 'Listing facts:\n' + JSON.stringify(listing) +
               '\n\nFields to rewrite (keep each "i"):\n' + JSON.stringify(editable)
    }]
  };

  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2026-10-21',
      'anthropic-beta': 'server-side-fallback-2026-07-01'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  const json = JSON.parse(res.getContentText() || '{}');
  if (code !== 200) {
    throw new Error('Claude API HTTP ' + code + ': ' + ((json.error && json.error.message) || res.getContentText().slice(0, 300)));
  }
  if (json.stop_reason === 'refusal') throw new Error('Claude declined to rewrite this ad. The original copy is unchanged.');
  if (json.stop_reason === 'max_tokens') throw new Error('Claude\'s reply was cut off. Try again.');

  const text = (json.content || []).filter(function (b) { return b.type === 'text'; })
    .map(function (b) { return b.text; }).join('');
  let out;
  try { out = JSON.parse(text); } catch (e) { throw new Error('Claude returned unreadable output. Try again.'); }

  const polished = JSON.parse(JSON.stringify(ad));
  let changed = 0;
  (out.fields || []).forEach(function (f) {
    const target = polished.fields[f.i];
    if (!target || typeof f.value !== 'string' || !f.value.trim()) return;
    if (target.limit && f.value.length > target.limit) return;
    if (lintText(f.value).some(function (h) { return h.severity === 'block'; })) return;
    if (ad.ref && target.value.indexOf(ad.ref) !== -1 && f.value.indexOf(ad.ref) === -1) return;
    target.value = f.value;
    target.over = false;
    changed++;
  });
  polished.lint = lintText(polished.fields.map(function (f) { return f.value; }).join('\n'))
    .filter(function (h) { return h.severity !== 'info'; });
  polished.polished = changed;
  return polished;
}
