// File-backed storage with AES-256-GCM encryption at rest for applicant answers
// and uploaded documents. Small brokerages generate a few hundred applications a
// year, so everything is kept in memory and written through to JSON files.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// PERSISTENT_DISK names a mounted disk (e.g. Render's /var/data). Until it is
// mounted we fall back to a local folder, which hosts like Render wipe on every
// deploy, and flag storage as temporary so agents see a warning.
const LOCAL_DIR = path.join(__dirname, '..', 'data');
const DISK = process.env.PERSISTENT_DISK;
const diskMissing = Boolean(DISK) && !fs.existsSync(DISK);
if (diskMissing) console.warn('[store] Persistent disk %s is not mounted; using temporary storage at %s.', DISK, LOCAL_DIR);
const DATA_DIR = path.resolve(DISK && !diskMissing ? DISK : process.env.DATA_DIR || LOCAL_DIR);
const dirs = {
  deals: path.join(DATA_DIR, 'deals'),
  apps: path.join(DATA_DIR, 'apps'),
  files: path.join(DATA_DIR, 'files'),
};
Object.values(dirs).forEach((d) => fs.mkdirSync(d, { recursive: true }));

function loadKey() {
  const env = process.env.DATA_KEY;
  if (env) {
    const key = Buffer.from(env, /^[0-9a-f]{64}$/i.test(env) ? 'hex' : 'base64');
    if (key.length !== 32) throw new Error('DATA_KEY must be 32 bytes (64 hex characters).');
    return key;
  }
  const keyFile = path.join(DATA_DIR, '.datakey');
  if (!fs.existsSync(keyFile)) {
    fs.writeFileSync(keyFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
    console.warn('[store] No DATA_KEY set; generated %s. Set DATA_KEY in production and back it up — without it the data cannot be decrypted.', keyFile);
  }
  return Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'hex');
}
const KEY = loadKey();

function encrypt(buf) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([cipher.update(buf), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}
function decrypt(buf) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]);
}

const id = (bytes = 9) => crypto.randomBytes(bytes).toString('base64url');
const secret = (key) => crypto.createHmac('sha256', KEY).update(key).digest();

function writeJson(file, obj) {
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}
function readAll(dir) {
  const map = new Map();
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const obj = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    map.set(obj.id, obj);
  }
  return map;
}

const deals = readAll(dirs.deals);
const apps = readAll(dirs.apps);

const store = {
  DATA_DIR,
  temporaryStorage: diskMissing,
  id,
  secret,

  listDeals: () => [...deals.values()],
  getDeal: (dealId) => deals.get(dealId),
  findDealByToken: (token) => [...deals.values()].find((d) => d.token === token),
  findDealByGuarantorToken: (token) => [...deals.values()].find((d) => d.guarantorToken === token),
  saveDeal(deal) {
    deal.updatedAt = new Date().toISOString();
    deals.set(deal.id, deal);
    writeJson(path.join(dirs.deals, deal.id + '.json'), deal);
    return deal;
  },
  deleteDeal(dealId) {
    const deal = deals.get(dealId);
    if (!deal) return;
    for (const appId of deal.appIds) store.deleteApp(appId);
    deals.delete(dealId);
    fs.rmSync(path.join(dirs.deals, dealId + '.json'), { force: true });
  },

  getApp: (appId) => apps.get(appId),
  findAppByToken: (token) => [...apps.values()].find((a) => a.uploadToken === token),
  appsForDeal: (deal) => deal.appIds.map((a) => apps.get(a)).filter(Boolean),
  saveApp(app) {
    app.updatedAt = new Date().toISOString();
    apps.set(app.id, app);
    writeJson(path.join(dirs.apps, app.id + '.json'), app);
    return app;
  },
  deleteApp(appId) {
    apps.delete(appId);
    fs.rmSync(path.join(dirs.apps, appId + '.json'), { force: true });
    fs.rmSync(path.join(dirs.files, appId), { recursive: true, force: true });
  },

  // Applicant answers (SSN, DOB, signatures, ...) are only ever stored encrypted.
  sealAnswers: (answers) => encrypt(Buffer.from(JSON.stringify(answers))).toString('base64'),
  openAnswers: (app) => JSON.parse(decrypt(Buffer.from(app.answers, 'base64')).toString('utf8')),

  saveFile(appId, file) {
    const dir = path.join(dirs.files, appId);
    fs.mkdirSync(dir, { recursive: true });
    const fileId = id(12);
    fs.writeFileSync(path.join(dir, fileId + '.bin'), encrypt(file.buffer), { mode: 0o600 });
    return fileId;
  },
  readFile: (appId, fileId) => decrypt(fs.readFileSync(path.join(dirs.files, appId, fileId + '.bin'))),
  deleteFile: (appId, fileId) => fs.rmSync(path.join(dirs.files, appId, fileId + '.bin'), { force: true }),
};

module.exports = store;
