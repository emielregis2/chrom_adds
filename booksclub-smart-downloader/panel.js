// BooksClub Smart Downloader - panel.js v1.5.3

let threads = [];
let isRunning = false;

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('hdr-ver').textContent = 'v' + chrome.runtime.getManifest().version;

  const s = await msg({ action: 'getState' });
  document.getElementById('total-count').textContent = s.downloadCount || 0;

  document.getElementById('btn-rescan').addEventListener('click', scan);
  document.getElementById('btn-start').addEventListener('click', startQueue);
  document.getElementById('btn-stop').addEventListener('click', stopQueue);
  document.getElementById('btn-close').addEventListener('click', () => window.close());

  document.getElementById('check-all').addEventListener('change', (e) => {
    if (isRunning) return;
    threads.forEach(t => { if (t.status === 'waiting') t.checked = e.target.checked; });
    render(); updateToolbar();
  });

  document.getElementById('btn-settings').addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://settings/downloads' });
  });

  const keepAlivePort = chrome.runtime.connect({ name: 'panel-keepalive' });
  keepAlivePort.onDisconnect.addListener(() => console.log('[BSD Panel] Port rozłączony'));

  chrome.runtime.onMessage.addListener(onBgMsg);
  await scan();
});

async function scan() {
  show('st-scan');
  document.getElementById('btn-start').disabled = true;
  document.getElementById('done-banner').classList.remove('show');

  const res = await msg({ action: 'scanPage' });
  const found = res.threads || [];
  if (!found.length) { show('st-empty'); return; }

  const prevStatus = {};
  threads.forEach(t => { prevStatus[t.url] = t.status; });

  threads = found.map((t, i) => ({
    id: i, title: t.title, url: t.url,
    checked: prevStatus[t.url] !== 'done',
    status: prevStatus[t.url] || 'waiting'
  }));

  show('list-wrap');
  render(); syncAll(); updateToolbar();
}

function render() {
  const list = document.getElementById('thread-list');
  list.innerHTML = '';
  threads.forEach(t => {
    const row = document.createElement('div');
    row.className = `t-item ${t.status}`;
    row.id = `t-${t.id}`;
    const disabled = isRunning || ['done','nofile','error'].includes(t.status);
    row.innerHTML = `
      <div class="cb-wrap">
        <input type="checkbox" class="t-cb" data-id="${t.id}" ${t.checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
        <div class="cb-box"></div>
      </div>
      <span class="t-icon">${icon(t.status)}</span>
      <span class="t-title">${esc(t.title)}</span>
      <span class="t-badge ${bc(t.status)}">${bt(t.status)}</span>
    `;
    row.querySelector('.t-cb').addEventListener('change', (e) => {
      threads.find(x => x.id === +e.target.dataset.id).checked = e.target.checked;
      updateToolbar(); syncAll();
    });
    list.appendChild(row);
  });
  updateProgress();
}

function patchRow(url, status) {
  const t = threads.find(x => x.url === url);
  if (!t) return;
  t.status = status;
  if (status === 'done') t.checked = false;
  const row = document.getElementById(`t-${t.id}`);
  if (!row) return;
  row.className = `t-item ${status}`;
  row.querySelector('.t-icon').textContent = icon(status);
  const badge = row.querySelector('.t-badge');
  badge.className = `t-badge ${bc(status)}`;
  badge.textContent = bt(status);
  if (['done','nofile','error'].includes(status)) row.querySelector('.t-cb').disabled = true;
  updateProgress();
}

function updateToolbar() {
  const n = threads.filter(t => t.checked && t.status === 'waiting').length;
  document.getElementById('sel-count').textContent = n;
  document.getElementById('btn-start').disabled = n === 0 || isRunning;
}

function syncAll() {
  const waiting = threads.filter(t => t.status === 'waiting');
  document.getElementById('check-all').checked = waiting.length > 0 && waiting.every(t => t.checked);
}

function updateProgress() {
  const todo = threads.filter(t => t.checked || ['inprogress','done'].includes(t.status));
  const done = todo.filter(t => t.status === 'done').length;
  const total = todo.length;
  document.getElementById('prog-frac').textContent = `${done} / ${total}`;
  document.getElementById('prog-fill').style.width = total ? `${done/total*100}%` : '0%';
  const cur = threads.find(t => t.status === 'inprogress');
  if (cur) document.getElementById('prog-label').textContent = cur.title.slice(0, 60);
}

function startQueue() {
  const queue = threads.filter(t => t.checked && t.status === 'waiting').map(t => ({ id: t.id, title: t.title, url: t.url }));
  if (!queue.length) return;
  isRunning = true;
  document.getElementById('btn-start').style.display = 'none';
  document.getElementById('btn-stop').style.display = 'inline-flex';
  document.getElementById('btn-rescan').disabled = true;
  document.getElementById('progress').classList.add('show');
  document.querySelectorAll('.t-cb').forEach(c => c.disabled = true);
  document.getElementById('check-all').disabled = true;
  msg({ action: 'startQueue', queue });
}

function stopQueue() {
  msg({ action: 'stopQueue' });
  isRunning = false;
  resetUI();
}

function resetUI() {
  document.getElementById('btn-start').style.display = 'inline-flex';
  document.getElementById('btn-stop').style.display = 'none';
  document.getElementById('btn-rescan').disabled = false;
  document.getElementById('check-all').disabled = false;
  updateToolbar();
  threads.forEach(t => {
    const cb = document.querySelector(`.t-cb[data-id="${t.id}"]`);
    if (cb && t.status === 'waiting') cb.disabled = false;
  });
}

function onBgMsg(m) {
  if (m.action === 'statusUpdate') {
    if (m.url) patchRow(m.url, m.status);
  }
  if (m.action === 'queueComplete') {
    isRunning = false;
    resetUI();
    document.getElementById('progress').classList.remove('show');
    const done = m.done || 0, failed = m.failed || 0, elapsed = m.elapsed || 0;
    document.getElementById('done-title').textContent = failed > 0 ? '⚠ Completed with issues' : '✓ All done';
    document.getElementById('done-text').textContent = `Downloaded: ${done}  |  Failed: ${failed}  |  Total: ${m.total || threads.length}`;
    const mins = Math.floor(elapsed / 60), secs = elapsed % 60;
    document.getElementById('done-time').textContent = `Total time: ${mins > 0 ? mins + 'm ' : ''}${secs}s`;
    document.getElementById('btn-retry').style.display = 'none';
    if (failed > 0) {
      document.getElementById('done-text').textContent += ' — retrying automatically...';
      setTimeout(() => {
        document.getElementById('done-banner').classList.remove('show');
        threads.forEach(t => {
          if (t.status === 'error') { t.status = 'waiting'; t.checked = true; patchRow(t.url, 'waiting'); }
        });
        isRunning = true;
        document.getElementById('btn-start').style.display = 'none';
        document.getElementById('btn-stop').style.display = 'inline-flex';
        document.getElementById('progress').classList.add('show');
        msg({ action: 'startQueue', queue: [], retry: true });
      }, 3000);
    }
    document.getElementById('done-banner').classList.add('show');
    msg({ action: 'getState' }).then(s => { document.getElementById('total-count').textContent = s.downloadCount || 0; });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function show(id) {
  ['st-scan','st-empty','list-wrap'].forEach(x => {
    const el = document.getElementById(x);
    if (el) el.style.display = x === id ? (x === 'list-wrap' ? 'block' : 'flex') : 'none';
  });
}
function icon(s) { return {inprogress:'↻',done:'✓',nofile:'–',error:'✗'}[s] || ''; }
function bc(s) { return {waiting:'b-wait',inprogress:'b-prog',done:'b-done',nofile:'b-none',error:'b-err'}[s]||'b-wait'; }
function bt(s) { return {waiting:'waiting',inprogress:'in progress',done:'done',nofile:'no file',error:'error',stopped:'skipped'}[s]||''; }
function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function msg(m) {
  return new Promise(res => chrome.runtime.sendMessage(m, r => {
    if (chrome.runtime.lastError) { res({}); return; }
    res(r || {});
  }));
}