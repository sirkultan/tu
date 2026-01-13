# Cockpit Integration — Notes

Ziel: Direkte Integration damit die Extension in der Cockpit-WebUI Terminal-Panels öffnen oder Commands an bestehende Terminal-Sessions senden kann.

Optionen:
- Verwende Cockpits vorhandene WebSocket/JS-API (falls verfügbar) und authentifiziere über Cockpit-Sessions → erfordert Cockpit-Plugin/Server-seitigen Code.
- Alternative: Helper verbindet sich per SSH direkt zum Host (aktuelles PoC). Simple und sicherer für erste Version.

Nächste Schritte für tiefe Integration:
1. Research: Cockpit API für Terminal-Sessions und Auth flows.
2. Implementiere Cockpit-Plugin, das einen API-Endpunkt anbietet, um per-session Commands zu injecten.
3. Extension erweitert UX: "Open in Cockpit Terminal".

