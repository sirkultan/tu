// server.js
// Full server: /api/query forwarding, setup/ssh endpoints, auto-port finder, browser auto-open, optional Windows firewall rule.
// Demo code for local development only. Do NOT leak API keys or private SSH keys into source control.

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import fs from "fs/promises";
import { existsSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { Client } from "ssh2";
import crypto from "crypto";
import sshpk from "sshpk";
import { exec } from "child_process";

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const SERVER_DEFAULT_MOCK = process.env.MOCK === "true";
const SSH_DIR = path.join(__dirname, ".ssh");
const CONFIG_FILE = path.join(__dirname, "target_config.json");

if (!existsSync(SSH_DIR)) mkdirSync(SSH_DIR, { recursive: true });

async function writeConfig(obj) {
  await fs.writeFile(CONFIG_FILE, JSON.stringify(obj, null, 2), { encoding: "utf8" });
}
async function readConfig() {
  try {
    const c = await fs.readFile(CONFIG_FILE, "utf8");
    return JSON.parse(c);
  } catch (err) {
    return null;
  }
}

function ensureString(v) { return typeof v === "string" ? v : ""; }

// Key generation
async function generateKeyPair() {
  return new Promise((resolve, reject) => {
    crypto.generateKeyPair(
      "rsa",
      {
        modulusLength: 2048,
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" }
      },
      async (err, publicKeyPem, privateKeyPem) => {
        if (err) return reject(err);
        try {
          const key = sshpk.parseKey(publicKeyPem, "pem");
          const opensshPub = key.toString("ssh");
          const privPath = path.join(SSH_DIR, "id_rsa");
          const pubPath = path.join(SSH_DIR, "id_rsa.pub");
          await fs.writeFile(privPath, privateKeyPem, { mode: 0o600, encoding: "utf8" });
          await fs.writeFile(pubPath, opensshPub + "\n", { mode: 0o644, encoding: "utf8" });
          resolve({ privateKeyPem, opensshPub });
        } catch (e) {
          reject(e);
        }
      }
    );
  });
}

async function readPublicKey() {
  const pubPath = path.join(SSH_DIR, "id_rsa.pub");
  try { const p = await fs.readFile(pubPath, "utf8"); return p.trim(); } catch (err) { return null; }
}
async function readPrivateKey() {
  const privPath = path.join(SSH_DIR, "id_rsa");
  try { const p = await fs.readFile(privPath, "utf8"); return p; } catch (err) { return null; }
}

// Mock responses
function mockResponse(command, user_profile) {
  const esc = "\x1b";
  const greeting = user_profile && user_profile.name ? `Hallo ${user_profile.name}!` : "Hallo!";
  if (!command) {
    return {
      text: `${esc}[31m[Fehler] Kein Befehl angegeben${esc}[0m`,
      messages: [{ role: "system", content: "Kein Befehl angegeben" }],
      suggestions: []
    };
  }
  const lower = command.trim().toLowerCase();
  if (lower.startsWith("hello") || lower.startsWith("hi")) {
    return {
      text: `${esc}[32mPerplexity (mock): ${greeting} Du hast geschrieben: "${command}"${esc}[0m`,
      messages: [
        { role: "assistant", content: `${greeting} Du hast geschrieben: "${command}"` },
        { role: "assistant", type: "command", content: "echo 'Simulierter Befehl ausgeführt'" }
      ],
      suggestions: ["ls -la", "cat README.md", "echo 'Hi'"]
    };
  }
  return {
    text: `${esc}[33mPerplexity (mock): Echo:${esc}[0m ${command}`,
    messages: [{ role: "assistant", content: `Echo: ${command}` }],
    suggestions: ["echo 'Hello'", "uname -a"]
  };
}

function normalizePerplexityPayload(payload) {
  if (!payload) return { text: "", messages: [], suggestions: [] };
  if (typeof payload === "string") return { text: payload, messages: [{ role: "assistant", content: payload }], suggestions: [] };
  if (payload.text || payload.answer) {
    const text = payload.answer || payload.text;
    const messages = payload.messages || [{ role: "assistant", content: text }];
    const suggestions = payload.suggestions || payload.commands || [];
    return { text, messages, suggestions };
  }
  if (Array.isArray(payload.answers) && payload.answers.length) {
    const text = payload.answers.map(a => (typeof a === "string" ? a : JSON.stringify(a))).join("\n\n");
    const messages = payload.answers.map(a => ({ role: "assistant", content: typeof a === "string" ? a : JSON.stringify(a) }));
    const suggestions = payload.suggestions || [];
    return { text, messages, suggestions };
  }
  if (Array.isArray(payload.messages)) {
    const messages = payload.messages.map(m => ({ role: m.role || "assistant", type: m.type, content: m.content || JSON.stringify(m) }));
    const text = messages.map(m => m.content).join("\n");
    const suggestions = payload.suggestions || [];
    return { text, messages, suggestions };
  }
  if (Array.isArray(payload.suggestions) || Array.isArray(payload.commands)) {
    const suggestions = payload.suggestions || payload.commands || [];
    return { text: JSON.stringify(payload), messages: [{ role: "assistant", content: JSON.stringify(payload) }], suggestions };
  }
  return { text: JSON.stringify(payload), messages: [{ role: "assistant", content: JSON.stringify(payload) }], suggestions: [] };
}

// /api/query forwarder
app.post("/api/query", async (req, res) => {
  try {
    const { command, target, user_profile } = req.body || {};
    if (typeof command !== "string") return res.status(400).json({ error: "Missing command string" });
    if (!target) {
      if (SERVER_DEFAULT_MOCK) {
        const r = mockResponse(command, user_profile);
        return res.json({ text: r.text, messages: r.messages, suggestions: r.suggestions || [] });
      } else {
        return res.status(400).json({ error: "No target provided and server default is not mock" });
      }
    }
    const type = target.type;
    if (type === "mock") {
      const r = mockResponse(command, user_profile);
      return res.json({ text: r.text, messages: r.messages, suggestions: r.suggestions || [] });
    }
    if (type === "perplexity") {
      const url = ensureString(target.url || process.env.PERPLEXITY_API_URL);
      const apiKey = ensureString(target.apiKey || process.env.PERPLEXITY_API_KEY);
      if (!url || !apiKey) return res.status(400).json({ error: "Missing Perplexity URL or API key" });
      const forwardBody = { query: command, user_profile: user_profile || null };
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body: JSON.stringify(forwardBody)
      });
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const payload = await response.json();
        const normalized = normalizePerplexityPayload(payload);
        return res.json({ text: normalized.text, messages: normalized.messages, suggestions: normalized.suggestions });
      } else {
        const text = await response.text();
        return res.json({ text, messages: [{ role: "assistant", content: text }], suggestions: [] });
      }
    }
    if (type === "custom") {
      const url = ensureString(target.url);
      if (!url) return res.status(400).json({ error: "Missing custom target URL" });
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command, user_profile: user_profile || null }) });
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const payload = await response.json();
        const normalized = normalizePerplexityPayload(payload);
        return res.json({ text: normalized.text, messages: normalized.messages, suggestions: normalized.suggestions });
      } else {
        const text = await response.text();
        return res.json({ text, messages: [{ role: "assistant", content: text }], suggestions: [] });
      }
    }
    return res.status(400).json({ error: "Unknown target type" });
  } catch (err) {
    console.error("Error in /api/query:", err);
    return res.status(500).json({ error: "Internal server error", details: String(err) });
  }
});

// Setup endpoints (ssh key generation, config, connect)
app.post("/api/setup", async (req, res) => {
  try {
    const { ip, port, username } = req.body || {};
    if (!ip || !port || !username) return res.status(400).json({ error: "Missing ip/port/username" });
    const cfg = { ip: String(ip), port: Number(port), username: String(username) };
    await writeConfig(cfg);
    return res.json({ ok: true, config: cfg });
  } catch (err) { console.error("setup error", err); return res.status(500).json({ error: "internal" }); }
});

app.post("/api/ssh/generate", async (req, res) => {
  try { const result = await generateKeyPair(); return res.json({ ok: true, public: result.opensshPub }); } catch (err) { console.error("ssh generate error", err); return res.status(500).json({ error: String(err) }); }
});

app.get("/api/ssh/public", async (req, res) => {
  try { const pub = await readPublicKey(); if (!pub) return res.status(404).json({ error: "no_public_key" }); return res.json({ public: pub }); } catch (err) { console.error("ssh public error", err); return res.status(500).json({ error: "internal" }); }
});

app.put("/api/ssh/private", async (req, res) => {
  try { const { privateKeyPem } = req.body || {}; if (!privateKeyPem) return res.status(400).json({ error: "missing privateKeyPem" }); const privPath = path.join(SSH_DIR, "id_rsa"); await fs.writeFile(privPath, privateKeyPem, { mode: 0o600, encoding: "utf8" }); return res.json({ ok: true }); } catch (err) { console.error("ssh private write error", err); return res.status(500).json({ error: "internal" }); }
});

app.post("/api/ssh/connect", async (req, res) => {
  try {
    const { method, password, ip, port, username } = req.body || {};
    const cfg = await readConfig();
    const targetIp = ip || (cfg && cfg.ip);
    const targetPort = port || (cfg && cfg.port) || 22;
    const user = username || (cfg && cfg.username);
    if (!targetIp || !user) return res.status(400).json({ error: "missing target info" });

    const conn = new Client();
    const connectOpts = { host: targetIp, port: Number(targetPort), username: user, readyTimeout: 10000 };

    if (method === "password") {
      if (!password) return res.status(400).json({ error: "missing password" });
      connectOpts.password = password;
    } else {
      const privateKey = await readPrivateKey();
      if (!privateKey) return res.status(400).json({ error: "no_private_key" });
      connectOpts.privateKey = privateKey;
    }

    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; try { conn.end(); } catch {} }, 15000);

    conn.on("ready", () => {
      clearTimeout(timeout);
      conn.exec("echo __PERPLEXITY_SSH_OK__", (err, stream) => {
        if (err) { conn.end(); return res.status(500).json({ error: String(err) }); }
        let out = "";
        stream.on("close", (code, signal) => { conn.end(); return res.json({ ok: true, output: out.trim() }); }).on("data", (data) => { out += data.toString(); }).stderr.on("data", (data) => { out += data.toString(); });
      });
    }).on("error", (err) => { clearTimeout(timeout); if (timedOut) return res.status(504).json({ error: "timeout" }); return res.status(500).json({ error: String(err) }); }).connect(connectOpts);
  } catch (err) { console.error("ssh connect error", err); return res.status(500).json({ error: "internal" }); }
});

// status endpoint for UI to show port
let CURRENT_PORT = null;
app.get("/api/status", (req, res) => { res.json({ port: CURRENT_PORT }); });

// Helper: open firewall on Windows
function openFirewall(port) {
  if (process.platform !== "win32") return;
  const ruleName = `PerplexityTerminal-${port}`;
  exec(`netsh advfirewall firewall add rule name="${ruleName}" dir=in action=allow protocol=TCP localport=${port}`, (err) => { if (err) console.warn("Firewall rule add failed (need admin?):", err.message); else console.log("Firewall rule ensured:", ruleName); });
}

// start with fallback ports
function startServer(port) {
  const server = app.listen(port, "0.0.0.0", () => {
    CURRENT_PORT = port;
    console.log(`Server läuft auf http://0.0.0.0:${port}`);
    try {
      if (process.platform === "win32") exec(`start http://localhost:${port}`);
      else if (process.platform === "darwin") exec(`open http://localhost:${port}`);
      else exec(`xdg-open http://localhost:${port}`);
    } catch (err) { console.warn("Browser auto-open failed:", err.message); }
    try { openFirewall(port); } catch (err) { console.warn("openFirewall error:", err.message); }
  });

  server.on("error", (err) => {
    if (err && err.code === "EADDRINUSE") {
      console.log(`Port ${port} belegt – versuche ${port + 1}...`);
      setTimeout(() => startServer(port + 1), 200);
    } else { console.error("Server error:", err); process.exit(1); }
  });
}

const BASE_PORT = Number(process.env.PORT) || 3000;
startServer(BASE_PORT);
