# Dieses Skript in C:\Users\florg\tu ausführen.
# Es erzeugt die benötigten Dateien und das public-Verzeichnis.

$files = @{
"package.json" = @'
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
    "express": "^4.18.2",
    "node-fetch": "^3.4.1"
  },
  "devDependencies": {
    "nodemon": "^2.0.22"
  }
}
'@

".env.example" = @'
PERPLEXITY_API_URL=https://api.perplexity.ai/v1/answers
PERPLEXITY_API_KEY=your_perplexity_api_key_here
MOCK=true
PORT=3000
'@

".gitignore" = @'
node_modules/
.env
'@

"server.js" = @'
// Einfacher Express-Proxy-Server, der Terminal-Befehle entgegennimmt und an Perplexity weiterleitet.
// Achtung: In Produktion unbedingt Ratenbegrenzung, Authentifizierung und Input-Sanitization hinzufügen.

import express from "express";
import fetch from "node-fetch";
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

const PERPLEXITY_API_URL = process.env.PERPLEXITY_API_URL;
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
const PORT = process.env.PORT || 3000;
const MOCK = process.env.MOCK === "true";

app.post("/api/query", async (req, res) => {
  try {
    const { command } = req.body;
    if (typeof command !== "string") {
      return res.status(400).json({ error: "Missing command string" });
    }

    if (MOCK) {
      const lower = command.trim().toLowerCase();
      if (lower.startsWith("hello") || lower.startsWith("hi")) {
        return res.json({
          text: `Perplexity (mock): Hallo! Du hast geschrieben: "${command}"\nCMD: echo 'Simulierter Befehl ausgeführt'`
        });
      }
      return res.json({ text: `Perplexity (mock): Echo: ${command}` });
    }

    if (!PERPLEXITY_API_URL || !PERPLEXITY_API_KEY) {
      return res.status(500).json({ error: "Perplexity API URL or key not configured" });
    }

    const response = await fetch(PERPLEXITY_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${PERPLEXITY_API_KEY}`
      },
      body: JSON.stringify({ query: command })
    });

    let payload;
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      payload = await response.json();
      const text = payload.answer || payload.text || JSON.stringify(payload);
      return res.json({ text });
    } else {
      const text = await response.text();
      return res.json({ text });
    }
  } catch (err) {
    console.error("Error in /api/query:", err);
    res.status(500).json({ error: "Internal server error", details: String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`Perplexity terminal proxy läuft auf http://localhost:${PORT} (MOCK=${MOCK})`);
});
'@

"public\index.html" = @'
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
    <div id="terminal"></div>
    <script src="https://cdn.jsdelivr.net/npm/xterm@5.1.0/lib/xterm.js"></script>
    <script src="app.js"></script>
  </body>
</html>
'@

"public\styles.css" = @'
html,body {
  height: 100%;
  margin: 0;
  background: #1e1e1e;
  font-family: monospace;
}

#terminal {
  height: 100vh;
  width: 100%;
  padding: 8px;
  box-sizing: border-box;
}
'@

"public\app.js" = @'
// Frontend: xterm.js Terminal das komplette Eingabeverhalten an den Server sendet.

const { Terminal } = window;
const term = new Terminal({
  cols: 80,
  rows: 24,
  cursorBlink: true,
  theme: {
    foreground: "#e5e5e5",
    background: "#1e1e1e"
  }
});
term.open(document.getElementById("terminal"));

let input = "";
const prompt = () => {
  term.write("\r\n\x1b[32mperplexity-term$ \x1b[0m");
};
prompt();

term.onData(async (data) => {
  const code = data.charCodeAt(0);
  if (code === 13) {
    term.write("\r\n");
    const command = input.trim();
    if (command.length === 0) {
      input = "";
      prompt();
      return;
    }

    term.write("\x1b[33m[send to Perplexity]\x1b[0m\r\n");

    try {
      const resp = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command })
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "unknown" }));
        term.write(`\x1b[31m[error] ${JSON.stringify(err)}\x1b[0m\r\n`);
        input = "";
        prompt();
        return;
      }
      const payload = await resp.json();
      const text = payload.text || "";
      const lines = text.split(/\r?\n/);
      for (const line of lines) {
        if (line.startsWith("CMD:")) {
          const cmd = line.slice(4).trim();
          term.write(`\x1b[36m[Perplexity -> Terminal CMD] ${cmd}\x1b[0m\r\n`);
          term.write(`\x1b[90m[Simulierter Output für '${cmd}']\x1b[0m\r\n`);
        } else {
          term.write(`${line}\r\n`);
        }
      }
    } catch (err) {
      term.write(`\x1b[31m[network error] ${String(err)}\x1b[0m\r\n`);
    }

    input = "";
    prompt();
    return;
  }

  if (code === 127) {
    if (input.length > 0) {
      input = input.slice(0, -1);
      term.write("\b \b");
    }
    return;
  }

  input += data;
  term.write(data);
});
'@

"README.md" = @'
# Perplexity Terminal (Beispiel)

Dieses Projekt stellt ein einfaches, interaktives Terminal (Web) bereit, das jede sichtbare Eingabe an einen Server sendet, der die Anfrage an eine Perplexity AI API weiterleiten kann. Antworten von Perplexity werden im Terminal angezeigt. Falls Perplexity Steuerkommandos in der Antwort liefert (z. B. Zeilen, die mit `CMD:` beginnen), werden diese als simulierte Terminalausführung angezeigt.

Wichtig: Dies ist ein Demo‑Projekt. In einer echten Umgebung musst du Sicherheitsmaßnahmen hinzufügen (Authentifizierung, Ratenbegrenzung, Prüfung/Filtern der Antworten), da das automatische Ausführen von Kommandos gefährlich sein kann.

Installation:
1. npm install
2. Kopiere .env.example zu .env (oder setze MOCK=true)
3. npm start und öffne http://localhost:3000
'
}

# ensure public folder exists
New-Item -ItemType Directory -Force -Path public | Out-Null

foreach ($name in $files.Keys) {
  $path = Join-Path (Get-Location) $name
  $dir = Split-Path $path -Parent
  if (-not (Test-Path $dir)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
  }
  $files[$name] | Out-File -FilePath $path -Encoding UTF8
  Write-Host "Wrote $path"
}

Write-Host "Fertig. Jetzt: git add . ; git commit -m 'Add Perplexity interactive terminal (mock + proxy server)' ; git push -u origin perplexity-terminal"