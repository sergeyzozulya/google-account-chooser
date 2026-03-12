/* global SERVICE_DEFS, SERVICE_GROUPS */

const menuEl = document.getElementById('service-menu');

chrome.storage.sync.get(
  { showPopupTitle: true, showMenuTitles: true, showMenuServices: true, showMenuGroups: true, showMenuOptions: true, groups: null, services: {} },
  (data) => {
    const activeGroups = data.groups || SERVICE_GROUPS;

    // Collect services marked for the menu, grouped
    const groups = activeGroups
      .map(g => ({
        label: g.label,
        services: g.hosts
          .filter(host => {
            const def = SERVICE_DEFS[host];
            const saved = data.services[host];
            return def && (saved ? saved.menu !== false : true);
          })
          .map(host => ({ host, ...SERVICE_DEFS[host] })),
      }))
      .filter(g => g.services.length > 0);

    const showTitle    = data.showPopupTitle;
    const showServices = data.showMenuServices && groups.length > 0;

    if (!showTitle && !showServices) {
      chrome.runtime.openOptionsPage();
      window.close();
      return;
    }

    // Show/hide sections
    document.querySelector('header').style.display = showTitle ? '' : 'none';

    if (showServices) {
      renderMenu(groups, data.showMenuTitles, data.showMenuGroups);
      menuEl.style.display = '';
    }

    menuEl.style.borderTop  = 'none';
    menuEl.style.paddingTop = (showServices && showTitle) ? '' : '0';
  }
);

function renderMenu(groups, showTitles, showGroups) {
  const btnHtml = (s) => `
    <button class="svc-icon-btn" data-url="https://${s.host}/" title="${s.label}">
      <span class="ico">${s.icon}</span>
      ${showTitles ? `<span class="lbl">${s.label}</span>` : ''}
    </button>`;

  if (showGroups) {
    menuEl.innerHTML = groups.map(g => `
      <div class="svc-group">
        <div class="svc-group-label">${g.label}</div>
        <div class="svc-grid">${g.services.map(btnHtml).join('')}</div>
      </div>
    `).join('');
  } else {
    const allServices = groups.flatMap(g => g.services);
    menuEl.innerHTML = `<div class="svc-grid">${allServices.map(btnHtml).join('')}</div>`;
  }

  menuEl.querySelectorAll('button[data-url]').forEach(btn => {
    btn.addEventListener('click', () => {
      chrome.tabs.create({ url: btn.dataset.url });
    });
  });
}

document.getElementById('options-btn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});
