// Sehr kleines frontend: tippe einen Befehl, Enter schickt an /api/query
const { Terminal } = window;
const term = new Terminal({ cols: 80, rows: 24, cursorBlink: true });
term.open(document.getElementById("terminal"));

let input = "";
const prompt = () => { term.write("\\r\\n\\x1b[32mperplexity-term$ \\x1b[0m"); };
prompt();

term.onData(async (data) => {
  const code = data.charCodeAt(0);
  if (code === 13) {
    term.write("\\r\\n");
    const command = input.trim();
    if (!command) { input = ""; prompt(); return; }
    term.write("\\x1b[33m[send to Perplexity]\\x1b[0m\\r\\n");
    try {
      const resp = await fetch("/api/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command }) });
      const payload = await resp.json();
      const text = payload.text || JSON.stringify(payload);
      for (const line of text.split(/\\r?\\n/)) {
        if (line.startsWith("CMD:")) {
          term.write(`\\x1b[36m[Perplexity -> Terminal CMD] ${line.slice(4).trim()}\\x1b[0m\\r\\n`);
          term.write(`\\x1b[90m[Simulierter Output]\\x1b[0m\\r\\n`);
        } else {
          term.write(line + "\\r\\n");
        }
      }
    } catch (e) {
      term.write(`\\x1b[31m[error] ${e}\\x1b[0m\\r\\n`);
    }
    input = ""; prompt(); return;
  }
  if (code === 127) { if (input.length>0) { input = input.slice(0,-1); term.write("\\b \\b"); } return; }
  input += data; term.write(data);
});
