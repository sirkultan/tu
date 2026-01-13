// background.js
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'run-command') {
    // Hole Token aus storage
    chrome.storage.sync.get(['authToken','defaultHost','defaultUser'], (items) => {
      const token = items.authToken || '';
      const host = items.defaultHost || 'localhost';
      const user = items.defaultUser || process.env.USER || 'root';
      if (!token) {
        if (confirm('Kein Auth-Token gesetzt. Öffne Einstellungen?')) {
          chrome.tabs.create({ url: 'chrome://extensions/' });
        }
        sendResponse({ ok: false, reason: 'no-token' });
        return;
      }
      fetch('https://localhost:3000/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ command: msg.command, host, user })
      }).then(r => r.json()).then(data => {
        const output = (data.stdout || '') + (data.stderr ? '\nERR:\n'+data.stderr : '');
        alert('Output:\n' + (output || '[no output]'));
      }).catch(e => {
        alert('Error: ' + e);
      });
      sendResponse({ ok: true });
    });
    return true; // Keep channel open
  }
});
