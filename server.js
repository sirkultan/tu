// Minimal Express proxy (mock by default)
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

const MOCK = process.env.MOCK === "true";
const PORT = process.env.PORT || 3000;

app.post("/api/query", (req, res) => {
  const { command } = req.body || {};
  if (!command || typeof command !== "string") {
    return res.status(400).json({ error: "Missing command" });
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
  // In real mode: forward to Perplexity API (not implemented here)
  return res.status(501).json({ error: "Real Perplexity forwarding not configured" });
});

app.listen(PORT, () => {
  console.log(`Server läuft auf http://localhost:${PORT} (MOCK=${MOCK})`);
});
