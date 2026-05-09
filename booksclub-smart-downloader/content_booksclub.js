// BooksClub Smart Downloader - content_booksclub.js v1.0.6

(function () {
  'use strict';
  if (window.__bsdLoaded) return;
  window.__bsdLoaded = true;

  const url = window.location.href;

  function makeBtn(label) {
    const btn = document.createElement('button');
    btn.id = 'bsd-btn';
    btn.innerHTML = label;
    btn.style.cssText = `
      position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
      background: #00c853; color: #000; border: none; border-radius: 10px;
      padding: 12px 28px; font-size: 15px; font-weight: 700; cursor: pointer;
      z-index: 2147483647; box-shadow: 0 4px 20px rgba(0,200,83,0.5);
      font-family: sans-serif; white-space: nowrap;
    `;
    return btn;
  }

  function wake(callback) {
    const port = chrome.runtime.connect({ name: 'wake' });
    setTimeout(() => { port.disconnect(); callback(); }, 300);
  }

  // Strona wątku → jeden audiobook
  if (url.includes('showthread')) {
    function findMegaLink() {
      const found = new Set();
      document.querySelectorAll('a[href*="mega.nz"]').forEach(a => found.add(a.href));
      const all = document.body.innerHTML.match(/https:\/\/mega\.nz\/[^\s"'<>\\]+/g);
      if (all) all.forEach(u => found.add(u));
      const links = [...found];
      return links.find(u => u.includes('/file/') || u.includes('/#!')) || links[0] || null;
    }

    function run() {
      const megaUrl = findMegaLink();
      if (!megaUrl) return;
      const btn = makeBtn('⬇️ &nbsp; Pobierz plik');
      btn.addEventListener('click', () => {
        btn.innerHTML = '⏳ &nbsp; Otwieranie...';
        btn.disabled = true;
        wake(() => {
          chrome.runtime.sendMessage({ action: 'openTab', url: megaUrl }, () => {
            btn.innerHTML = '✅ &nbsp; Otwarto MEGA!';
            setTimeout(() => btn.remove(), 2000);
          });
        });
      });
      document.body.appendChild(btn);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
    else run();
  }

  // Strona listy → przycisk panel
  else if (url.includes('forumdisplay') || url.includes('booksclub.pl/forum')) {
    function run() {
      const btn = makeBtn('📋 &nbsp; Pobierz listę');
      btn.addEventListener('click', () => {
        btn.innerHTML = '⏳ &nbsp; Otwieranie panelu...';
        btn.disabled = true;
        wake(() => {
          chrome.runtime.sendMessage({ action: 'openPanel' }, () => {
            btn.innerHTML = '✅ &nbsp; Panel otwarty!';
            setTimeout(() => btn.remove(), 2000);
          });
        });
      });
      document.body.appendChild(btn);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
    else run();
  }

})();