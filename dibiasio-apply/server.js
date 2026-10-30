require('dotenv').config();
const path = require('path');
const express = require('express');
const multer = require('multer');
const store = require('./lib/store');
const auth = require('./lib/auth');
const notify = require('./lib/notify');
const { fillOriginal } = require('./lib/original');
const { buildPackage, fileAsPdf, inPackage } = require('./lib/package');
const health = require('./lib/health');
const { FORMS, STATUSES, dealPrefill } = require('./public/js/forms');

const PORT = process.env.PORT || 5050;
const PUBLIC_URL = (process.env.PUBLIC_URL || 'http://localhost:' + PORT).replace(/\/$/, '');
const CONFIG = {
  company: 'Dibiasio Realty',
  phone: process.env.COMPANY_PHONE || '',
  email: process.env.COMPANY_EMAIL || 'james@dibiasiorealty.com',
  creditScreeningUrl: process.env.CREDIT_SCREENING_URL || '',
  creditProvider: process.env.CREDIT_PROVIDER_NAME || 'our screening partner',
  // Without SMTP, Email buttons open a draft in the agent's mail: 'gmail' (web) or 'mailto' (mail app).
  composeWith: process.env.EMAIL_COMPOSE === 'gmail' ? 'gmail' : 'mailto',
};

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'geolocation=(), microphone=()',
  });
  if (process.env.NODE_ENV === 'production') res.set('Strict-Transport-Security', 'max-age=31536000');
  next();
});
app.use(express.json({ limit: '1mb' }));

const page = (name) => (req, res) => res.set('Cache-Control', 'no-cache').sendFile(path.join(__dirname, 'public', name + '.html'));
app.get('/', page('index'));
app.get('/apply', page('apply'));
app.get('/status', page('status'));
app.get('/agent', page('agent'));
app.get('/agent/print', page('print'));
// Scripts and styles revalidate on every load so agents and applicants get
// updates immediately; images can be cached.
app.use(express.static(path.join(__dirname, 'public'), {
  index: false,
  setHeaders: (res, file) => res.set('Cache-Control', /\.(png|jpe?g|svg|ico)$/.test(file) ? 'public, max-age=86400' : 'no-cache'),
}));

/* ----------------------------- helpers ---------------------------------- */
const ALLOWED_TYPES = /^(application\/pdf|image\/(jpeg|png|heic|heif|webp|gif)|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document)$/;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 30 },
  fileFilter: (req, file, cb) => cb(ALLOWED_TYPES.test(file.mimetype) ? null : new Error('Unsupported file type: ' + file.originalname), true),
});

function rateLimit(max, windowMs) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const list = (hits.get(req.ip) || []).filter((t) => now - t < windowMs);
    if (list.length >= max) return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
    list.push(now);
    hits.set(req.ip, list);
    next();
  };
}

const log = (deal, who, text) => {
  deal.activity = deal.activity || [];
  deal.activity.unshift({ at: new Date().toISOString(), who, text });
  deal.activity = deal.activity.slice(0, 200);
};

// A failed alert means an agent may never hear about an application, so record
// it for the dashboard's notice and on the deal itself.
const alertFailed = (deal, what) => (e) => {
  console.error('[notify] alert failed:', e.message);
  const property = [deal.sheet.address, deal.sheet.unit && 'Unit ' + deal.sheet.unit].filter(Boolean).join(', ');
  health.recordFailure({ what, dealId: deal.id, property, error: e.message });
  try {
    log(deal, 'System', 'Alert failed to send: ' + what);
    store.saveDeal(deal);
  } catch (err) { console.error('[notify] could not log failure on deal:', err.message); }
};
const checkStorage = () => health.checkStorage((st) => notify.storageWarning(st, PUBLIC_URL + '/agent'));

function attachFiles(appRecord, files, by) {
  const added = [];
  for (const file of files || []) {
    const docType = String(file.fieldname || '').replace(/^doc_/, '') || 'other';
    const fileId = store.saveFile(appRecord.id, file);
    const meta = { id: fileId, docType, name: file.originalname.slice(0, 200), size: file.size, mime: file.mimetype, uploadedAt: new Date().toISOString(), by };
    appRecord.files.push(meta);
    added.push(meta);
  }
  return added;
}

// Server-side check of required answers, honouring showIf and group minimums.
function validate(form, answers, locked) {
  const missing = [];
  const blank = (v) => v == null || String(v).trim() === '';
  const visible = (field, scope) => !field.showIf || scope[field.showIf.k] === field.showIf.eq;
  const check = (fields, scope, prefix) => {
    for (const field of fields) {
      if (!field.k || !visible(field, scope)) continue;
      if (field.type === 'group') {
        const items = Array.isArray(scope[field.k]) ? scope[field.k] : [];
        if (items.length < (field.min || 0)) missing.push(field.label);
        items.forEach((item, i) => check(field.fields, item || {}, field.label + ' ' + (i + 1) + ': '));
      } else if (field.req && blank(scope[field.k]) && !(field.deal && locked[field.deal])) {
        missing.push(prefix + field.label);
      }
    }
  };
  form.steps.forEach((step) => check(step.fields, answers, ''));
  return missing;
}

function appSummary(appRecord) {
  return {
    id: appRecord.id, formType: appRecord.formType, createdAt: appRecord.createdAt, updatedAt: appRecord.updatedAt,
    name: appRecord.summary.name, email: appRecord.summary.email, phone: appRecord.summary.phone,
    monthlyIncome: appRecord.summary.monthlyIncome, files: appRecord.files.map((f) => ({ ...f, inPackage: inPackage(f) })), credit: appRecord.credit,
    eviction: appRecord.eviction || { status: 'Not checked', cases: [], notes: '' },
    reopened: appRecord.reopened || null, resubmittedAt: appRecord.resubmittedAt || null, versions: (appRecord.history || []).length + 1,
    editUrl: PUBLIC_URL + '/apply?u=' + appRecord.uploadToken,
  };
}
function dealSummary(deal) {
  const agent = deal.agentId && auth.get(deal.agentId);
  return {
    id: deal.id, token: deal.token, formType: deal.formType, status: deal.status, sheet: deal.sheet,
    agentId: deal.agentId, agentName: agent ? agent.name : 'Unassigned',
    createdAt: deal.createdAt, updatedAt: deal.updatedAt,
    applicants: store.appsForDeal(deal).map(appSummary),
    link: PUBLIC_URL + '/apply?d=' + deal.token,
    // Guarantors who apply with this link join the same deal.
    guarantorLink: deal.formType === 'guarantor' ? PUBLIC_URL + '/apply?d=' + deal.token : deal.guarantorToken ? PUBLIC_URL + '/apply?d=' + deal.guarantorToken : '',
    notes: deal.notes || [],
  };
}
function newDeal(formType, agentId, sheet) {
  return {
    id: store.id(), token: store.id(12), guarantorToken: store.id(12), formType, agentId: agentId || null, status: 'New',
    sheet: sheet || {}, appIds: [], activity: [], createdAt: new Date().toISOString(),
  };
}

// An applicant link is either the deal's own link or its guarantor link.
function dealForLink(token) {
  const deal = store.findDealByToken(token);
  if (deal) return { deal, formType: deal.formType };
  const g = store.findDealByGuarantorToken(token);
  return g ? { deal: g, formType: 'guarantor' } : { deal: null };
}

/* ----------------------------- public API -------------------------------- */
app.get('/api/public/config', (req, res) => res.json({ ...CONFIG, statuses: STATUSES, emailEnabled: notify.enabled }));

app.get('/api/public/deal/:token', (req, res) => {
  const { deal, formType } = dealForLink(req.params.token);
  if (!deal) return res.status(404).json({ error: 'This application link is no longer valid. Please contact your agent.' });
  const agent = deal.agentId && auth.get(deal.agentId);
  res.json({
    formType,
    prefill: dealPrefill(deal.sheet),
    property: { address: deal.sheet.address || '', unit: deal.sheet.unit || '', city: deal.sheet.city || '', rent: deal.sheet.rent || '', moveIn: deal.sheet.moveIn || '' },
    agent: auth.publicAgent(agent),
    applicantCount: deal.appIds.length,
  });
});

app.get('/api/public/agent/:id', (req, res) => {
  const agent = auth.get(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found.' });
  res.json(auth.publicAgent(agent));
});

app.post('/api/public/applications', rateLimit(15, 3600e3), upload.any(), (req, res, next) => submitApplication(req, res).catch(next));

// Express 4 doesn't catch errors thrown in async handlers, so this is wrapped above.
async function submitApplication(req, res) {
  let payload;
  try { payload = JSON.parse(req.body.payload || '{}'); } catch { return res.status(400).json({ error: 'Invalid submission.' }); }

  const link = payload.dealToken ? dealForLink(payload.dealToken) : { deal: null };
  let deal = link.deal;
  if (payload.dealToken && !deal) return res.status(404).json({ error: 'This application link is no longer valid.' });
  const formType = deal ? link.formType : payload.form;
  const form = FORMS[formType];
  if (!form) return res.status(400).json({ error: 'Unknown application type.' });

  const answers = payload.answers || {};
  const locked = deal ? dealPrefill(deal.sheet) : {};
  // Fields the agent prefilled are authoritative.
  form.steps.forEach((s) => s.fields.forEach((fl) => { if (fl.deal && locked[fl.deal]) answers[fl.k] = locked[fl.deal]; }));

  const missing = validate(form, answers, locked);
  const sig = payload.signature || {};
  if (!sig.typedName || !sig.image) missing.push('Signature');
  if (!payload.consents || !payload.consents.terms || !payload.consents.credit) missing.push('Consent to the application terms and credit check');
  if (missing.length) return res.status(400).json({ error: 'Some required information is missing.', missing });

  if (!deal) {
    const agentId = payload.agentId && auth.get(payload.agentId) ? payload.agentId : null;
    deal = newDeal(formType, agentId, {});
  }

  const now = new Date().toISOString();
  const appRecord = {
    id: store.id(), dealId: deal.id, formType, uploadToken: store.id(18), createdAt: now,
    summary: {
      name: form.applicantName(answers) || sig.typedName,
      email: form.applicantEmail(answers) || '',
      phone: form.applicantPhone(answers) || '',
      monthlyIncome: Math.round(form.income(answers) || 0),
    },
    answers: store.sealAnswers({
      answers,
      signature: { typedName: sig.typedName, image: sig.image, signedAt: now, ip: req.ip, userAgent: req.get('user-agent') || '' },
      otherSigners: (payload.otherSigners || []).filter((s) => s && s.name),
      consents: { ...payload.consents, at: now },
    }),
    files: [],
    credit: { status: 'Not requested' },
  };
  attachFiles(appRecord, req.files, 'applicant');
  store.saveApp(appRecord);

  deal.appIds.push(appRecord.id);
  if (!deal.sheet.address && answers.aptAddress) deal.sheet.address = answers.aptAddress;
  log(deal, appRecord.summary.name, 'Submitted application with ' + appRecord.files.length + ' document(s)');
  store.saveDeal(deal);

  notify.newApplication({ deal, appRecord, agent: deal.agentId && auth.get(deal.agentId), form, dashboardUrl: PUBLIC_URL + '/agent#deal/' + deal.id }).catch(alertFailed(deal, 'New application from ' + appRecord.summary.name));
  checkStorage();

  res.json({
    ok: true,
    confirmation: appRecord.id.slice(0, 8).toUpperCase(),
    statusUrl: PUBLIC_URL + '/status?t=' + appRecord.uploadToken,
    coApplicantUrl: PUBLIC_URL + '/apply?d=' + (formType === 'guarantor' && deal.guarantorToken ? deal.guarantorToken : deal.token),
    creditScreeningUrl: CONFIG.creditScreeningUrl,
  });
}

// Applicant's private link for adding documents after submitting.
app.get('/api/public/status/:token', (req, res) => {
  const a = store.findAppByToken(req.params.token);
  if (!a) return res.status(404).json({ error: 'Link not found.' });
  const deal = store.getDeal(a.dealId);
  res.json({
    name: a.summary.name, formType: a.formType, submittedAt: a.createdAt,
    files: a.files.filter((x) => x.by === 'applicant').map(({ docType, name, uploadedAt }) => ({ docType, name, uploadedAt })),
    status: deal ? deal.status : 'New',
    property: deal ? [deal.sheet.address, deal.sheet.unit && 'Unit ' + deal.sheet.unit].filter(Boolean).join(', ') : '',
    agent: deal && deal.agentId ? auth.publicAgent(auth.get(deal.agentId)) : null,
    creditScreeningUrl: a.credit.status === 'Requested' || a.credit.status === 'Not requested' ? CONFIG.creditScreeningUrl : '',
    reopened: a.reopened ? { note: a.reopened.note, at: a.reopened.at } : null,
    editUrl: a.reopened ? PUBLIC_URL + '/apply?u=' + a.uploadToken : '',
  });
});

app.post('/api/public/status/:token/files', rateLimit(30, 3600e3), upload.any(), (req, res) => {
  const a = store.findAppByToken(req.params.token);
  if (!a) return res.status(404).json({ error: 'Link not found.' });
  const added = attachFiles(a, req.files, 'applicant');
  store.saveApp(a);
  const deal = store.getDeal(a.dealId);
  if (deal) {
    log(deal, a.summary.name, 'Uploaded ' + added.length + ' more document(s)');
    store.saveDeal(deal);
    notify.moreDocuments({ deal, appRecord: a, agent: deal.agentId && auth.get(deal.agentId), count: added.length, dashboardUrl: PUBLIC_URL + '/agent#deal/' + deal.id }).catch(alertFailed(deal, a.summary.name + ' uploaded ' + added.length + ' document(s)'));
    checkStorage();
  }
  res.json({ ok: true, added: added.length });
});

/* ------------------- applicant updates a sent-back application ------------------- */
// The upload link can only read the application back while an agent has sent it
// back for changes, and even then SSNs and ITINs are masked: the applicant sees
// "•••-••-6789" and the stored number is kept unless they type a new one.
const isSecret = (field) => field.type === 'ssn' || field.k === 'itin';
const maskSecret = (v) => { const d = String(v || '').replace(/\D/g, ''); return d ? '•••-••-' + d.slice(-4) : ''; };
const isMasked = (v) => String(v || '').includes('•');

function maskAnswers(fields, scope) {
  const out = { ...scope };
  fields.forEach((field) => {
    if (!field.k) return;
    if (field.type === 'group') out[field.k] = (scope[field.k] || []).map((item) => maskAnswers(field.fields, item || {}));
    else if (isSecret(field) && scope[field.k]) out[field.k] = maskSecret(scope[field.k]);
  });
  return out;
}
// Put back the stored numbers behind masked values. Group items may have been
// reordered or removed, so a masked value is matched to the previous item with
// the same last four digits (preferring the same name).
function unmaskAnswers(fields, scope, prev) {
  fields.forEach((field) => {
    if (!field.k) return;
    if (field.type === 'group') {
      const before = Array.isArray(prev[field.k]) ? prev[field.k] : [];
      (scope[field.k] || []).forEach((item) => {
        if (!item) return;
        field.fields.filter(isSecret).forEach((sf) => {
          if (!isMasked(item[sf.k])) return;
          const same = before.filter((b) => b && b[sf.k] && maskSecret(b[sf.k]) === item[sf.k]);
          const match = same.find((b) => b.fullName && b.fullName === item.fullName) || same[0];
          item[sf.k] = match ? match[sf.k] : '';
        });
      });
    } else if (isSecret(field) && isMasked(scope[field.k])) {
      scope[field.k] = maskSecret(prev[field.k]) === scope[field.k] ? prev[field.k] : '';
    }
  });
  return scope;
}

function openForEdit(req, res) {
  const a = store.findAppByToken(req.params.token);
  if (!a) { res.status(404).json({ error: 'Link not found.' }); return null; }
  if (!a.reopened) { res.status(403).json({ error: 'This application has already been submitted. Contact your agent if something needs to change.' }); return null; }
  return a;
}

app.get('/api/public/edit/:token', (req, res) => {
  const a = openForEdit(req, res);
  if (!a) return;
  const deal = store.getDeal(a.dealId);
  const form = FORMS[a.formType];
  const application = store.openAnswers(a);
  const sheet = deal ? deal.sheet : {};
  res.json({
    formType: a.formType,
    note: a.reopened.note || '',
    answers: maskAnswers(form.steps.flatMap((st) => st.fields), application.answers || {}),
    files: a.files.filter((x) => x.by === 'applicant').map(({ docType, name, uploadedAt }) => ({ docType, name, uploadedAt })),
    prefill: dealPrefill(sheet),
    property: { address: sheet.address || '', unit: sheet.unit || '', city: sheet.city || '', rent: sheet.rent || '', moveIn: sheet.moveIn || '' },
    agent: deal && deal.agentId ? auth.publicAgent(auth.get(deal.agentId)) : null,
    statusUrl: PUBLIC_URL + '/status?t=' + a.uploadToken,
  });
});

app.post('/api/public/edit/:token', rateLimit(15, 3600e3), upload.any(), (req, res) => {
  const a = openForEdit(req, res);
  if (!a) return;
  let payload;
  try { payload = JSON.parse(req.body.payload || '{}'); } catch { return res.status(400).json({ error: 'Invalid submission.' }); }
  const deal = store.getDeal(a.dealId);
  const form = FORMS[a.formType];
  const fields = form.steps.flatMap((st) => st.fields);
  const before = store.openAnswers(a);
  const answers = unmaskAnswers(fields, payload.answers || {}, before.answers || {});
  const locked = deal ? dealPrefill(deal.sheet) : {};
  fields.forEach((fl) => { if (fl.deal && locked[fl.deal]) answers[fl.k] = locked[fl.deal]; });

  const missing = validate(form, answers, locked);
  const sig = payload.signature || {};
  if (!sig.typedName || !sig.image) missing.push('Signature');
  if (!payload.consents || !payload.consents.terms || !payload.consents.credit) missing.push('Consent to the application terms and credit check');
  if (missing.length) return res.status(400).json({ error: 'Some required information is missing.', missing });

  const now = new Date().toISOString();
  // Keep every signed version, so the agent can see what changed.
  a.history = (a.history || []).concat([{ answers: a.answers, summary: a.summary, submittedAt: a.resubmittedAt || a.createdAt, replacedAt: now, note: a.reopened.note || '' }]);
  a.answers = store.sealAnswers({
    answers,
    signature: { typedName: sig.typedName, image: sig.image, signedAt: now, ip: req.ip, userAgent: req.get('user-agent') || '' },
    otherSigners: (payload.otherSigners || []).filter((x) => x && x.name),
    consents: { ...payload.consents, at: now },
  });
  a.summary = {
    name: form.applicantName(answers) || sig.typedName,
    email: form.applicantEmail(answers) || '',
    phone: form.applicantPhone(answers) || '',
    monthlyIncome: Math.round(form.income(answers) || 0),
  };
  a.resubmittedAt = now;
  a.reopened = null;
  const added = attachFiles(a, req.files, 'applicant');
  store.saveApp(a);
  if (deal) {
    log(deal, a.summary.name, 'Updated and re-signed their application' + (added.length ? ' and added ' + added.length + ' document(s)' : ''));
    store.saveDeal(deal);
    notify.updatedApplication({ deal, appRecord: a, agent: deal.agentId && auth.get(deal.agentId), form, dashboardUrl: PUBLIC_URL + '/agent#deal/' + deal.id }).catch(alertFailed(deal, a.summary.name + ' updated their application'));
    checkStorage();
  }
  res.json({ ok: true, confirmation: a.id.slice(0, 8).toUpperCase(), statusUrl: PUBLIC_URL + '/status?t=' + a.uploadToken });
});

/* ------------------------------ agent API -------------------------------- */
app.get('/api/me', (req, res) => res.json({ agent: auth.publicAgent(auth.current(req)), needsSetup: auth.needsSetup(), temporaryStorage: store.temporaryStorage }));

app.post('/api/setup', rateLimit(5, 900e3), (req, res) => {
  if (!auth.needsSetup()) return res.status(403).json({ error: 'Setup has already been completed.' });
  try {
    const agent = auth.createAgent({ ...req.body, role: 'admin' });
    auth.issue(res, agent);
    res.json({ agent: auth.publicAgent(agent) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/login', rateLimit(10, 900e3), (req, res) => {
  const agent = auth.login(req.body.email, req.body.password);
  if (!agent) return res.status(401).json({ error: 'Email or password is incorrect.' });
  auth.issue(res, agent);
  res.json({ agent: auth.publicAgent(agent) });
});
app.post('/api/logout', (req, res) => { auth.logout(res); res.json({ ok: true }); });

app.use('/api/agents', auth.require);
app.get('/api/agents', (req, res) => res.json(auth.list()));
app.post('/api/agents', auth.requireAdmin, (req, res) => {
  try { res.json(auth.publicAgent(auth.createAgent(req.body))); } catch (e) { res.status(400).json({ error: e.message }); }
});
app.put('/api/agents/:id', (req, res) => {
  if (req.agent.role !== 'admin' && req.agent.id !== req.params.id) return res.status(403).json({ error: 'Not allowed.' });
  try { res.json(auth.publicAgent(auth.updateProfile(req.params.id, req.body))); } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/agents/:id/password', (req, res) => {
  if (req.agent.role !== 'admin' && req.agent.id !== req.params.id) return res.status(403).json({ error: 'Not allowed.' });
  try { auth.setPassword(req.params.id, req.body.password); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); }
});
app.delete('/api/agents/:id', auth.requireAdmin, (req, res) => {
  if (req.params.id === req.agent.id) return res.status(400).json({ error: 'You can\'t remove yourself.' });
  auth.remove(req.params.id);
  res.json({ ok: true });
});

app.use(['/api/deals', '/api/apps', '/api/files', '/api/email', '/api/alerts', '/api/health'], auth.require);

app.get('/api/health', async (req, res) => {
  res.json({ storage: await checkStorage(), failures: health.failures() });
});
app.post('/api/health/dismiss', (req, res) => {
  health.dismissFailures();
  res.json({ ok: true });
});

app.post('/api/alerts/test', rateLimit(10, 3600e3), async (req, res) => {
  if (!notify.alertsConfigured) return res.status(400).json({ error: 'No alert channel is set up (SMTP, RESEND_API_KEY or NTFY_TOPIC).' });
  try {
    await notify.testAlert(req.agent, PUBLIC_URL + '/agent');
    res.json({ ok: true });
  } catch (e) {
    console.error('[notify] test alert failed:', e.message);
    res.status(502).json({ error: 'The alert could not be sent: ' + e.message });
  }
});

// Agents email applicants straight from the dashboard. Mail goes out from the
// company mailbox; replies go to the agent who sent it.
app.post('/api/email', rateLimit(60, 3600e3), async (req, res) => {
  const { to, subject, text, dealId, attachGuarantor } = req.body || {};
  if (!notify.enabled) return res.status(400).json({ error: 'Email sending isn\'t set up yet.' });
  if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(String(to || '').trim())) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (!subject || !text) return res.status(400).json({ error: 'Subject and message are required.' });
  try {
    const attachments = attachGuarantor ? [{ filename: 'Guarantor Form.pdf', path: path.join(__dirname, 'public', 'forms', 'guarantor-form.pdf') }] : undefined;
    await notify.sendAs(req.agent, { to: String(to).trim(), subject: String(subject).slice(0, 200), text: String(text).slice(0, 10000), attachments });
  } catch (e) {
    console.error('[email]', e.message);
    return res.status(502).json({ error: 'The email couldn\'t be sent. Check the email settings and try again.' });
  }
  const deal = dealId && store.getDeal(dealId);
  if (deal) { log(deal, req.agent.name, 'Emailed ' + String(to).trim() + ': ' + String(subject).slice(0, 80)); store.saveDeal(deal); }
  res.json({ ok: true });
});

app.get('/api/deals', (req, res) => {
  res.json(store.listDeals().map(dealSummary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
});

app.post('/api/deals', (req, res) => {
  const form = FORMS[req.body.formType];
  if (!form) return res.status(400).json({ error: 'Choose an application type.' });
  const deal = newDeal(form.id, req.body.agentId || req.agent.id, req.body.sheet || {});
  log(deal, req.agent.name, 'Created applicant link');
  store.saveDeal(deal);
  res.json(dealSummary(deal));
});

app.get('/api/deals/:id', (req, res) => {
  const deal = store.getDeal(req.params.id);
  if (!deal) return res.status(404).json({ error: 'Not found.' });
  // Deals created before guarantor links existed get one now.
  if (!deal.guarantorToken && deal.formType !== 'guarantor') { deal.guarantorToken = store.id(12); store.saveDeal(deal); }
  const out = dealSummary(deal);
  out.activity = deal.activity || [];
  out.applicants = store.appsForDeal(deal).map((a) => ({
    ...appSummary(a), application: store.openAnswers(a), statusUrl: PUBLIC_URL + '/status?t=' + a.uploadToken,
    // Earlier signed versions, newest first.
    history: (a.history || []).map((h) => ({ submittedAt: h.submittedAt, replacedAt: h.replacedAt, note: h.note, application: store.openAnswers(h) })).reverse(),
  }));
  res.json(out);
});

app.put('/api/deals/:id', (req, res) => {
  const deal = store.getDeal(req.params.id);
  if (!deal) return res.status(404).json({ error: 'Not found.' });
  const { sheet, status, agentId } = req.body;
  if (sheet && typeof sheet === 'object') deal.sheet = sheet;
  if (status && STATUSES.includes(status) && status !== deal.status) { log(deal, req.agent.name, 'Status: ' + deal.status + ' → ' + status); deal.status = status; }
  if (agentId !== undefined && agentId !== deal.agentId) { deal.agentId = agentId || null; log(deal, req.agent.name, 'Assigned to ' + ((agentId && auth.get(agentId) || {}).name || 'nobody')); }
  if (sheet) log(deal, req.agent.name, 'Updated deal sheet');
  store.saveDeal(deal);
  res.json(dealSummary(deal));
});

// Internal agent notes on an application. Never included in anything sent to landlords.
app.post('/api/deals/:id/notes', (req, res) => {
  const deal = store.getDeal(req.params.id);
  if (!deal) return res.status(404).json({ error: 'Not found.' });
  const text = String((req.body && req.body.text) || '').trim();
  if (!text) return res.status(400).json({ error: 'Write a note first.' });
  deal.notes = deal.notes || [];
  deal.notes.unshift({ id: store.id(), at: new Date().toISOString(), byId: req.agent.id, by: req.agent.name, text: text.slice(0, 5000) });
  log(deal, req.agent.name, 'Added a note');
  store.saveDeal(deal);
  res.json(deal.notes);
});
app.delete('/api/deals/:id/notes/:noteId', (req, res) => {
  const deal = store.getDeal(req.params.id);
  const note = deal && (deal.notes || []).find((n) => n.id === req.params.noteId);
  if (!note) return res.status(404).json({ error: 'Not found.' });
  if (note.byId !== req.agent.id && req.agent.role !== 'admin') return res.status(403).json({ error: 'You can only delete your own notes.' });
  deal.notes = deal.notes.filter((n) => n !== note);
  log(deal, req.agent.name, 'Deleted a note');
  store.saveDeal(deal);
  res.json(deal.notes);
});

app.delete('/api/deals/:id', auth.requireAdmin, (req, res) => {
  store.deleteDeal(req.params.id);
  res.json({ ok: true });
});

app.put('/api/apps/:id/credit', (req, res) => {
  const a = store.getApp(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found.' });
  const status = String(req.body.status || '');
  if (!['Not requested', 'Requested', 'Received', 'Waived'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  a.credit = { ...a.credit, status, notes: req.body.notes != null ? String(req.body.notes) : a.credit.notes, score: req.body.score != null ? String(req.body.score) : a.credit.score, updatedAt: new Date().toISOString(), by: req.agent.name };
  if (status === 'Requested') a.credit.requestedAt = a.credit.updatedAt;
  store.saveApp(a);
  const deal = store.getDeal(a.dealId);
  if (deal) { log(deal, req.agent.name, 'Credit report for ' + a.summary.name + ': ' + status); store.saveDeal(deal); }
  res.json(appSummary(a));
});

// Send an application back to the applicant to finish or correct.
app.post('/api/apps/:id/reopen', (req, res) => {
  const a = store.getApp(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found.' });
  const note = String(req.body.note || '').trim().slice(0, 2000);
  a.reopened = { at: new Date().toISOString(), by: req.agent.name, note };
  store.saveApp(a);
  const deal = store.getDeal(a.dealId);
  if (deal) { log(deal, req.agent.name, 'Sent ' + a.summary.name + '\'s application back for changes' + (note ? ': ' + note : '')); store.saveDeal(deal); }
  res.json(appSummary(a));
});

app.delete('/api/apps/:id/reopen', (req, res) => {
  const a = store.getApp(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found.' });
  if (a.reopened) {
    a.reopened = null;
    store.saveApp(a);
    const deal = store.getDeal(a.dealId);
    if (deal) { log(deal, req.agent.name, 'Closed ' + a.summary.name + '\'s application to changes'); store.saveDeal(deal); }
  }
  res.json(appSummary(a));
});

// Result of the agent's eviction / court-records search (public/js/eviction.js).
const EVICTION_STATUSES = ['Not checked', 'No records found', 'Records found', 'Waived'];
app.put('/api/apps/:id/eviction', (req, res) => {
  const a = store.getApp(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found.' });
  const status = String(req.body.status || '');
  if (!EVICTION_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  const text = (v, max = 300) => String(v == null ? '' : v).slice(0, max);
  const cases = (Array.isArray(req.body.cases) ? req.body.cases : []).slice(0, 50).map((c) => ({
    person: text(c.person, 120), type: text(c.type, 60), outcome: text(c.outcome, 60), court: text(c.court, 120),
    caseNo: text(c.caseNo, 60), filed: /^\d{4}-\d{2}-\d{2}$/.test(c.filed || '') ? c.filed : '', notes: text(c.notes, 1000),
  }));
  a.eviction = { status, cases, notes: text(req.body.notes, 2000), checkedAt: new Date().toISOString(), by: req.agent.name };
  store.saveApp(a);
  const deal = store.getDeal(a.dealId);
  if (deal) { log(deal, req.agent.name, 'Eviction check for ' + a.summary.name + ': ' + status + (cases.length ? ' (' + cases.length + ' case' + (cases.length > 1 ? 's' : '') + ')' : '')); store.saveDeal(deal); }
  res.json(appSummary(a));
});

app.post('/api/apps/:id/files', upload.any(), (req, res) => {
  const a = store.getApp(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found.' });
  const added = attachFiles(a, req.files, 'agent');
  if (added.some((f) => f.docType === 'credit_report')) a.credit = { ...a.credit, status: 'Received', updatedAt: new Date().toISOString(), by: req.agent.name };
  store.saveApp(a);
  const deal = store.getDeal(a.dealId);
  if (deal) { log(deal, req.agent.name, 'Added ' + added.map((f) => f.name).join(', ') + ' to ' + a.summary.name); store.saveDeal(deal); }
  res.json(appSummary(a));
});

// The applicant's answers printed on the landlord's original paper form.
app.get('/api/apps/:id/original.pdf', async (req, res, next) => {
  const a = store.getApp(req.params.id);
  if (!a) return res.status(404).send('Not found');
  const deal = store.getDeal(a.dealId);
  try {
    const pdf = await fillOriginal({ formType: a.formType, app: a, application: store.openAnswers(a), sheet: deal ? deal.sheet : {}, agent: deal && deal.agentId && auth.get(deal.agentId) });
    const name = (FORMS[a.formType].short + ' application - ' + a.summary.name).replace(/[^\w .-]/g, '');
    res.set({ 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store', 'Content-Disposition': (req.query.download ? 'attachment' : 'inline') + '; filename="' + name + '.pdf"' });
    res.send(pdf);
  } catch (e) { next(e); }
});

// Landlord package: original form(s) followed by every uploaded document, as one PDF.
function docLabels(forms) {
  return Object.fromEntries(forms.flatMap((form) => form.documents.map((d) => [d.id, d.label])).concat([['other', 'Other document'], ['credit_report', 'Credit report'], ['eviction_check', 'Court records search']]));
}
async function sendPackage(res, req, deal, apps) {
  const form = FORMS[deal.formType];
  const pdf = await buildPackage({
    formType: deal.formType,
    sheet: deal.sheet,
    agent: deal.agentId && auth.get(deal.agentId),
    docLabels: docLabels([...new Set([deal.formType, ...apps.map((a) => a.formType)])].map((t) => FORMS[t])),
    applicants: apps.map((a) => ({ app: a, application: store.openAnswers(a), files: a.files.filter(inPackage).map((meta) => ({ meta, buffer: store.readFile(a.id, meta.id) })) })),
  });
  const who = apps.map((a) => a.summary.name).join(', ');
  const name = (form.short + ' application package - ' + who).replace(/[^\w ,.-]/g, '').slice(0, 150);
  res.set({ 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store', 'Content-Disposition': (req.query.download ? 'attachment' : 'inline') + '; filename="' + name + '.pdf"' });
  res.send(pdf);
}
// Tick or untick an upload for the merged PDF.
app.put('/api/apps/:id/files/:fileId', (req, res) => {
  const a = store.getApp(req.params.id);
  const meta = a && a.files.find((x) => x.id === req.params.fileId);
  if (!meta) return res.status(404).json({ error: 'Not found.' });
  if (typeof req.body.inPackage !== 'boolean') return res.status(400).json({ error: 'inPackage must be true or false.' });
  meta.inPackage = req.body.inPackage;
  store.saveApp(a);
  res.json({ ...meta, inPackage: inPackage(meta) });
});
app.get('/api/apps/:id/package.pdf', async (req, res, next) => {
  const a = store.getApp(req.params.id);
  const deal = a && store.getDeal(a.dealId);
  if (!deal) return res.status(404).send('Not found');
  try { await sendPackage(res, req, deal, [a]); } catch (e) { next(e); }
});
app.get('/api/deals/:id/package.pdf', async (req, res, next) => {
  const deal = store.getDeal(req.params.id);
  if (!deal) return res.status(404).send('Not found');
  const apps = store.appsForDeal(deal);
  if (!apps.length) return res.status(400).send('No applications yet.');
  try { await sendPackage(res, req, deal, apps); } catch (e) { next(e); }
});

app.get('/api/files/:appId/:fileId', async (req, res, next) => {
  if (req.query.as !== 'pdf') return next();
  const a = store.getApp(req.params.appId);
  const meta = a && a.files.find((x) => x.id === req.params.fileId);
  if (!meta) return res.status(404).send('Not found');
  try {
    const pdf = await fileAsPdf(meta, store.readFile(a.id, meta.id));
    res.set({ 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store', 'Content-Disposition': 'inline; filename="' + meta.name.replace(/\.[^.]+$/, '').replace(/["\\\r\n]/g, '_') + '.pdf"' });
    res.send(pdf);
  } catch (e) { next(e); }
});

app.get('/api/files/:appId/:fileId', (req, res) => {
  const a = store.getApp(req.params.appId);
  const meta = a && a.files.find((x) => x.id === req.params.fileId);
  if (!meta) return res.status(404).send('Not found');
  res.set('Content-Type', meta.mime);
  res.set('Cache-Control', 'private, no-store');
  res.set('Content-Disposition', (req.query.download ? 'attachment' : 'inline') + '; filename="' + meta.name.replace(/["\\\r\n]/g, '_') + '"');
  res.send(store.readFile(a.id, meta.id));
});

app.delete('/api/files/:appId/:fileId', (req, res) => {
  const a = store.getApp(req.params.appId);
  const meta = a && a.files.find((x) => x.id === req.params.fileId);
  if (!meta) return res.status(404).json({ error: 'Not found.' });
  store.deleteFile(a.id, meta.id);
  a.files = a.files.filter((x) => x.id !== meta.id);
  store.saveApp(a);
  const deal = store.getDeal(a.dealId);
  if (deal) { log(deal, req.agent.name, 'Removed ' + meta.name); store.saveDeal(deal); }
  res.json({ ok: true });
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || /Unsupported file type/.test(err.message)) {
    return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Each file must be 20 MB or smaller.' : err.message });
  }
  console.error(err);
  if (err.code === 'ENOSPC') {
    health.recordFailure({ what: 'A submission or upload could not be saved because storage is full (' + req.method + ' ' + req.path + ')', error: err.message });
    notify.storageWarning({ ...(health.storage()), level: 2 }, PUBLIC_URL + '/agent').catch(() => {});
  }
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

app.listen(PORT, () => {
  console.log('Dibiasio Realty applications running at ' + PUBLIC_URL);
  checkStorage();
  setInterval(checkStorage, 60 * 60 * 1000).unref();
});
