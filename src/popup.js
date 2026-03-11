/* global SERVICE_DEFS, SERVICE_GROUPS */

const menuEl = document.getElementById('service-menu');

chrome.storage.sync.get(
  { showPopupTitle: true, showMenuTitles: true, showMenuServices: true, showMenuOptions: true, services: {} },
  (data) => {

    // Show/hide header title
    document.querySelector('header').style.display = data.showPopupTitle ? '' : 'none';
    if (!data.showPopupTitle) menuEl.style.borderTop = 'none';

    // Show/hide options row
    const optionsRow = document.getElementById('options-row');
    optionsRow.style.display = data.showMenuOptions ? '' : 'none';

    // Collect services marked for the menu, preserving group order
    const menuServices = SERVICE_GROUPS
      .flatMap(g => g.hosts)
      .filter(host => {
        const def = SERVICE_DEFS[host];
        const saved = data.services[host];
        if (!def) return false;
        return saved ? saved.menu : false;
      })
      .map(host => ({ host, ...SERVICE_DEFS[host] }));

    if (data.showMenuServices && menuServices.length > 0) {
      renderMenu(menuServices, data.showMenuTitles);
      menuEl.style.display = '';
    }
  }
);

function renderMenu(services, showTitles) {
  menuEl.innerHTML = `<div class="svc-grid">${
    services.map(s => `
      <button class="svc-icon-btn" data-url="https://${s.host}/" title="${s.label}">
        <span class="ico">${s.icon}</span>
        ${showTitles ? `<span class="lbl">${s.label}</span>` : ''}
      </button>
    `).join('')
  }</div>`;

  menuEl.querySelectorAll('button[data-url]').forEach(btn => {
    btn.addEventListener('click', () => {
      chrome.tabs.create({ url: btn.dataset.url });
    });
  });
}

document.getElementById('options-row').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});
