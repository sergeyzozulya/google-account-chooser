/* global SERVICE_DEFS, SERVICE_GROUPS */

const menuEl = document.getElementById('service-menu');

chrome.storage.sync.get(
  { showPopupTitle: true, showMenuTitles: true, showMenuServices: true, showMenuGroups: true, showMenuOptions: true, keyboardNav: true, groups: null, services: {} },
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
      renderMenu(groups, data.showMenuTitles, data.showMenuGroups, data.keyboardNav);
      menuEl.style.display = '';
    }

    menuEl.style.borderTop  = 'none';
    menuEl.style.paddingTop = (showServices && showTitle) ? '' : '0';
  }
);

function renderMenu(groups, showTitles, showGroups, keyboardNav) {
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

  if (keyboardNav) initKeyboardNav();
}

document.getElementById('options-btn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

function initKeyboardNav() {
  const buttons = Array.from(menuEl.querySelectorAll('button[data-url]'));
  if (buttons.length === 0) return;

  const getIndex = () => buttons.indexOf(document.activeElement);

  function getRowCols() {
    const rows = [];
    let currentRow = -1;
    let currentY = -1;
    buttons.forEach((btn, i) => {
      const y = Math.round(btn.getBoundingClientRect().top);
      if (y !== currentY) {
        currentRow++;
        currentY = y;
        rows[currentRow] = [];
      }
      rows[currentRow].push(i);
    });
    return rows;
  }

  menuEl.addEventListener('keydown', (e) => {
    const rows = getRowCols();
    const rowIndex = rows.findIndex(row => row.includes(getIndex()));
    const colIndex = rowIndex >= 0 ? rows[rowIndex].indexOf(getIndex()) : 0;
    let idx = getIndex();

    switch (e.key) {
      case 'ArrowRight':
        if (colIndex < rows[rowIndex].length - 1) idx = rows[rowIndex][colIndex + 1];
        else idx = rows[rowIndex][0];
        break;
      case 'ArrowLeft':
        if (colIndex > 0) idx = rows[rowIndex][colIndex - 1];
        else idx = rows[rowIndex][rows[rowIndex].length - 1];
        break;
      case 'ArrowDown':
        if (rowIndex < rows.length - 1) {
          idx = rows[rowIndex + 1][Math.min(colIndex, rows[rowIndex + 1].length - 1)];
        }
        break;
      case 'ArrowUp':
        if (rowIndex > 0) {
          idx = rows[rowIndex - 1][Math.min(colIndex, rows[rowIndex - 1].length - 1)];
        }
        break;
      case 'Home':       idx = rows[0][0]; break;
      case 'End':        idx = rows[rows.length - 1][rows[rows.length - 1].length - 1]; break;
      default: return;
    }

    e.preventDefault();
    buttons[idx].focus();
  });

  menuEl.tabIndex = 0;
  requestAnimationFrame(() => buttons[0].focus());
}
