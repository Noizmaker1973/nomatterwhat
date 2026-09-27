/**
 * NoteLine — private dashboard web app, the same arrangement as Deedline's.
 *
 * Serves the dashboard the weekly run builds (site/dashboard.html in the repo)
 * behind your Google sign-in, and keeps what you add in a Google Sheet you own,
 * "NoteLine tracker":
 *
 *   Lenders    status, follow-up date (optionally a Google Calendar event), and
 *              the latest Claude-written letter
 *   Contacts   the special assets / workout people you find, per lender
 *   Notes      timestamped call notes
 *
 * The Contacts tab is your own contact database — the thing paid tools charge
 * for. Keep it clean; it is worth more every month.
 *
 * It also saves Registry assignment searches you paste into the dashboard to the
 * repo's data/assignments/ folder, where the next run reads them for proven
 * sellers, and can start a run on demand.
 *
 * Script properties (Project Settings → Script Properties):
 *   GITHUB_TOKEN       fine-grained token for the noteline repo:
 *                      Contents read/write, Actions read/write
 *   ANTHROPIC_API_KEY  optional; turns on "Rewrite with Claude" letters
 *
 * Deploy → New deployment → Web app → Execute as: Me, Who has access: Only myself.
 */

const NL_OWNER = 'Noizmaker1973';
const NL_REPO = 'noteline';
const NL_BRANCH = 'main';
const NL_WORKFLOW = 'noteline.yml';

const LENDER_COLS = ['Lender ID', 'Lender', 'City', 'State', 'Status', 'Follow up',
                     'Calendar event', 'Letter', 'Letter written', 'Updated'];
const LENDER_KEYS = ['id', 'name', 'city', 'state', 'status', 'follow_up', 'event_id',
                     'letter', 'letter_at', 'updated'];
const CONTACT_COLS = ['Lender ID', 'Lender', 'Name', 'Title', 'Phone', 'Email', 'Note', 'Added'];
const NOTE_COLS = ['Timestamp', 'Lender ID', 'Lender', 'Note'];

function doGet() {
  const res = github_('GET', `contents/site/dashboard.html?ref=${NL_BRANCH}`, null,
                      'application/vnd.github.raw');
  if (res.getResponseCode() !== 200) {
    return HtmlService.createHtmlOutput(
      `<p style="font-family:sans-serif">Couldn't load the dashboard from GitHub ` +
      `(${res.getResponseCode()}). Check GITHUB_TOKEN in Project Settings → Script Properties, ` +
      `and that the weekly run has built site/dashboard.html.</p>`);
  }
  return HtmlService.createHtmlOutput(res.getContentText())
    .setTitle('NoteLine')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function github_(method, path, body, accept) {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('Add GITHUB_TOKEN under Project Settings → Script Properties.');
  const opts = { method: method.toLowerCase(), muteHttpExceptions: true,
                 headers: { Authorization: `Bearer ${token}`,
                            Accept: accept || 'application/vnd.github+json' } };
  if (body) { opts.contentType = 'application/json'; opts.payload = JSON.stringify(body); }
  return UrlFetchApp.fetch(`https://api.github.com/repos/${NL_OWNER}/${NL_REPO}/${path}`, opts);
}

/* ---------------------------------------------------------------- the Sheet */

function book_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('TRACKER_SHEET_ID');
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) { /* deleted: make a new one */ }
  }
  const ss = SpreadsheetApp.create('NoteLine tracker');
  const tabs = [['Lenders', LENDER_COLS], ['Contacts', CONTACT_COLS], ['Notes', NOTE_COLS]];
  tabs.forEach(([name, cols], i) => {
    const sh = i === 0 ? ss.getSheets()[0].setName(name) : ss.insertSheet(name);
    // Plain text everywhere, so dates and phone numbers are kept exactly as written.
    sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');
    sh.appendRow(cols).setFrozenRows(1);
  });
  props.setProperty('TRACKER_SHEET_ID', ss.getId());
  return ss;
}

function rows_(sheet) {
  const n = sheet.getLastRow();
  return n < 2 ? [] : sheet.getRange(2, 1, n - 1, sheet.getLastColumn()).getDisplayValues();
}

function appendText_(sheet, row) {
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setNumberFormat('@').setValues([row]);
}

function toLender_(row) {
  const rec = {};
  LENDER_KEYS.forEach((k, i) => { rec[k] = row[i] || ''; });
  return rec;
}

function upsertLender_(id, patch, snap) {
  const sheet = book_().getSheetByName('Lenders');
  const all = rows_(sheet);
  const i = all.findIndex(r => r[0] === id);
  const rec = i >= 0 ? toLender_(all[i]) : toLender_([]);
  Object.assign(rec, { id }, snap || {}, patch, { updated: new Date().toISOString() });
  const row = LENDER_KEYS.map(k => String(rec[k] == null ? '' : rec[k]).slice(0, 45000));
  if (i >= 0) sheet.getRange(i + 2, 1, 1, row.length).setValues([row]);
  else appendText_(sheet, row);
  return rec;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ------------------------------------------------- called from the dashboard */

function getTracker() {
  const ss = book_();
  const lenders = {};
  rows_(ss.getSheetByName('Lenders')).forEach(r => { lenders[r[0]] = toLender_(r); });
  const contacts = {};
  rows_(ss.getSheetByName('Contacts')).forEach(r => {
    (contacts[r[0]] = contacts[r[0]] || []).push(
      { name: r[2], title: r[3], phone: r[4], email: r[5], note: r[6], at: r[7] });
  });
  const notes = {};
  rows_(ss.getSheetByName('Notes')).forEach(r => {
    (notes[r[1]] = notes[r[1]] || []).push({ at: r[0], text: r[3] });
  });
  return { lenders, contacts, notes };
}

function addNote(id, text, snap) {
  return withLock_(() => {
    const note = { at: new Date().toISOString(), text: String(text).slice(0, 5000) };
    appendText_(book_().getSheetByName('Notes'), [note.at, id, snap.name || '', note.text]);
    upsertLender_(id, {}, snap);
    return note;
  });
}

function addContact(id, c, snap) {
  return withLock_(() => {
    const rec = { name: String(c.name || '').slice(0, 200), title: String(c.title || '').slice(0, 200),
                  phone: String(c.phone || '').slice(0, 60), email: String(c.email || '').slice(0, 200),
                  note: String(c.note || '').slice(0, 1000), at: new Date().toISOString() };
    appendText_(book_().getSheetByName('Contacts'),
                [id, snap.name || '', rec.name, rec.title, rec.phone, rec.email, rec.note, rec.at]);
    upsertLender_(id, {}, snap);
    return rec;
  });
}

function saveLender(id, f, snap) {
  return withLock_(() => {
    const cur = getTracker().lenders[id] || {};
    let eventId = cur.event_id || '';
    const wantEvent = f.calendar && f.follow_up && !['Dead', 'Not selling', 'Bought'].includes(f.status);
    const unchanged = eventId && cur.follow_up === f.follow_up;
    if (eventId && !(wantEvent && unchanged)) {
      try { const ev = CalendarApp.getEventById(eventId); if (ev) ev.deleteEvent(); } catch (e) {}
      eventId = '';
    }
    if (wantEvent && !eventId) {
      const [y, m, d] = f.follow_up.split('-').map(Number);
      const ev = CalendarApp.getDefaultCalendar().createAllDayEvent(
        `NoteLine follow-up: ${snap.name || id}`, new Date(y, m - 1, d),
        { description: `Status: ${f.status || '—'}\n\nOpen NoteLine: ${ScriptApp.getService().getUrl()}` });
      eventId = ev.getId();
    }
    return upsertLender_(id, { status: f.status || '', follow_up: f.follow_up || '',
                               event_id: eventId }, snap);
  });
}

/** Save a pasted Registry results table into data/assignments/ in the repo. */
function addAssignments(text, label) {
  text = String(text || '').trim();
  if (!text) throw new Error('Paste the results table first.');
  if (text.length > 900000) throw new Error('That paste is too large — save it in parts.');
  const stamp = Utilities.formatDate(new Date(), 'UTC', "yyyyMMdd'-'HHmmss");
  const slug = String(label || 'paste').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  const path = `data/assignments/${stamp}-${slug}.tsv`;
  const res = github_('PUT', `contents/${path}`, {
    message: `Registry assignments: ${label || 'pasted search'}`,
    content: Utilities.base64Encode(text + '\n', Utilities.Charset.UTF_8),
    branch: NL_BRANCH,
  });
  if (res.getResponseCode() >= 300) {
    throw new Error(`GitHub ${res.getResponseCode()}: ${res.getContentText().slice(0, 200)}`);
  }
  return { path, lines: text.split(/\r?\n/).length };
}

/** Start the weekly workflow now. */
function runNow() {
  const res = github_('POST', `actions/workflows/${NL_WORKFLOW}/dispatches`, { ref: NL_BRANCH });
  if (res.getResponseCode() !== 204) {
    throw new Error(`GitHub ${res.getResponseCode()}: ${res.getContentText().slice(0, 200)}`);
  }
  return true;
}

/* ------------------------------------------------------- letters by Claude */

function draftLetter(id, facts, snap) {
  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) throw new Error('Add ANTHROPIC_API_KEY under Project Settings → Script Properties to use this.');
  const out = claudeLetter_(key, facts);
  return withLock_(() => upsertLender_(id, {
    letter: `Subject: ${out.subject}\n\n${out.body}`, letter_at: new Date().toISOString(),
  }, snap));
}

function claudeLetter_(key, facts) {
  const schema = {
    type: 'object',
    properties: { subject: { type: 'string' }, body: { type: 'string' } },
    required: ['subject', 'body'],
    additionalProperties: false,
  };
  const body = {
    model: 'claude-opus-5',
    max_tokens: 8000,
    // Apps Script gives a web request about a minute; medium effort keeps a
    // short letter well inside that.
    output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
    // If a safety classifier declines, re-run on Anthropic's recommended model.
    fallbacks: 'default',
    system:
      'You write first-contact letters from a private note buyer to the special assets ' +
      '(loan workout) department of a bank or credit union, asking whether they sell ' +
      'non-performing loans. Plain, brief, professional — under 200 words, no hype, no ' +
      'flattery. Use only the facts given. It is fine to mention specific properties the ' +
      'lender is foreclosing on, since those filings are public, but never mention the ' +
      "lender's financial condition, ratios or regulators — that reads as a threat. If a " +
      'contact name is given, address them by name. Keep the buyer\'s name, company and ' +
      'contact details exactly as they appear in the template letter, including any ' +
      '[placeholders]. Return the subject line and the body separately.',
    messages: [{ role: 'user', content: JSON.stringify(facts) }],
  };
  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01',
               'anthropic-beta': 'server-side-fallback-2026-07-01' },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  let msg = {};
  try { msg = JSON.parse(res.getContentText()); } catch (e) { /* reported below */ }
  if (code !== 200) {
    throw new Error(`Claude API ${code}: ${(msg.error && msg.error.message) || res.getContentText().slice(0, 200)}`);
  }
  if (msg.stop_reason === 'refusal') throw new Error('Claude declined to write this letter.');
  if (msg.stop_reason === 'max_tokens') throw new Error('The letter came back cut off — try again.');
  const block = (msg.content || []).find(b => b.type === 'text');
  if (!block) throw new Error('Claude returned no letter.');
  return JSON.parse(block.text);
}
