// public/app.js (Erweiterung: send-Icon für jede Suggestion und für command-Messages)
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

let currentTarget = { type: "mock" }; // Default
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

// Chat helpers
function appendChat(role, content, meta = {}) {
  const el = document.createElement("div");
  el.className = `chatMessage ${role}`;
  const left = document.createElement("div");
  left.style.flex = "1";
  left.textContent = content;
  el.appendChild(left);

  // If meta indicates command (type==='command' or content starts with CMD:), add small send button
  const isCommand = meta.type === "command" || (typeof content === "string" && content.trim().startsWith("CMD:"));
  if (isCommand) {
    const sendBtn = document.createElement("button");
    sendBtn.className = "sendBtn";
    sendBtn.title = "Als Befehl senden";
    sendBtn.innerHTML = "▶";
    sendBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      // extract actual command text
      let cmd = content;
      if (typeof cmd === "string" && cmd.trim().startsWith("CMD:")) cmd = cmd.replace(/^CMD:\s*/i, "");
      // If meta.type === 'command' the content is the command directly
      handleCommandFromSuggestion(cmd);
    });
    el.appendChild(sendBtn);
  } else {
    // For non-command assistant messages allow quick resend of whole content as command via small icon too (optional)
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

// Suggestions: each suggestion shows a send icon (click to send)
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
