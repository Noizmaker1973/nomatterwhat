// Agent accounts and sessions. Passwords are scrypt-hashed; sessions are
// stateless HMAC-signed cookies so restarts don't log everyone out.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');

const AGENTS_FILE = path.join(store.DATA_DIR, 'agents.json');
const SESSION_HOURS = 12;
const COOKIE = 'dr_session';
const sessionKey = store.secret('agent-session');

let agents = fs.existsSync(AGENTS_FILE) ? JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf8')) : [];
const saveAgents = () => fs.writeFileSync(AGENTS_FILE, JSON.stringify(agents, null, 2), { mode: 0o600 });

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}
function checkPassword(agent, password) {
  const { hash } = hashPassword(password, agent.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(agent.hash, 'hex'));
}
const publicAgent = (a) => a && { id: a.id, name: a.name, email: a.email, phone: a.phone || '', role: a.role };

function createAgent({ name, email, phone, password, role }) {
  email = String(email || '').trim().toLowerCase();
  if (!name || !email || !password) throw new Error('Name, email and password are required.');
  if (String(password).length < 10) throw new Error('Password must be at least 10 characters.');
  if (agents.some((a) => a.email === email)) throw new Error('An agent with that email already exists.');
  const agent = { id: store.id(), name: String(name).trim(), email, phone: phone || '', role: role === 'admin' ? 'admin' : 'agent', createdAt: new Date().toISOString(), ...hashPassword(password) };
  agents.push(agent);
  saveAgents();
  return agent;
}

// Seed the first admin from the environment so a fresh deploy is usable.
if (!agents.length && process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
  createAgent({ name: process.env.ADMIN_NAME || 'Administrator', email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD, role: 'admin' });
}
// ADMIN_NAME also corrects the seeded admin's display name on later starts.
const seeded = process.env.ADMIN_NAME && agents.find((a) => a.email === String(process.env.ADMIN_EMAIL || '').toLowerCase());
if (seeded && seeded.name !== process.env.ADMIN_NAME) {
  seeded.name = process.env.ADMIN_NAME;
  saveAgents();
}

function sign(value) {
  return crypto.createHmac('sha256', sessionKey).update(value).digest('base64url');
}
function issue(res, agent) {
  const value = agent.id + '.' + (Date.now() + SESSION_HOURS * 3600e3);
  res.cookie(COOKIE, value + '.' + sign(value), {
    httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: SESSION_HOURS * 3600e3,
  });
}
function current(req) {
  const raw = parseCookies(req.headers.cookie)[COOKIE];
  if (!raw) return null;
  const i = raw.lastIndexOf('.');
  const value = raw.slice(0, i);
  const sig = Buffer.from(raw.slice(i + 1));
  const expected = Buffer.from(sign(value));
  if (sig.length !== expected.length || !crypto.timingSafeEqual(sig, expected)) return null;
  const [agentId, exp] = value.split('.');
  if (Date.now() > Number(exp)) return null;
  return agents.find((a) => a.id === agentId) || null;
}
function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}

module.exports = {
  needsSetup: () => agents.length === 0,
  createAgent,
  list: () => agents.map(publicAgent),
  get: (agentId) => agents.find((a) => a.id === agentId),
  publicAgent,
  login(email, password) {
    const agent = agents.find((a) => a.email === String(email || '').trim().toLowerCase());
    return agent && checkPassword(agent, String(password || '')) ? agent : null;
  },
  updateProfile(agentId, { name, phone }) {
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) throw new Error('Agent not found.');
    if (name != null) {
      if (!String(name).trim()) throw new Error('Name is required.');
      agent.name = String(name).trim();
    }
    if (phone != null) agent.phone = String(phone).trim();
    saveAgents();
    return agent;
  },
  setPassword(agentId, password) {
    if (String(password).length < 10) throw new Error('Password must be at least 10 characters.');
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) throw new Error('Agent not found.');
    Object.assign(agent, hashPassword(password));
    saveAgents();
  },
  remove(agentId) {
    agents = agents.filter((a) => a.id !== agentId);
    saveAgents();
  },
  issue,
  logout: (res) => res.clearCookie(COOKIE),
  current,
  require: (req, res, next) => {
    const agent = current(req);
    if (!agent) return res.status(401).json({ error: 'Please sign in.' });
    req.agent = agent;
    next();
  },
  requireAdmin: (req, res, next) => (req.agent.role === 'admin' ? next() : res.status(403).json({ error: 'Admins only.' })),
};
