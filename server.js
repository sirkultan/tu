// server.js – korrigiert (keine doppelten Imports)

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

/* ---------- MOCK ---------- */
function mockResponse(command) {
  const esc = "\x1b";
  return {
    text: `${esc}[32mMock OK:${esc}[0m ${command}`,
    messages: [{ role: "assistant", content: `Mock: ${command}` }],
    suggestions: ["ls", "pwd", "whoami"]
  };
}

/* ---------- NORMALIZER ---------- */
function normalize(payload) {
  if (typeof payload === "string") {
    return { text: payload, messages: [{ role: "assistant", content: payload }], suggestions: [] };
  }

  if (payload?.text) {
    return {
      text: payload.text,
      messages: payload.messages || [{ role: "assistant", content: payload.text }],
      suggestions: payload.suggestions || []
    };
  }

  return {
    text: JSON.stringify(payload),
    messages: [{ role: "assistant", content: JSON.stringify(payload) }],
    suggestions: []
  };
}

/* ---------- MAIN API ---------- */
app.post("/api/query", async (req, res) => {
  try {
    const { command, target } = req.body || {};

    if (!command) {
      return res.status(400).json({ error: "Missing command" });
    }

    if (!target || target.type === "mock") {
      const r = mockResponse(command);
      return res.json(r);
    }

    if (target.type === "perplexity") {
      const url = ensureString(target.url || process.env.PERPLEXITY_API_URL);
      const apiKey = ensureString(target.apiKey || process.env.PERPLEXITY_API_KEY);

      if (!url || !apiKey) {
        return res.status(400).json({ error: "Missing Perplexity config" });
      }

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({ query: command })
      });

      const ct = response.headers.get("content-type") || "";
      const data = ct.includes("json") ? await response.json() : await response.text();

      return res.json(normalize(data));
    }

    return res.status(400).json({ error: "Unknown target type" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error", details: String(err) });
  }
});

/* ---------- START ---------- */
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server läuft auf http://localhost:${PORT}`);
});
