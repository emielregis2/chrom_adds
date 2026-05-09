document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('ver').textContent = 'v' + chrome.runtime.getManifest().version;
  chrome.storage.local.get(['downloadCount'], (data) => {
    document.getElementById('dl-count').textContent = data.downloadCount || 0;
  });
});