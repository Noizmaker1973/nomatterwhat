// Sends a dashboard email through a minimal local SMTP server and checks the
// envelope: company From address, agent's name, Reply-To the agent.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 5900 + Math.floor(Math.random() * 100);
const SMTP_PORT = 2600 + Math.floor(Math.random() * 100);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-mail-'));
const messages = [];
let smtp, server, cookie = '';

before(async () => {
  smtp = net.createServer((sock) => {
    let data = false, buf = '';
    sock.write('220 test\r\n');
    sock.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (data) {
          if (line === '.') { data = false; sock.write('250 ok\r\n'); } else messages[messages.length - 1] += line + '\n';
        } else if (/^EHLO/i.test(line)) sock.write('250-test\r\n250 AUTH PLAIN LOGIN\r\n');
        else if (/^AUTH/i.test(line)) sock.write('235 ok\r\n');
        else if (/^DATA/i.test(line)) { data = true; messages.push(''); sock.write('354 go\r\n'); }
        else if (/^QUIT/i.test(line)) { sock.write('221 bye\r\n'); sock.end(); }
        else sock.write('250 ok\r\n');
      }
    });
  }).listen(SMTP_PORT);
  server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, STORAGE_WARN_PCT: '101', STORAGE_CRITICAL_PCT: '101', PORT: String(PORT), DATA_DIR: dataDir, DATA_KEY: 'd'.repeat(64), PERSISTENT_DISK: '', SMTP_URL: '',
      SMTP_HOST: '127.0.0.1', SMTP_PORT: String(SMTP_PORT), SMTP_USER: 'james@dibiasiorealty.com', SMTP_PASS: 'x', MAIL_FROM_ADDRESS: 'james@dibiasiorealty.com',
      ADMIN_NAME: 'James Guilford', ADMIN_EMAIL: 'james@dibiasiorealty.com', ADMIN_PASSWORD: 'long enough password' },
    stdio: 'pipe',
  });
  await new Promise((resolve) => server.stdout.on('data', (d) => /running at/.test(d) && resolve()));
  const res = await fetch('http://127.0.0.1:' + PORT + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'james@dibiasiorealty.com', password: 'long enough password' }) });
  cookie = res.headers.get('set-cookie').split(';')[0];
});
after(() => { server.kill(); smtp.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

test('dashboard email goes out from the company mailbox with the agent as reply-to', async () => {
  const cfg = await (await fetch('http://127.0.0.1:' + PORT + '/api/public/config')).json();
  assert.equal(cfg.emailEnabled, true);
  const res = await fetch('http://127.0.0.1:' + PORT + '/api/email', {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ to: 'renter@example.com', subject: 'Your rental application', text: 'Here is your link' }),
  });
  assert.equal(res.status, 200, await res.text());
  const msg = messages.join('\n');
  assert.match(msg, /From: "?James Guilford \| Dibiasio Realty"? <james@dibiasiorealty\.com>/);
  assert.match(msg, /Reply-To: james@dibiasiorealty\.com/);
  assert.match(msg, /To: renter@example\.com/);
  assert.match(msg, /Here is your link/);
});
