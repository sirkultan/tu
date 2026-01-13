// public/app.js
// Setup Wizard + basic terminal integration
const { Terminal } = window;
const term = new Terminal({ cols: 100, rows: 30, cursorBlink: true, theme: { foreground: "#e5e5e5", background: "#000" } });
term.open(document.getElementById("terminal"));

// Setup elements
const setupOverlay = document.getElementById("setupOverlay");
const setupForm = document.getElementById("setupForm");
const setupIp = document.getElementById("setupIp");
const setupPort = document.getElementById("setupPort");
const setupUser = document.getElementById("setupUser");
const authMethod = document.getElementById("authMethod");
const passwordField = document.getElementById("passwordField");
const authPassword = document.getElementById("authPassword");
const generateKeyBtn = document.getElementById("generateKeyBtn");
const showPubKeyBtn = document.getElementById("showPubKeyBtn");
const downloadPubKeyBtn = document.getElementById("downloadPubKeyBtn");
const pubkeyDisplay = document.getElementById("pubkeyDisplay");
const pubkeyText = document.getElementById("pubkeyText");
const setupResult = document.getElementById("setupResult");
const cancelSetup = document.getElementById("cancelSetup");

authMethod.addEventListener("change", () => { passwordField.classList.toggle("hidden", authMethod.value !== "password"); });

generateKeyBtn.addEventListener("click", async () => {
  generateKeyBtn.disabled = true; generateKeyBtn.textContent = "Erzeuge...";
  try {
    const r = await fetch("/api/ssh/generate", { method: "POST" });
    const j = await r.json();
    if (r.ok && j.public) { pubkeyText.value = j.public; pubkeyDisplay.classList.remove("hidden"); setupResult.textContent = "SSH Key erzeugt. Public Key angezeigt."; }
    else setupResult.textContent = "Fehler beim Erzeugen: " + JSON.stringify(j);
  } catch (e) { setupResult.textContent = "Fehler: " + String(e); }
  finally { generateKeyBtn.disabled = false; generateKeyBtn.textContent = "SSH Key erzeugen"; }
});

showPubKeyBtn.addEventListener("click", async () => { try { const r = await fetch("/api/ssh/public"); const j = await r.json(); if (r.ok && j.public) { pubkeyText.value = j.public; pubkeyDisplay.classList.remove("hidden"); } else { setupResult.textContent = "Kein Public Key gefunden."; } } catch (e) { setupResult.textContent = "Fehler: " + String(e); } });

downloadPubKeyBtn.addEventListener("click", async () => { try { const r = await fetch("/api/ssh/public"); const j = await r.json(); if (r.ok && j.public) { const blob = new Blob([j.public + "\n"], { type: "text/plain" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "id_rsa.pub"; a.click(); URL.revokeObjectURL(url); } else { setupResult.textContent = "Kein Public Key zum Download."; } } catch (e) { setupResult.textContent = "Fehler: " + String(e); } });

cancelSetup.addEventListener("click", () => { setupOverlay.style.display = "none"; });

setupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  setupResult.textContent = "Speichere und teste Verbindung...";
  const cfg = { ip: setupIp.value.trim(), port: Number(setupPort.value), username: setupUser.value.trim() };
  try {
    const r = await fetch("/api/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cfg) });
    const j = await r.json();
    if (!r.ok) { setupResult.textContent = "Fehler beim Speichern: " + JSON.stringify(j); return; }
    const method = authMethod.value; const body = { method, ip: cfg.ip, port: cfg.port, username: cfg.username };
    if (method === "password") body.password = authPassword.value;
    const rc = await fetch("/api/ssh/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const jc = await rc.json();
    if (rc.ok && jc.ok) { setupResult.textContent = "Verbindung erfolgreich: " + (jc.output || "").trim(); setupOverlay.style.display = "none"; term.write("\r\n\x1b[32m[SSH Verbindung OK]\x1b[0m\r\n"); writePrompt(); } else { setupResult.textContent = "Verbindungsfehler: " + JSON.stringify(jc); }
  } catch (err) { setupResult.textContent = "Fehler: " + String(err); }
});

let input = ""; const writePrompt = () => term.write("\r\n\x1b[32mperplexity-term$ \x1b[0m"); writePrompt();

term.onData(async (data) => {
  const code = data.charCodeAt(0);
  if (code === 13) {
    term.write("\r\n");
    const command = input.trim(); if (!command) { input = ""; writePrompt(); return; }
    if (command === "setup") { setupOverlay.style.display = "flex"; input = ""; return; }
    term.write("\x1b[33m[send to target]\x1b[0m\r\n");
    try { const resp = await fetch("/api/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command }) }); const payload = await resp.json(); const text = payload.text || ""; if (text) term.write(text + "\r\n"); } catch (err) { term.write(`\x1b[31m[network error] ${String(err)}\x1b[0m\r\n`); }
    input = ""; writePrompt(); return;
  }
  if (code === 127 || code === 8) { if (input.length > 0) { input = input.slice(0, -1); term.write("\b \b"); } return; }
  input += data; term.write(data);
});

// Show setup overlay on first load
setupOverlay.style.display = "flex";
