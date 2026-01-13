// server.js — Hardened local helper: Enforce key-based SSH, require whitelist, optional TLS
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bodyParser = require('body-parser');
const { Client } = require('ssh2');
const https = require('https');

const app = express();
app.use(helmet());
app.use(bodyParser.json());

const AUTH_TOKEN = process.env.AUTH_TOKEN;
const SSH_KEY = process.env.SSH_KEY || `${process.env.HOME}/.ssh/id_rsa`;
const PORT = parseInt(process.env.PORT || '3000', 10);
const CERT_PATH = process.env.CERT_PATH; // path to TLS cert (optional)
const CERT_KEY_PATH = process.env.CERT_KEY_PATH; // path to TLS key (optional)
const FORCE_TLS = process.env.FORCE_TLS === 'true';
const AUDIT_LOG = process.env.AUDIT_LOG || path.join(__dirname, 'audit.log');

// Require explicit AUTH_TOKEN
if (!AUTH_TOKEN) {
  console.error('FATAL: AUTH_TOKEN is not set. Set a strong token in .env (AUTH_TOKEN=...)');
  process.exit(1);
}
if (AUTH_TOKEN === 'changeme') {
  console.error('FATAL: AUTH_TOKEN is set to default. Choose a strong token and restart.');
  process.exit(1);
}

// Require whitelist for safety
let whitelist = null;
try {
  whitelist = JSON.parse(fs.readFileSync(path.join(__dirname, 'whitelist.json'), 'utf8'));
} catch (e) {
  console.error('FATAL: whitelist.json not found or invalid. Create and configure whitelist.json to restrict allowed hosts/commands.');
  process.exit(1);
}

// Ensure SSH_KEY exists and is not group/world-readable
try {
  const st = fs.statSync(SSH_KEY);
  const mode = st.mode & 0o777;
  if ((mode & 0o077) !== 0) {
    console.error(`FATAL: SSH key ${SSH_KEY} has insecure permissions (${mode.toString(8)}). Run: chmod 600 ${SSH_KEY}`);
    process.exit(1);
  }
} catch (e) {
  console.error(`FATAL: Cannot access SSH key at ${SSH_KEY}: ${e.message}`);
  process.exit(1);
}
const PRIVATE_KEY = fs.readFileSync(SSH_KEY);

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
app.use(limiter);

function allowed(host, user, command) {
  if (!whitelist.hosts || !whitelist.hosts[host]) return false;
  const cfg = whitelist.hosts[host];
  if (cfg.users && cfg.users.length && !cfg.users.includes(user)) return false;
  if (!cfg.commands || !cfg.commands.length) return false;
  return cfg.commands.some(pat => {
    // escape and convert glob '*' to '.*'
    const esc = pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*');
    const re = new RegExp('^' + esc + '$');
    return re.test(command);
  });
}

function audit(req, host, user, command) {
  const rec = { ts: new Date().toISOString(), ip: req.ip, host, user, command };
  try { fs.appendFileSync(AUDIT_LOG, JSON.stringify(rec) + '\n'); } catch (e) { console.warn('audit write failed', e.message); }
}

function runSSH({ host, user, command }, cb) {
  const conn = new Client();
  let stdout = '', stderr = '';
  conn.on('ready', () => {
    conn.exec(command, (err, stream) => {
      if (err) { conn.end(); return cb(err); }
      stream.on('close', (code, signal) => { conn.end(); cb(null, { stdout, stderr, code }); })
            .on('data', (data) => { stdout += data.toString(); })
            .stderr.on('data', (data) => { stderr += data.toString(); });
    });
  }).on('error', cb).connect({
    host,
    username: user,
    privateKey: PRIVATE_KEY
  });
}

app.post('/run', (req, res) => {
  const token = (req.headers.authorization || '').split(' ')[1];
  if (token !== AUTH_TOKEN) return res.status(401).json({ error: 'unauthorized' });
  const { host, user, command } = req.body;
  if (!host || !user || !command) return res.status(400).json({ error: 'host,user,command required' });
  if (!allowed(host, user, command)) return res.status(403).json({ error: 'command not allowed by whitelist' });
  audit(req, host, user, command);
  runSSH({ host, user, command }, (err, out) => {
    if (err) return res.status(500).json({ error: String(err) });
    res.json(out);
  });
});

app.get('/health', (req, res) => res.json({ ok: true }));

// Start server: HTTPS if certs provided, otherwise HTTP (but can be forced to require TLS)
if (CERT_PATH && CERT_KEY_PATH) {
  try {
    const cert = fs.readFileSync(CERT_PATH);
    const key = fs.readFileSync(CERT_KEY_PATH);
    https.createServer({ cert, key }, app).listen(PORT, () => console.log(`Helper running on https://localhost:${PORT}`));
  } catch (e) {
    console.error('FATAL: Unable to read CERT_PATH/CERT_KEY_PATH:', e.message);
    process.exit(1);
  }
} else {
  if (FORCE_TLS) {
    console.error('FATAL: FORCE_TLS=true but no CERT_PATH/CERT_KEY_PATH set. Provide certs or unset FORCE_TLS.');
    process.exit(1);
  }
  app.listen(PORT, () => console.log(`Helper running on http://localhost:${PORT} (TLS not configured)`));
}

