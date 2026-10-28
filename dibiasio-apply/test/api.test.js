// End-to-end API tests: boots the server against a temp data dir and walks the
// agent + applicant flows. Run with `npm test`.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 5600 + Math.floor(Math.random() * 300);
const BASE = 'http://127.0.0.1:' + PORT;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-test-'));
let server;
let cookie = '';

async function call(p, opts = {}) {
  const res = await fetch(BASE + p, {
    method: opts.method || 'GET',
    headers: { ...(opts.json ? { 'Content-Type': 'application/json' } : {}), ...(opts.auth === false ? {} : { cookie }) },
    body: opts.json ? JSON.stringify(opts.json) : opts.body,
  });
  const set = res.headers.get('set-cookie');
  if (set && opts.keepCookie) cookie = set.split(';')[0];
  const type = res.headers.get('content-type') || '';
  return { status: res.status, body: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
}

function application(extra = {}) {
  return {
    form: 'hamilton',
    answers: {
      name: 'Jamie Tenant', phone: '(617) 555-0100', email: 'jamie@example.com', dob: '1995-04-02', ssn: '123-45-6789',
      curStreet: '1 Main St', curCity: 'Boston', curState: 'MA', curZip: '02134', curFrom: '2022-01-01',
      curLandlord: 'Pat Owner', curLandlordPhone: '(617) 555-0111', applicantType: 'Employed', monthlySalary: '7000',
      aptAddress: '9 Elm St, Unit 2', occupants: '1', pets: '0', childrenUnder7: 'No', emergencyName: 'Sam', emergencyPhone: '(617) 555-0122',
    },
    signature: { typedName: 'Jamie Tenant', image: 'data:image/png;base64,iVBORw0KGgo=' },
    consents: { terms: true, credit: true, esign: true },
    ...extra,
  };
}

before(async () => {
  server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, STORAGE_WARN_PCT: '101', STORAGE_CRITICAL_PCT: '101', PORT: String(PORT), DATA_DIR: dataDir, PUBLIC_URL: BASE, DATA_KEY: 'a'.repeat(64), ADMIN_EMAIL: '', SMTP_URL: '', CREDIT_SCREENING_URL: 'https://screening.example.com/apply' },
    stdio: 'pipe',
  });
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (d) => /running at/.test(d) && resolve());
    server.stderr.on('data', (d) => process.stderr.write(d));
    server.on('exit', (code) => reject(new Error('server exited ' + code)));
  });
});
after(() => { server.kill(); fs.rmSync(dataDir, { recursive: true, force: true }); });

test('first visit requires setup, then admin can sign in', async () => {
  assert.equal((await call('/api/me')).body.needsSetup, true);
  const weak = await call('/api/setup', { method: 'POST', json: { name: 'James', email: 'james@dibiasiorealty.com', password: 'short' } });
  assert.equal(weak.status, 400);
  const ok = await call('/api/setup', { method: 'POST', json: { name: 'James', email: 'james@dibiasiorealty.com', password: 'correct horse battery' }, keepCookie: true });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.agent.role, 'admin');
  assert.equal((await call('/api/setup', { method: 'POST', json: { name: 'X', email: 'x@x.com', password: 'another long one' } })).status, 403);
});

test('agent endpoints reject anonymous requests', async () => {
  assert.equal((await call('/api/deals', { auth: false })).status, 401);
  assert.equal((await call('/api/files/x/y', { auth: false })).status, 401);
});

test('full flow: link → application with documents → agent review', async () => {
  const deal = (await call('/api/deals', { method: 'POST', json: { formType: 'hamilton', sheet: { address: '9 Elm St', unit: '2', city: 'Allston', rent: '2500', moveIn: '2026-12-01' } } })).body;
  assert.ok(deal.link.includes('/apply?d='));

  const pub = (await call('/api/public/deal/' + deal.token, { auth: false })).body;
  assert.equal(pub.formType, 'hamilton');
  assert.equal(pub.prefill.addressUnit, '9 Elm St, Unit 2, Allston');
  assert.equal(pub.agent.name, 'James');

  // Missing required answers are rejected with a list.
  const bad = new FormData();
  bad.append('payload', JSON.stringify({ ...application({ dealToken: deal.token }), answers: { name: 'Only a name' } }));
  const rejected = await call('/api/public/applications', { method: 'POST', body: bad, auth: false });
  assert.equal(rejected.status, 400);
  assert.ok(rejected.body.missing.includes('Phone'));

  const fd = new FormData();
  fd.append('payload', JSON.stringify(application({ dealToken: deal.token })));
  fd.append('doc_photo_id', new Blob([Buffer.from('%PDF-1.4 id')], { type: 'application/pdf' }), 'license.pdf');
  fd.append('doc_pay_stubs', new Blob([Buffer.from('stub')], { type: 'image/png' }), 'stub.png');
  const sub = await call('/api/public/applications', { method: 'POST', body: fd, auth: false });
  assert.equal(sub.status, 200, JSON.stringify(sub.body));
  assert.equal(sub.body.creditScreeningUrl, 'https://screening.example.com/apply');

  // Sensitive data is encrypted on disk.
  const raw = fs.readdirSync(path.join(dataDir, 'apps')).map((f) => fs.readFileSync(path.join(dataDir, 'apps', f), 'utf8')).join('');
  assert.ok(!raw.includes('123-45-6789'));
  const fileDir = fs.readdirSync(path.join(dataDir, 'files'))[0];
  const stored = fs.readdirSync(path.join(dataDir, 'files', fileDir)).map((f) => fs.readFileSync(path.join(dataDir, 'files', fileDir, f)).toString());
  assert.ok(!stored.some((s) => s.includes('%PDF')));

  const full = (await call('/api/deals/' + deal.id)).body;
  assert.equal(full.applicants.length, 1);
  const a = full.applicants[0];
  assert.equal(a.application.answers.ssn, '123-45-6789');
  assert.equal(a.application.answers.aptAddress, '9 Elm St, Unit 2, Allston', 'prefilled fields come from the deal');
  assert.equal(a.monthlyIncome, 7000);
  assert.equal(a.files.length, 2);

  const file = await call('/api/files/' + a.id + '/' + a.files.find((f) => f.docType === 'photo_id').id);
  assert.equal(file.body.toString(), '%PDF-1.4 id');

  // Applicant adds a document later via their private link.
  const token = new URL(sub.body.statusUrl).searchParams.get('t');
  const more = new FormData();
  more.append('doc_student_verification', new Blob(['sched'], { type: 'application/pdf' }), 'schedule.pdf');
  assert.equal((await call('/api/public/status/' + token + '/files', { method: 'POST', body: more, auth: false })).status, 200);
  const status = (await call('/api/public/status/' + token, { auth: false })).body;
  assert.equal(status.files.length, 3);
  assert.ok(!JSON.stringify(status).includes('123-45-6789'), 'status page never exposes answers');
  assert.equal(status.agent.email, 'james@dibiasiorealty.com', 'status page knows the agent for the guarantor message');

  // Agents choose which uploads go into the merged PDF.
  const stubs = a.files.find((f) => f.docType === 'pay_stubs');
  assert.equal(stubs.inPackage, true, 'uploads are included by default');
  const before = (await call('/api/apps/' + a.id + '/package.pdf')).body;
  const toggled = await call('/api/apps/' + a.id + '/files/' + stubs.id, { method: 'PUT', json: { inPackage: false } });
  assert.equal(toggled.body.inPackage, false);
  const { PDFDocument: PD } = require('pdf-lib');
  const after = (await call('/api/apps/' + a.id + '/package.pdf')).body;
  assert.equal((await PD.load(after)).getPageCount(), (await PD.load(before)).getPageCount() - 1, 'unticked pay stub is left out');
  assert.equal((await call('/api/apps/' + a.id + '/files/' + stubs.id, { method: 'PUT', json: { inPackage: 'no' } })).status, 400);
  assert.equal((await call('/api/apps/' + a.id + '/files/' + stubs.id, { method: 'PUT', json: { inPackage: true }, auth: false })).status, 401);
  await call('/api/apps/' + a.id + '/files/' + stubs.id, { method: 'PUT', json: { inPackage: true } });

  // The answers printed on the landlord's original form.
  const original = await call('/api/apps/' + a.id + '/original.pdf');
  assert.equal(original.status, 200);
  assert.equal(original.body.subarray(0, 5).toString(), '%PDF-');
  const { PDFDocument } = require('pdf-lib');
  assert.equal((await PDFDocument.load(original.body)).getPageCount(), 3, 'Hamilton form has 3 pages');
  assert.equal((await call('/api/apps/' + a.id + '/original.pdf', { auth: false })).status, 401);

  // Agent: deal sheet, status, credit.
  await call('/api/deals/' + deal.id, { method: 'PUT', json: { sheet: { ...full.sheet, brokerFee: '2500', feePaidBy: 'Landlord' }, status: 'Sent to landlord' } });
  const credit = new FormData();
  credit.append('doc_credit_report', new Blob(['report'], { type: 'application/pdf' }), 'credit.pdf');
  const afterCredit = (await call('/api/apps/' + a.id + '/files', { method: 'POST', body: credit })).body;
  assert.equal(afterCredit.credit.status, 'Received');

  const list = (await call('/api/deals')).body;
  assert.equal(list[0].status, 'Sent to landlord');
  assert.equal(list[0].sheet.brokerFee, '2500');
});

test('generic link without a deal creates its own deal', async () => {
  const fd = new FormData();
  fd.append('payload', JSON.stringify(application({ form: 'standard', answers: {
    name: 'Riley Renter', phone: '(508) 555-0101', email: 'riley@example.com', over18: 'Yes', curStreet: '2 Oak', curCity: 'Marlboro', curState: 'MA', curZip: '01752', curFrom: '2020-05-01',
    presLandlord: 'L', presLandlordPhone: '(508) 555-0102', employer: 'Acme', occupation: 'Engineer', salary: '90000', salaryPer: 'per year',
    refName: 'R', refPhone: '(508) 555-0103', emergencyName: 'E', emergencyPhone: '(508) 555-0104', aptAddress: '5 Pine St', occupants: '1', adults: '1', pets: '0', felony: 'No',
  } })));
  const res = await call('/api/public/applications', { method: 'POST', body: fd, auth: false });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const deals = (await call('/api/deals')).body;
  const created = deals.find((d) => d.applicants.some((a) => a.name === 'Riley Renter'));
  assert.equal(created.formType, 'standard');
  assert.equal(created.agentName, 'Unassigned');
  assert.equal(created.applicants[0].monthlyIncome, 7500);
});

test('rejects unsupported file types', async () => {
  const fd = new FormData();
  fd.append('payload', JSON.stringify(application()));
  fd.append('doc_photo_id', new Blob(['MZ'], { type: 'application/x-msdownload' }), 'evil.exe');
  const res = await call('/api/public/applications', { method: 'POST', body: fd, auth: false });
  assert.equal(res.status, 400);
});

test('agents can update their profile; email requires SMTP', async () => {
  const me = (await call('/api/me')).body.agent;
  const updated = await call('/api/agents/' + me.id, { method: 'PUT', json: { name: 'James Guilford', phone: '617-555-0000' } });
  assert.equal(updated.body.name, 'James Guilford');
  assert.equal((await call('/api/agents/' + me.id, { method: 'PUT', json: { name: '  ' } })).status, 400);
  assert.equal((await call('/api/public/config', { auth: false })).body.emailEnabled, false);
  const res = await call('/api/email', { method: 'POST', json: { to: 'a@example.com', subject: 'Hi', text: 'Hello' } });
  assert.equal(res.status, 400);
  assert.equal((await call('/api/email', { method: 'POST', json: { to: 'a@example.com', subject: 'Hi', text: 'x' }, auth: false })).status, 401);
});

test('agents can add and delete notes on an application; others cannot delete them', async () => {
  const deal = (await call('/api/deals', { method: 'POST', json: { formType: 'standard', sheet: { address: '7 Note St' } } })).body;
  assert.equal((await call('/api/deals/' + deal.id + '/notes', { method: 'POST', json: { text: '  ' } })).status, 400);
  const notes = (await call('/api/deals/' + deal.id + '/notes', { method: 'POST', json: { text: 'Called landlord, waiting on reference' } })).body;
  assert.equal(notes.length, 1);
  assert.match(notes[0].by, /^James/);
  const listed = (await call('/api/deals')).body.find((d) => d.id === deal.id);
  assert.equal(listed.notes[0].text, 'Called landlord, waiting on reference');
  assert.equal((await call('/api/deals/' + deal.id + '/notes', { method: 'POST', json: { text: 'x' }, auth: false })).status, 401);

  // A regular agent can't delete someone else's note; the admin who wrote it can.
  const adminCookie = cookie;
  await call('/api/agents', { method: 'POST', json: { name: 'Aaron', email: 'aaron@dibiasiorealty.com', password: 'another long password', role: 'agent' } });
  await call('/api/login', { method: 'POST', json: { email: 'aaron@dibiasiorealty.com', password: 'another long password' }, keepCookie: true });
  assert.equal((await call('/api/deals/' + deal.id + '/notes/' + notes[0].id, { method: 'DELETE' })).status, 403);
  cookie = adminCookie;
  assert.deepEqual((await call('/api/deals/' + deal.id + '/notes/' + notes[0].id, { method: 'DELETE' })).body, []);
});

test('Portuguese links: language is stored on the deal and the application', async () => {
  const deal = (await call('/api/deals', { method: 'POST', json: { formType: 'beantown', lang: 'pt', sheet: { address: '5 Oak St', city: 'Waltham' } } })).body;
  assert.equal(deal.lang, 'pt');
  assert.equal((await call('/api/public/deal/' + deal.token, { auth: false })).body.lang, 'pt');
  // Forms without a translation stay in English.
  assert.equal((await call('/api/deals', { method: 'POST', json: { formType: 'hamilton', lang: 'pt' } })).body.lang, 'en');

  const fd = new FormData();
  fd.append('payload', JSON.stringify({
    dealToken: deal.token, lang: 'pt',
    answers: {
      name: 'João Conceição', phone: '(617) 555-0100', email: 'joao@example.com', curStreet: '12 Rua Sete', curCity: 'Framingham', curState: 'MA', curZip: '01702',
      preferredSize: 'Two bedroom', mobileVoucher: 'No', members: [{ fullName: 'João Conceição', dob: '1990-01-01', ssn: '123-45-6789' }],
      felony: 'No', evicted: 'No', hasPet: 'No',
    },
    signature: { typedName: 'João Conceição', image: 'data:image/png;base64,iVBORw0KGgo=' },
    consents: { terms: true, credit: true, esign: true },
  }));
  const sub = await call('/api/public/applications', { method: 'POST', body: fd, auth: false });
  assert.equal(sub.status, 200, JSON.stringify(sub.body));
  assert.ok(!sub.body.coApplicantUrl.includes('lang='), 'roommates inherit the deal language');

  const full = (await call('/api/deals/' + deal.id)).body;
  assert.equal(full.applicants[0].lang, 'pt');
  assert.equal(full.applicants[0].application.consents.lang, 'pt', 'records which certification text was signed');
  assert.ok(full.activity.some((x) => /in Portuguese/.test(x.text)));
  const token = new URL(sub.body.statusUrl).searchParams.get('t');
  assert.equal((await call('/api/public/status/' + token, { auth: false })).body.lang, 'pt');

  const pdf = await call('/api/apps/' + full.applicants[0].id + '/original.pdf');
  assert.equal(pdf.status, 200);
  assert.equal(pdf.body.subarray(0, 4).toString(), '%PDF');

  // Agents can switch the link's language later; unknown languages are ignored.
  assert.equal((await call('/api/deals/' + deal.id, { method: 'PUT', json: { lang: 'en' } })).body.lang, 'en');
  assert.equal((await call('/api/deals/' + deal.id, { method: 'PUT', json: { lang: 'xx' } })).body.lang, 'en');
});
