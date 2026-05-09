// BooksClub Smart Downloader - Background v1.5.3
// Kluczowe:
// 1. Globalny onTabRemoved zamiast closure (przeżywa restart SW)
// 2. Alarm co 24s żeby SW nie zasnął podczas pobierania
// 3. Stan w storage - odzysk po restarcie SW
// 4. Klik przycisku MEGA w MAIN world (isTrusted: true)

let Q = [];
let active = false;
let panelTabId = null;
let sourceTabId = null;
let megaTabId = null;
let threadTabId = null;
let singleSourceTabId = null;
let queueStartTime = null;
let processingNow = false;

function saveState() {
  chrome.storage.local.set({
    bsdQ: Q, bsdActive: active,
    bsdPanel: panelTabId, bsdSource: sourceTabId,
    bsdMega: megaTabId, bsdSingle: singleSourceTabId,
    bsdStart: queueStartTime
  });
}

async function loadState() {
  return new Promise(r => chrome.storage.local.get(
    ['bsdQ','bsdActive','bsdPanel','bsdSource','bsdMega','bsdSingle','bsdStart'],
    d => {
      Q              = d.bsdQ      || [];
      active         = d.bsdActive  || false;
      panelTabId     = d.bsdPanel   || null;
      sourceTabId    = d.bsdSource  || null;
      megaTabId      = d.bsdMega    || null;
      singleSourceTabId = d.bsdSingle || null;
      queueStartTime = d.bsdStart   || null;
      r();
    }
  ));
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ downloadCount: 0, autoSaveActive: false });
});

// Alarm co 24s: trzyma SW żywym + watchdog kolejki
chrome.alarms.create('swKeepAlive', { periodInMinutes: 0.4 });
chrome.alarms.create('antiLogout',  { periodInMinutes: 3 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'swKeepAlive') {
    await loadState();
    if (!active) return;
    if (megaTabId) {
      chrome.tabs.get(megaTabId, () => {
        if (chrome.runtime.lastError) {
          console.log('[BSD BG] swKeepAlive: karta MEGA zniknęła, odzyskuję...');
          megaTabId = null;
          saveState();
          if (!processingNow) markCurrentDoneAndNext();
        }
      });
    } else if (!processingNow) {
      console.log('[BSD BG] swKeepAlive: wznawiamy processNext');
      processNext();
    }
  }

  if (alarm.name === 'antiLogout' && active && sourceTabId) {
    chrome.scripting.executeScript({
      target: { tabId: sourceTabId },
      func: () => fetch(window.location.href, { credentials: 'include', cache: 'no-cache' }).catch(() => {})
    }).catch(() => {});
  }
});

// Port z panelu
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'panel-keepalive') {
    port.onDisconnect.addListener(() => console.log('[BSD BG] Panel port rozłączony'));
  }
  if (port.name === 'mega-keepalive') {
    port.onMessage.addListener((msg) => {
      if (msg.action === 'downloadDone') onMegaDone(null, msg.title);
    });
  }
});

// Globalny onTabRemoved - przeżywa restart SW
chrome.tabs.onRemoved.addListener(async (tabId) => {
  await loadState();
  if (tabId === panelTabId) {
    panelTabId = null; active = false;
    chrome.storage.local.set({ autoSaveActive: false });
    saveState(); return;
  }
  if (tabId === megaTabId && active) {
    console.log('[BSD BG] onTabRemoved: MEGA tab zamknięta');
    megaTabId = null;
    saveState();
    markCurrentDoneAndNext();
  }
});

function markCurrentDoneAndNext() {
  const cur = Q.find(i => i.status === 'inprogress');
  if (cur) {
    cur.status = 'done';
    saveState();
    notifyPanel({ action: 'statusUpdate', id: cur.id, url: cur.url, status: 'done' });
    chrome.storage.local.get(['downloadCount'], (d) => {
      chrome.storage.local.set({ downloadCount: (d.downloadCount || 0) + 1 });
    });
    if (panelTabId) {
      chrome.tabs.get(panelTabId, () => {
        if (!chrome.runtime.lastError) chrome.tabs.update(panelTabId, { active: true });
      });
    }
  }
  setTimeout(() => processNext(), 2000);
}

// Wiadomości
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.action === 'openPanel') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      sourceTabId = tabs[0]?.id || null;
      chrome.tabs.create({ url: chrome.runtime.getURL('panel.html'), active: true }, (tab) => {
        panelTabId = tab.id;
        chrome.storage.local.set({ autoSaveActive: true });
        saveState();
      });
    });
    sendResponse({ ok: true }); return false;
  }

  if (msg.action === 'scanPage') {
    if (!sourceTabId) { sendResponse({ threads: [] }); return false; }
    chrome.scripting.executeScript({
      target: { tabId: sourceTabId }, func: scanThreadsOnPage
    }, (r) => sendResponse({ threads: r?.[0]?.result || [] }));
    return true;
  }

  if (msg.action === 'getState') {
    chrome.storage.local.get(['workFolder','downloadCount'], (d) => {
      sendResponse({ queue: Q, active, workFolder: d.workFolder||'', downloadCount: d.downloadCount||0 });
    });
    return true;
  }

  if (msg.action === 'saveFolder') {
    chrome.storage.local.set({ workFolder: msg.folder });
    sendResponse({ ok: true }); return false;
  }

  if (msg.action === 'startQueue') {
    if (msg.retry) {
      Q.forEach(i => { if (i.status === 'error') i.status = 'waiting'; });
    } else {
      Q = msg.queue.map(item => ({ ...item, status: 'waiting' }));
      queueStartTime = Date.now();
    }
    active = true;
    processingNow = false;
    panelTabId = sender.tab?.id || panelTabId;
    saveState();
    processNext();
    sendResponse({ ok: true }); return false;
  }

  if (msg.action === 'stopQueue') {
    active = false; processingNow = false;
    Q.forEach(i => { if (i.status === 'waiting') i.status = 'stopped'; });
    saveState();
    sendResponse({ ok: true }); return false;
  }

  if (msg.action === 'downloadDone') {
    onMegaDone(sender.tab?.id, msg.title);
    sendResponse({ ok: true }); return false;
  }

  if (msg.action === 'getMode') {
    sendResponse({ isBatch: active }); return false;
  }

  if (msg.action === 'openTab') {
    singleSourceTabId = sender.tab?.id || null;
    chrome.tabs.create({ url: msg.url, active: true }, (tab) => { megaTabId = tab.id; saveState(); });
    sendResponse({ ok: true }); return false;
  }

  if (msg.action === 'getSettings') {
    chrome.storage.local.get(['downloadCount','workFolder'], sendResponse);
    return true;
  }
});

// Kolejka
function processNext() {
  if (!active || processingNow) return;

  // Reset inprogress bez megaTab (SW zasnął w trakcie)
  const stuck = Q.find(i => i.status === 'inprogress');
  if (stuck && !megaTabId) {
    stuck.status = 'waiting';
    saveState();
  }

  const next = Q.find(i => i.status === 'waiting');
  if (!next) {
    const failed  = Q.filter(i => i.status === 'error').length;
    const done    = Q.filter(i => i.status === 'done').length;
    const elapsed = queueStartTime ? Math.round((Date.now() - queueStartTime) / 1000) : 0;
    active = false; processingNow = false;
    chrome.storage.local.set({ autoSaveActive: false });
    saveState();
    notifyPanel({ action: 'queueComplete', done, total: Q.length, failed, elapsed });
    return;
  }

  processingNow = true;
  next.status = 'inprogress';
  saveState();
  notifyPanel({ action: 'statusUpdate', id: next.id, url: next.url, status: 'inprogress' });
  console.log('[BSD BG] ▶', next.title);

  openThreadAndFindMega(next.url, (megaUrl) => {
    if (!megaUrl) {
      next.status = 'nofile'; processingNow = false;
      saveState();
      notifyPanel({ action: 'statusUpdate', id: next.id, url: next.url, status: 'nofile' });
      setTimeout(processNext, 2000);
      return;
    }

    chrome.tabs.create({ url: megaUrl, active: true }, (tab) => {
      megaTabId = tab.id;
      processingNow = false;
      saveState();

      // Kliknij przycisk w MAIN world po załadowaniu
      const megaLoader = (tabId, changeInfo) => {
        if (tabId !== tab.id || changeInfo.status !== 'complete') return;
        chrome.tabs.onUpdated.removeListener(megaLoader);
        setTimeout(() => clickMegaDownload(tab.id), 2500);
      };
      chrome.tabs.onUpdated.addListener(megaLoader);
    });
  });
}

function openThreadAndFindMega(threadUrl, callback) {
  chrome.tabs.create({ url: threadUrl, active: false }, (tab) => {
    threadTabId = tab.id;
    const cleanup = (result) => {
      threadTabId = null;
      chrome.tabs.get(tab.id, () => {
        if (!chrome.runtime.lastError) chrome.tabs.remove(tab.id);
      });
      callback(result);
    };
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      cleanup(null);
    }, 30000);
    const listener = (tabId, changeInfo) => {
      if (tabId !== tab.id || changeInfo.status !== 'complete') return;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      setTimeout(() => {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const found = new Set();
            document.querySelectorAll('a[href*="mega.nz"]').forEach(a => found.add(a.href));
            const all = document.body.innerHTML.match(/https:\/\/mega\.nz\/[^\s"'<>\\]+/g);
            if (all) all.forEach(u => found.add(u));
            const links = [...found];
            return links.find(u => u.includes('/file/') || u.includes('/#!')) || links[0] || null;
          }
        }, (r) => cleanup(r?.[0]?.result || null));
      }, 1500);
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function onMegaDone(tabId, title) {
  chrome.storage.local.get(['downloadCount'], (d) => {
    chrome.storage.local.set({ downloadCount: (d.downloadCount||0) + 1 });
  });
  if (singleSourceTabId) {
    chrome.tabs.get(singleSourceTabId, () => {
      if (!chrome.runtime.lastError) chrome.tabs.update(singleSourceTabId, { active: true });
    });
  }
}

// Kliknij przycisk MEGA w MAIN world (isTrusted: true)
function clickMegaDownload(tabId) {
  chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      function findBtn() {
        for (const el of document.querySelectorAll('button, a')) {
          if (!el.offsetParent) continue;
          const txt = el.textContent.trim();
          if (txt === 'Pobierz' || txt === 'Download') return el;
        }
        for (const el of document.querySelectorAll('[data-simpletip]')) {
          const tip = (el.getAttribute('data-simpletip') || '').toLowerCase();
          if (tip.includes('pobierz') || tip.includes('download')) return el;
        }
        return null;
      }
      let attempts = 0;
      const t = setInterval(() => {
        attempts++;
        const btn = findBtn();
        if (btn) { clearInterval(t); btn.click(); }
        if (attempts >= 60) clearInterval(t);
      }, 500);
    }
  }).catch(e => console.warn('[BSD BG] MAIN world error:', e));
}

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  chrome.storage.local.get(['autoSaveActive'], (d) => {
    suggest(d.autoSaveActive ? { filename: item.filename, conflictAction: 'uniquify' } : {});
  });
  return true;
});

function notifyPanel(msg) {
  if (!panelTabId) return;
  chrome.tabs.sendMessage(panelTabId, msg, () => { if (chrome.runtime.lastError) {} });
}

function scanThreadsOnPage() {
  const threads = [], seen = new Set();
  document.querySelectorAll('a[href*="showthread"]').forEach(a => {
    const href = a.href, title = a.textContent.trim();
    if (!title || title.length < 8) return;
    if (seen.has(href) || href.includes('goto=') || href.includes('#')) return;
    seen.add(href);
    threads.push({ title, url: href });
  });
  const unique = [], seenBase = new Set();
  for (const t of threads) {
    const base = t.url.split('&')[0];
    if (!seenBase.has(base)) { seenBase.add(base); unique.push({ title: t.title, url: base }); }
  }
  return unique;
}

console.log('[BSD BG] v1.5.3 załadowany');