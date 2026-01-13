#!/usr/bin/env bash
# create_and_run.sh
# Vollständiges Installations- und Start-Skript für "Perplexity Terminal".
# Kein manuelles Kopieren nötig — dieses Skript legt alle Dateien an, installiert Abhängigkeiten
# und startet den Server. Überschreibt bestehende Dateien mit denselben Namen.
#
# Voraussetzungen: bash (Linux/macOS/WSL/Git-Bash), Node.js 18+
#
set -euo pipefail

echo "==> Prüfe Umgebung..."
if ! command -v node >/dev/null 2>&1; then
  echo "Fehler: Node.js ist nicht installiert oder nicht im PATH."
  exit 1
fi

NODE_VER=$(node -v | sed 's/^v//')
# rudimentärer Check: Node 18+
NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Warnung: Node.js >= 18 empfohlen (globales fetch). Gefundene Version: $NODE_VER"
  echo "Falls du Node <18 verwendest, installiere Node 18+ oder sag mir, dann aktiviere ich node-fetch."
fi

# Funktion: prüfe ob Port in Benutzung ist
is_port_in_use() {
  local port=$1
  # try ss, then lsof, then netstat
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]${port}\$|[:.]${port}:" && return 0 || return 1
  elif command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"${port}" -sTCP:LISTEN -t >/dev/null 2>&1 && return 0 || return 1
  elif command -v netstat >/dev/null 2>&1; then
    netstat -an 2>/dev/null | grep -E "LISTEN" | grep -Eq "[:.]${port}\b" && return 0 || return 1
  else
    # Unknown environment: optimistic default (assume free)
    return 1
  fi
}

# Finde freien Port (Versuche 3000, 3001, 3002)
PORT_CANDIDATES=(3000 3001 3002)
SELECTED_PORT=""
for p in "${PORT_CANDIDATES[@]}"; do
  if is_port_in_use "$p"; then
    echo "Port $p in Benutzung, teste nächstes..."
  else
    SELECTED_PORT="$p"
    break
  fi
done

if [ -z "$SELECTED_PORT" ]; then
  echo "Kein freier Port unter ${PORT_CANDIDATES[*]} gefunden. Bitte befreie einen Port oder passe das Skript an."
  exit 1
fi

echo "Verwende Port: $SELECTED_PORT"

echo "==> Erstelle Projektdateien..."

# package.json (ohne node-fetch; Node 18+ nutzt globales fetch)
cat > package.json <<'EOF'
{
  "name": "perplexity-terminal",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "dotenv": "^16.0.0",
    "express": "^4.18.2"
  },
  "devDependencies": {
    "nodemon": "^2.0.22"
  }
}
EOF

# .env
cat > .env <<EOF
MOCK=true
PORT=${SELECTED_PORT}
# PERPLEXITY_API_URL=
# PERPLEXITY_API_KEY=
EOF

# .gitignore
cat > .gitignore <<'EOF'
node_modules/
.env
EOF

# server.js (verwendet global fetch, keine node-fetch-Importe)
cat > server.js <<'EOF'
// server.js
// Express proxy — nutzt globales fetch (Node 18+). Demo: in Produktion absichern!

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const SERVER_DEFAULT_MOCK = process.env.MOCK === "true";

const ensureString = (v) => (typeof v === "string" ? v : "");

// Mock response (ANSI escape sequences + messages + suggestions)
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

      // Forward payload includes user_profile for personalization
      const forwardBody = { query: command, user_profile: user_profile || null };

      // Use global fetch (Node 18+)
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
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
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command, user_profile: user_profile || null })
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

    return res.status(400).json({ error: "Unknown target type" });
  } catch (err) {
    console.error("Error in /api/query:", err);
    return res.status(500).json({ error: "Internal server error", details: String(err) });
  }
});

app.post("/api/validate-target", async (req, res) => {
  try {
    const { target } = req.body || {};
    if (!target || !target.type) return res.status(400).json({ valid: false, error: "Missing target" });
    if (target.type === "perplexity") {
      if (!target.url || !target.apiKey) return res.status(400).json({ valid: false, error: "Missing url or apiKey" });
      return res.json({ valid: true });
    }
    if (target.type === "custom") {
      if (!target.url) return res.status(400).json({ valid: false, error: "Missing url" });
      return res.json({ valid: true });
    }
    if (target.type === "mock") return res.json({ valid: true });
    return res.status(400).json({ valid: false, error: "Unknown type" });
  } catch (err) {
    console.error("validate-target error", err);
    res.status(500).json({ valid: false, error: "internal error" });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Perplexity terminal proxy läuft auf http://0.0.0.0:${PORT}`);
});
EOF

# public directory and files
mkdir -p public

cat > public/index.html <<'EOF'
<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Perplexity Terminal</title>
    <link rel="stylesheet" href="styles.css" />
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm@5.1.0/css/xterm.css" />
  </head>
  <body>
    <div id="connectOverlay" class="overlay">
      <div class="panel">
        <h2>Wohin verbinden?</h2>
        <form id="connectForm">
          <label>Ziel:
            <select id="targetType" name="targetType">
              <option value="mock" selected>Mock (lokal, Standard)</option>
              <option value="perplexity">Perplexity (API)</option>
              <option value="custom">Custom (URL)</option>
            </select>
          </label>

          <div id="perplexityFields" class="fields hidden">
            <label>Perplexity URL:
              <input id="perplexityUrl" type="text" placeholder="https://api.perplexity.ai/v1/answers" />
            </label>
            <label>API Key:
              <input id="perplexityKey" type="password" placeholder="Gib API Key nur lokal ein (wird nicht gespeichert)" />
            </label>
          </div>

          <div id="customFields" class="fields hidden">
            <label>Custom URL:
              <input id="customUrl" type="text" placeholder="https://example.com/your-proxy" />
            </label>
          </div>

          <hr />

          <h3>Personalisierung (optional)</h3>
          <label>Dein Name:
            <input id="userName" type="text" placeholder="Dein Name (z. B. 'Sultan')" />
          </label>
          <label>Kontext / Notizen:
            <input id="userContext" type="text" placeholder="Kleiner Kontext, z.B. 'Projekt XYZ, Linux-Server A'" />
          </label>

          <div class="actions">
            <button type="submit">Verbinden</button>
            <button type="button" id="cancelConnect">Abbrechen</button>
          </div>
          <p class="hint">Hinweis: Gib API‑Keys niemals öffentlich preis. In Produktion: serverseitige Secrets verwenden.</p>
        </form>
      </div>
    </div>

    <div id="main">
      <div id="terminal"></div>

      <div id="side">
        <div class="chatPanel">
          <div class="chatHeader">Chat-Antworten</div>
          <div id="chatMessages" class="chatMessages"></div>
        </div>

        <div class="suggestPanel">
          <div class="chatHeader">Vorschläge (nur Befehle)</div>
          <div id="suggestions" class="chatMessages"></div>
        </div>
      </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/xterm@5.1.0/lib/xterm.js"></script>
    <script src="app.js"></script>
  </body>
</html>
EOF

cat > public/styles.css <<'EOF'
/* minimal styles (wie vorher) */
html,body { height:100%; margin:0; background:#0b0f14; font-family: monospace; color:#e5e5e5; }
#main { display:grid; grid-template-columns:1fr 360px; gap:8px; height:100vh; padding:8px; box-sizing:border-box; }
#terminal { background:#000; border-radius:6px; padding:6px; overflow:hidden; }
#side { display:flex; flex-direction:column; gap:8px; height:calc(100vh - 16px); }
.chatPanel, .suggestPanel { background:#071021; border-radius:6px; padding:8px; display:flex; flex-direction:column; overflow:hidden; }
.chatHeader { font-weight:600; margin-bottom:8px; }
.chatMessages { flex:1; overflow:auto; padding-right:6px; }
.chatMessage { margin-bottom:10px; padding:8px; border-radius:6px; background:#081423; color:#dfe7ff; display:flex; justify-content:space-between; align-items:center; }
.suggestion { display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; padding:8px; border-radius:6px; background:#06202b; color:#bfe6d8; cursor:pointer; border:1px solid #06343f; }
.sendBtn { background:transparent; border:none; color:#9ee6c3; font-size:16px; padding:4px 8px; cursor:pointer; border-radius:4px; }
.overlay { position:fixed; inset:0; background:rgba(0,0,0,0.65); display:flex; align-items:center; justify-content:center; z-index:1000; }
.panel { background:#071021; padding:20px; border-radius:8px; width:480px; color:#ddd; }
.panel input, .panel select { width:100%; padding:8px; margin-top:6px; background:#07111a; border:1px solid #233; color:#eee; border-radius:4px; }
.actions { margin-top:12px; display:flex; gap:8px; }
button { padding:8px 12px; background:#3b82f6; color:white; border:none; border-radius:4px; cursor:pointer; }
.hidden { display:none; }
.hint { font-size:12px; color:#aaa; margin-top:10px; }
EOF

cat > public/app.js <<'EOF'
// minimal frontend (wie zuvor) - siehe vorherige Version für vollen Funktionsumfang
const { Terminal } = window;
const term = new Terminal({ cols: 100, rows: 30, cursorBlink: true, theme: { foreground: "#e5e5e5", background: "#000" } });
term.open(document.getElementById("terminal"));

const overlay = document.getElementById("connectOverlay");
const form = document.getElementById("connectForm");
const typeSelect = document.getElementById("targetType");
const perplexityFields = document.getElementById("perplexityFields");
const customFields = document.getElementById("customFields");
const perplexityUrlInput = document.getElementById("perplexityUrl");
const perplexityKeyInput = document.getElementById("perplexityKey");
const customUrlInput = document.getElementById("customUrl");
const cancelBtn = document.getElementById("cancelConnect");
const userNameInput = document.getElementById("userName");
const userContextInput = document.getElementById("userContext");

const chatMessages = document.getElementById("chatMessages");
const suggestionsEl = document.getElementById("suggestions");

let currentTarget = { type: "mock" };
let user_profile = null;

function showOverlay() { overlay.style.display = "flex"; }
function hideOverlay() { overlay.style.display = "none"; }
function updateFields() {
  const v = typeSelect.value;
  perplexityFields.classList.toggle("hidden", v !== "perplexity");
  customFields.classList.toggle("hidden", v !== "custom");
}
typeSelect.addEventListener("change", updateFields);
cancelBtn.addEventListener("click", () => { if (!currentTarget) currentTarget = { type: "mock" }; hideOverlay(); writePrompt(); });

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const t = typeSelect.value;
  if (t === "mock") currentTarget = { type: "mock" };
  else if (t === "perplexity") {
    const url = perplexityUrlInput.value.trim();
    const apiKey = perplexityKeyInput.value.trim();
    if (!url || !apiKey) { alert("Bitte Perplexity URL und API Key angeben."); return; }
    currentTarget = { type: "perplexity", url, apiKey };
  } else if (t === "custom") {
    const url = customUrlInput.value.trim();
    if (!url) { alert("Bitte Custom URL angeben."); return; }
    currentTarget = { type: "custom", url };
  }
  user_profile = { name: userNameInput.value.trim() || null, context: userContextInput.value.trim() || null };
  hideOverlay();
  term.write("\r\n\x1b[32m[verbunden]\x1b[0m\r\n");
  writePrompt();
});

function appendChat(role, content, meta = {}) {
  const el = document.createElement("div");
  el.className = `chatMessage ${role}`;
  const left = document.createElement("div");
  left.style.flex = "1";
  left.textContent = content;
  el.appendChild(left);
  const isCommand = meta.type === "command" || (typeof content === "string" && content.trim().startsWith("CMD:"));
  if (isCommand) {
    const sendBtn = document.createElement("button");
    sendBtn.className = "sendBtn";
    sendBtn.title = "Als Befehl senden";
    sendBtn.innerHTML = "▶";
    sendBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      let cmd = content;
      if (typeof cmd === "string" && cmd.trim().startsWith("CMD:")) cmd = cmd.replace(/^CMD:\s*/i, "");
      handleCommandFromSuggestion(cmd);
    });
    el.appendChild(sendBtn);
  } else {
    const sendIcon = document.createElement("button");
    sendIcon.className = "sendBtn";
    sendIcon.title = "In Befehl umwandeln und senden";
    sendIcon.innerHTML = "⤴";
    sendIcon.addEventListener("click", (e) => {
      e.stopPropagation();
      const cmd = content;
      handleCommandFromSuggestion(cmd);
    });
    el.appendChild(sendIcon);
  }
  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function showSuggestions(suggestions) {
  suggestionsEl.innerHTML = "";
  if (!Array.isArray(suggestions) || suggestions.length === 0) return;
  const cmds = suggestions.filter(s => typeof s === "string" && /^[\w\-\./~]+(\s.*)?$/.test(s));
  cmds.forEach(cmd => {
    const wrapper = document.createElement("div");
    wrapper.className = "suggestion";
    const left = document.createElement("div");
    left.textContent = cmd;
    const btn = document.createElement("button");
    btn.className = "sendBtn";
    btn.title = "Als Befehl senden";
    btn.innerHTML = "▶";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      handleCommandFromSuggestion(cmd);
    });
    wrapper.appendChild(left);
    wrapper.appendChild(btn);
    suggestionsEl.appendChild(wrapper);
  });
}

async function handleCommandFromSuggestion(cmd) {
  appendChat("user", cmd);
  term.write("\r\n\x1b[33m[send to target]\x1b[0m\r\n");
  await sendCommand(cmd);
}

let input = "";
const writePrompt = () => term.write("\r\n\x1b[32mperplexity-term$ \x1b[0m");
writePrompt();

function simulateCommandExecution(cmd) {
  term.write(`\x1b[36m[Perplexity -> Terminal CMD] ${cmd}\x1b[0m\r\n`);
  term.write(`\x1b[90m[Simulierter Output für '${cmd}']\x1b[0m\r\n`);
  appendChat("system", `Simulierter Output für '${cmd}'`);
}

async function sendCommand(command) {
  try {
    const resp = await fetch("/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command, target: currentTarget, user_profile })
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: "unknown" }));
      term.write(`\x1b[31m[error] ${JSON.stringify(err)}\x1b[0m\r\n`);
      appendChat("system", `Fehler: ${JSON.stringify(err)}`);
      writePrompt();
      return;
    }
    const payload = await resp.json();
    const text = payload.text || "";
    const messages = Array.isArray(payload.messages) ? payload.messages : (text ? [{ role: "assistant", content: text }] : []);
    const suggestions = Array.isArray(payload.suggestions) ? payload.suggestions : [];

    if (text) term.write(text + "\r\n");

    for (const m of messages) {
      const role = (m.role || "assistant").toLowerCase();
      const type = m.type || null;
      const content = m.content || (m.text || "");
      if (type === "command" || (typeof content === "string" && content.trim().startsWith("CMD:"))) {
        const cmd = type === "command" ? content : content.replace(/^CMD:\s*/i, "");
        simulateCommandExecution(cmd);
      } else {
        appendChat(role === "user" ? "user" : (role === "system" ? "system" : "assistant"), content, m);
      }
    }

    showSuggestions(suggestions);
  } catch (err) {
    term.write(`\x1b[31m[network error] ${String(err)}\x1b[0m\r\n`);
    appendChat("system", `Network error: ${String(err)}`);
  }
}

term.onData(async (data) => {
  const code = data.charCodeAt(0);
  if (code === 13) {
    term.write("\r\n");
    const command = input.trim();
    if (command.length === 0) { input = ""; writePrompt(); return; }

    if (command === "connect") {
      if (currentTarget && currentTarget.type === "perplexity") {
        typeSelect.value = "perplexity";
        perplexityUrlInput.value = currentTarget.url || "";
        perplexityKeyInput.value = currentTarget.apiKey || "";
      } else if (currentTarget && currentTarget.type === "custom") {
        typeSelect.value = "custom";
        customUrlInput.value = currentTarget.url || "";
      } else {
        typeSelect.value = "mock";
      }
      updateFields();
      showOverlay();
      input = "";
      return;
    }

    if (command === "help") {
      term.write("Verfügbare Befehle:\r\n");
      term.write("  connect   -> Verbindungsdialog öffnen\r\n");
      term.write("  help      -> Diese Hilfe anzeigen\r\n");
      term.write("Alle anderen Eingaben werden an das konfigurierte Ziel gesendet.\r\n");
      input = "";
      writePrompt();
      return;
    }

    appendChat("user", command);
    term.write("\r\n\x1b[33m[send to target]\x1b[0m\r\n");
    await sendCommand(command);

    input = "";
    writePrompt();
    return;
  }

  if (code === 127 || code === 8) {
    if (input.length > 0) { input = input.slice(0, -1); term.write("\b \b"); }
    return;
  }

  input += data;
  term.write(data);
});

showOverlay();
EOF

echo "==> Installiere Abhängigkeiten (npm install)..."
npm install

echo "==> Starte Server auf Port ${SELECTED_PORT} (CTRL+C zum Stoppen)..."
PORT=${SELECTED_PORT} npm start