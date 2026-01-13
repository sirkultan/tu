# Perplexity → Cockpit Runner (Prototype)

Kurze Anleitung zum lokalen Prototypen.

## Idee
Eine Browser-Extension erkennt Shell-Befehle in Perplexity Chat-Antworten und bietet einen Button "Run in Cockpit" an. Beim Klick sendet die Extension den Befehl an einen lokal laufenden Helper, der den Befehl via SSH auf einem definierten Host ausführt.

## Schnellstart
1. Kopiere `.env.example` nach `.env` und fülle `AUTH_TOKEN` und `SSH_KEY` aus.
2. `npm install`
3. `npm start` (oder `node server.js`)
4. Installiere die Extension temporär in Chrome/Edge (Entwicklermodus) indem du `perplexity-cockpit` als Unpacked extension lädst.
5. Setze in Extension-Settings (`chrome.storage`) `authToken` und `defaultHost`/`defaultUser`.

## Sicherheit
- **Key-based SSH ist jetzt Pflicht (Standard).** Lege `SSH_KEY` in `.env` auf einen privaten Schlüssel (empfohlen: `~/.ssh/id_rsa`) und setze `chmod 600`.
- **Whitelist erforderlich:** Erstelle und bearbeite `whitelist.json` (hosts/users/commands). Der Helper startet nicht ohne gültige `whitelist.json`.
- **Auth Token:** Setze einen starken `AUTH_TOKEN` in `.env`. Der Helper verweigert den Start, wenn kein Token gesetzt oder der Default `changeme` verwendet wird.
- **TLS empfohlen:** Setze `CERT_PATH` und `CERT_KEY_PATH` auf lokale Zertifikat-/Schlüssel-Pfade (z. B. `mkcert`) oder stelle einen TLS-Proxy (nginx) vor den Helper. Alternativ kann `FORCE_TLS=true` gesetzt werden, damit der Server explizit TLS erzwingt.
- **Audit & Logs:** Alle ausgeführten Befehle werden in `audit.log` protokolliert (Timestamp, IP, Host, User, Command). Überprüfe Dateisystemberechtigungen und Zugriffskontrollen.

### Schnell-Checks
- `chmod 600 /path/to/key`
- `cp .env.example .env` → setze `AUTH_TOKEN`, `SSH_KEY`, optional `CERT_PATH`/`CERT_KEY_PATH`
- `npm run test-ssh` führt einen einfachen Verbindungs-Check aus (benötigt gültige `TEST_HOST`/`TEST_USER` in `.env`).

## Erweiterungen
- Cockpit-Plugin: direkte Integration ins Cockpit-Terminal.
- Audit-Logging, RBAC, UI-Feedback im Browser.


