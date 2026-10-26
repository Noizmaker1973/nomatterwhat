// Failed-alert tracking and storage warnings.
const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('an alert that fails to send shows up in /api/health until dismissed', async () => {
  // Stand-in for Resend that rejects every message.
  const fake = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.statusCode = 422; res.end('{"message":"rejected"}'); }); }).listen(0);
  const port = 6400 + Math.floor(Math.random() * 100);
  const base = 'http://127.0.0.1:' + port;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-health-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, STORAGE_WARN_PCT: '101', STORAGE_CRITICAL_PCT: '101', PORT: String(port), DATA_DIR: dir, DATA_KEY: 'c3'.repeat(32), PERSISTENT_DISK: '', SMTP_URL: '', SMTP_HOST: '', NTFY_TOPIC: '', PUBLIC_URL: base,
      RESEND_API_KEY: 're_test', RESEND_API_URL: 'http://127.0.0.1:' + fake.address().port + '/emails', NOTIFY_EMAIL: 'james@dibiasiorealty.com',
      ADMIN_NAME: 'James Guilford', ADMIN_EMAIL: 'james@dibiasiorealty.com', ADMIN_PASSWORD: 'long enough password' },
    stdio: 'pipe',
  });
  try {
    await new Promise((resolve) => child.stdout.on('data', (d) => /running at/.test(d) && resolve()));
    const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'james@dibiasiorealty.com', password: 'long enough password' }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const deal = await (await fetch(base + '/api/deals', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ formType: 'standard', sheet: { address: '45 Moody Street' } }) })).json();
    const fd = new FormData();
    fd.append('payload', JSON.stringify({
      dealToken: deal.token,
      answers: { name: 'Riley Renter', phone: '(508) 555-0101', email: 'riley@example.com', over18: 'Yes', curStreet: '2 Oak', curCity: 'Marlboro', curState: 'MA', curZip: '01752', curFrom: '2020-05-01',
        presLandlord: 'L', presLandlordPhone: '(508) 555-0102', employer: 'Acme', occupation: 'Engineer', salary: '90000', salaryPer: 'per year',
        refName: 'R', refPhone: '(508) 555-0103', emergencyName: 'E', emergencyPhone: '(508) 555-0104', occupants: '1', adults: '1', pets: '0', felony: 'No' },
      signature: { typedName: 'Riley Renter', image: 'data:image/png;base64,iVBORw0KGgo=' },
      consents: { terms: true, credit: true, esign: true },
    }));
    assert.equal((await fetch(base + '/api/public/applications', { method: 'POST', body: fd })).status, 200, 'the application itself is still saved');

    let h;
    for (let i = 0; i < 50; i++) {
      h = await (await fetch(base + '/api/health', { headers: { cookie } })).json();
      if (h.failures.length) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(h.failures.length, 1);
    assert.match(h.failures[0].what, /New application from Riley Renter/);
    assert.equal(h.failures[0].dealId, deal.id);
    assert.equal(typeof h.storage.pct, 'number');
    const full = await (await fetch(base + '/api/deals/' + deal.id, { headers: { cookie } })).json();
    assert.ok(full.activity.some((a) => /Alert failed to send/.test(a.text)), 'failure is noted on the deal');

    await fetch(base + '/api/health/dismiss', { method: 'POST', headers: { cookie } });
    assert.equal((await (await fetch(base + '/api/health', { headers: { cookie } })).json()).failures.length, 0);
    assert.equal((await fetch(base + '/api/health')).status, 401);
  } finally {
    child.kill();
    fake.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('storage warning fires once when crossing 80% and again at 95%', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-disk-'));
  process.env.DATA_DIR = dir;
  process.env.DATA_KEY = 'd4'.repeat(32);
  process.env.PERSISTENT_DISK = '';
  const realStatfs = fs.statfsSync;
  let usedPct = 50;
  fs.statfsSync = () => ({ blocks: 1000, bsize: 1048576, bavail: Math.round(1000 * (1 - usedPct / 100)) });
  try {
    const health = require('../lib/health');
    const warnings = [];
    const onRise = async (st) => { warnings.push(st.level); };
    await health.checkStorage(onRise);
    usedPct = 82; await health.checkStorage(onRise); await health.checkStorage(onRise);
    usedPct = 96; await health.checkStorage(onRise);
    assert.deepEqual(warnings, [1, 2], 'one warning per level, not on every check');
    usedPct = 40; await health.checkStorage(onRise);
    usedPct = 85; await health.checkStorage(onRise);
    assert.deepEqual(warnings, [1, 2, 1], 'warns again after space was freed and it fills up again');
  } finally {
    fs.statfsSync = realStatfs;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
