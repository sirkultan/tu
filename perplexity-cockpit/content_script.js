// content_script.js
// Fügt 'Run in Cockpit' Buttons neben Code-Snippets in der Perplexity UI hinzu.
function findMessages() {
  // Selektoren können sich ändern; ggf. an die aktuelle Perplexity-DOM anpassen
  return Array.from(document.querySelectorAll('article, .message, .answer'));
}

function normalizeText(node) {
  const code = node.querySelector('code');
  if (code) return code.innerText.trim();
  return node.innerText.trim();
}

function addButtonTo(node, text) {
  if (node.dataset.hasPerplexityHook) return;
  const btn = document.createElement('button');
  btn.textContent = 'Run in Cockpit';
  btn.style.marginLeft = '8px';
  btn.style.cursor = 'pointer';
  btn.addEventListener('click', async (e) => {
    const confirmExec = confirm(`Ausführen auf Host?\n\n${text}`);
    if (!confirmExec) return;
    chrome.runtime.sendMessage({ action: 'run-command', command: text });
  });
  node.appendChild(btn);
  node.dataset.hasPerplexityHook = '1';
}

function scanAndAttach() {
  const msgs = findMessages();
  for (const m of msgs) {
    try {
      const t = normalizeText(m);
      // Einfache Heuristik: mehrere Zeilen oder enthält `sudo` oder beginnt mit `$`
      if (!t) continue;
      if (/^\$\s*/.test(t) || /sudo|apt|systemctl|journalctl|docker|kubectl|ls|cat|tail/i.test(t) || t.split('\n').length > 1) {
        const command = t.replace(/^\$\s*/gm, '').trim();
        addButtonTo(m, command);
      }
    } catch (e) {
      // ignore
    }
  }
}

const obs = new MutationObserver(scanAndAttach);
obs.observe(document, { childList: true, subtree: true });
scanAndAttach();
