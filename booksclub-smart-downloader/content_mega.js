// BooksClub Smart Downloader - content_mega.js v1.5.3
// Obserwuje postęp pobierania i zamyka kartę po zakończeniu

(function () {
  'use strict';

  const url = window.location.href;
  if (!url.includes('mega.nz/file/') && !url.includes('mega.nz/#!')) return;
  console.log('[BSD MEGA] v1.5.3');

  // Keepalive port
  let port = null;
  function keepAlive() {
    try {
      port = chrome.runtime.connect({ name: 'mega-keepalive' });
      port.onDisconnect.addListener(() => setTimeout(keepAlive, 1000));
    } catch(e) { setTimeout(keepAlive, 2000); }
  }
  keepAlive();

  // Zamknij dialogi MEGA
  function closeDialogs() {
    document.querySelectorAll('button').forEach(b => {
      if (b.textContent.trim().startsWith('OK, rozumiem')) b.click();
    });
  }
  new MutationObserver(closeDialogs).observe(document.body, { childList: true, subtree: true });
  [1000, 3000, 6000].forEach(t => setTimeout(closeDialogs, t));

  // Zakończenie - zamknij kartę
  let notified = false;
  function done() {
    if (notified) return;
    notified = true;
    const title = document.title.replace(/ ?- ?MEGA/i, '').replace(/^\[\d+s\]\s*/, '').trim();
    console.log('[BSD MEGA] Zakończono:', title);
    try {
      if (port) port.postMessage({ action: 'downloadDone', title });
      else chrome.runtime.sendMessage({ action: 'downloadDone', title });
    } catch(e) {
      chrome.runtime.sendMessage({ action: 'downloadDone', title });
    }
    let secs = 20;
    const cd = setInterval(() => {
      secs--;
      document.title = `[${secs}s] ${title}`;
      if (secs <= 0) { clearInterval(cd); window.close(); }
    }, 1000);
  }

  // Obserwuj postęp
  function watch() {
    let lastPct = 0, stuckSecs = 0, ticks = 0;
    const timer = setInterval(() => {
      ticks++;
      const txt = document.body.innerText || '';
      if (txt.includes('Zakończone') || txt.includes('Completed') || txt.includes('Complete')) {
        clearInterval(timer); done(); return;
      }
      const m = txt.match(/(\d+)%/);
      const pct = m ? +m[1] : 0;
      if (pct !== lastPct) { lastPct = pct; stuckSecs = 0; }
      else if (pct >= 98) {
        stuckSecs++;
        if (stuckSecs >= 30) { clearInterval(timer); location.reload(); return; }
      }
      if (ticks >= 600) { clearInterval(timer); done(); }
    }, 1000);
  }

  // Czekaj na zakończenie pobierania - klik wykonuje background w MAIN world
  // Ten skrypt tylko obserwuje postęp
  setTimeout(() => watch(), 5000);

})();