// New-application alerts through ntfy (phone push + forwarded email), checked
// against a local stand-in for the ntfy server.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 6000 + Math.floor(Math.random() * 100);
const NTFY_PORT = 6200 + Math.floor(Math.random() * 100);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-alert-'));
const received = [];
let ntfy, server, cookie = '';
const base = 'http://127.0.0.1:' + PORT;

before(async () => {
  ntfy = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => { received.push({ path: req.url, headers: req.headers, body }); res.end('{}'); });
  }).listen(NTFY_PORT);
  server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, DATA_KEY: 'a1'.repeat(32), PERSISTENT_DISK: '', SMTP_URL: '', SMTP_HOST: '', PUBLIC_URL: base,
      NTFY_SERVER: 'http://127.0.0.1:' + NTFY_PORT, NTFY_TOPIC: 'secret-topic', NOTIFY_EMAIL: '',
      ADMIN_NAME: 'James Guilford', ADMIN_EMAIL: 'james@dibiasiorealty.com', ADMIN_PASSWORD: 'long enough password' },
    stdio: 'pipe',
  });
  await new Promise((resolve) => server.stdout.on('data', (d) => /running at/.test(d) && resolve()));
  const res = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'james@dibiasiorealty.com', password: 'long enough password' }) });
  cookie = res.headers.get('set-cookie').split(';')[0];
});
after(() => { server.kill(); ntfy.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

test('a completed application pushes an alert and emails the assigned agent, without applicant details', async () => {
  const deal = await (await fetch(base + '/api/deals', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ formType: 'standard', sheet: { address: '45 Moody Street', unit: '3B' } }) })).json();
  const fd = new FormData();
  fd.append('payload', JSON.stringify({
    dealToken: deal.token,
    answers: { name: 'Riley Renter', phone: '(508) 555-0101', email: 'riley@example.com', over18: 'Yes', curStreet: '2 Oak', curCity: 'Marlboro', curState: 'MA', curZip: '01752', curFrom: '2020-05-01',
      presLandlord: 'L', presLandlordPhone: '(508) 555-0102', employer: 'Acme', occupation: 'Engineer', salary: '90000', salaryPer: 'per year',
      refName: 'R', refPhone: '(508) 555-0103', emergencyName: 'E', emergencyPhone: '(508) 555-0104', occupants: '1', adults: '1', pets: '0', felony: 'No' },
    signature: { typedName: 'Riley Renter', image: 'data:image/png;base64,iVBORw0KGgo=' },
    consents: { terms: true, credit: true, esign: true },
  }));
  const res = await fetch(base + '/api/public/applications', { method: 'POST', body: fd });
  assert.equal(res.status, 200, await res.text());
  for (let i = 0; i < 50 && !received.length; i++) await new Promise((r) => setTimeout(r, 20));

  assert.equal(received.length, 1);
  const [msg] = received;
  assert.equal(msg.path, '/secret-topic');
  assert.equal(msg.headers.title, 'New Standard application');
  assert.equal(msg.headers.email, 'james@dibiasiorealty.com');
  assert.equal(msg.headers.click, base + '/agent#deal/' + deal.id);
  assert.match(msg.body, /45 Moody Street, Unit 3B/);
  assert.ok(!/Riley|riley@example\.com/.test(JSON.stringify(msg)), 'no applicant details leave via ntfy');
});

test('the Team page test alert reaches ntfy', async () => {
  received.length = 0;
  const res = await fetch(base + '/api/alerts/test', { method: 'POST', headers: { cookie } });
  assert.equal(res.status, 200, await res.text());
  assert.equal(received.length, 1);
  assert.equal(received[0].headers.title, 'Test alert');
  assert.equal(received[0].headers.email, 'james@dibiasiorealty.com');
});

test('with a Resend key, alerts are emailed through the Resend API', async () => {
  const resendHits = [];
  const fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => { resendHits.push({ headers: req.headers, body: JSON.parse(body) }); res.end('{"id":"x"}'); });
  }).listen(0);
  const port = PORT + 1;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-resend-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), DATA_DIR: dir, DATA_KEY: 'b2'.repeat(32), PERSISTENT_DISK: '', SMTP_URL: '', SMTP_HOST: '', NTFY_TOPIC: '',
      RESEND_API_KEY: 're_test', RESEND_API_URL: 'http://127.0.0.1:' + fake.address().port + '/emails', NOTIFY_EMAIL: 'james@dibiasiorealty.com',
      ADMIN_NAME: 'James Guilford', ADMIN_EMAIL: 'james@dibiasiorealty.com', ADMIN_PASSWORD: 'long enough password' },
    stdio: 'pipe',
  });
  try {
    await new Promise((resolve) => child.stdout.on('data', (d) => /running at/.test(d) && resolve()));
    const login = await fetch('http://127.0.0.1:' + port + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'james@dibiasiorealty.com', password: 'long enough password' }) });
    const res = await fetch('http://127.0.0.1:' + port + '/api/alerts/test', { method: 'POST', headers: { cookie: login.headers.get('set-cookie').split(';')[0] } });
    assert.equal(res.status, 200, await res.text());
    assert.equal(resendHits.length, 1);
    assert.equal(resendHits[0].headers.authorization, 'Bearer re_test');
    assert.deepEqual(resendHits[0].body.to, ['james@dibiasiorealty.com']);
    assert.match(resendHits[0].body.subject, /Test alert/);
  } finally {
    child.kill();
    fake.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
