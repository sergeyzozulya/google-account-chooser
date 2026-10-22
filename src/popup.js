/* global SERVICE_DEFS, SERVICE_GROUPS, accountServiceUrl, popupOrder, formatDate */

const menuEl = document.getElementById('service-menu');

// popup.html?account=N is the dashboard's per-account launcher (in an iframe):
// no header, links open in account N, and the dashboard handles launching and closing
const account = new URLSearchParams(location.search).get('account');
const toDashboard = (msg) => parent.postMessage(msg, location.origin);
if (account !== null) document.body.classList.add('account-mode');

// popup.html?sidepanel is shown in Chrome's side panel (Options → General → Toolbar icon opens):
// it fills the panel's width and stays open after something is opened
const sidePanel = new URLSearchParams(location.search).has('sidepanel');
if (sidePanel) document.body.classList.add('side-panel');

chrome.storage.sync.get(
  { showPopupTitle: true, popupWidth: 'auto', showMenuTitles: true, showMenuServices: true, showMenuGroups: true, showMenuOptions: true, keyboardNav: true, popupSections: {}, popupOrder: null, dashboardTitleFormat: 'auto', groups: null, services: {} },
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

    const showTitle    = account === null && data.showPopupTitle;
    const showServices = (account !== null || data.showMenuServices) && groups.length > 0;
    // Popup layout from Options → Popup; dashboard sections go above and/or below the launcher
    const shown = account === null
      ? popupOrder(data.popupOrder).filter(id => (id === 'launcher' ? showServices : data.popupSections[id]))
      : [];
    const showSections = shown.some(id => id !== 'launcher');

    if (!showTitle && !showServices && !showSections && account === null) {
      chrome.runtime.openOptionsPage();
      window.close();
      return;
    }

    // Options → Popup → Width; the side panel and the dashboard's launcher size to their frame
    if (data.popupWidth !== 'auto' && account === null && !sidePanel) document.body.style.width = `${data.popupWidth}px`;

    // Show/hide sections
    document.querySelector('header').style.display = showTitle ? '' : 'none';
    if (showTitle) renderTitle(data.dashboardTitleFormat);

    if (showServices) {
      renderMenu(groups, data.showMenuTitles, data.showMenuGroups, data.keyboardNav);
      menuEl.style.display = '';
    }

    menuEl.style.borderTop  = 'none';
    menuEl.style.paddingTop = (showServices && showTitle) ? '' : '0';

    if (showSections) {
      const at = shown.indexOf('launcher');
      if (at === -1) embedDashboard(shown, 'after');
      else {
        if (at > 0) embedDashboard(shown.slice(0, at), 'before');
        if (at < shown.length - 1) embedDashboard(shown.slice(at + 1), 'after');
      }
    }

    if (account !== null) {
      requestAnimationFrame(() => toDashboard({ type: 'resize', height: document.documentElement.scrollHeight }));
    }
  }
);

// Same title as the dashboard header (Options → Dashboard → Title), ticking while it shows time
function renderTitle(format) {
  document.querySelector('header h1').textContent = formatDate(new Date(), format);
  setTimeout(() => renderTitle(format), 1000 - (Date.now() % 1000));
}

// Dashboard sections (ids, in order) rendered by the dashboard in popup mode, placed before or
// after the launcher; each frame reports its height and asks to close the popup after opening something
function embedDashboard(ids, position) {
  document.body.classList.add('with-dashboard');
  const frame = document.createElement('iframe');
  frame.className = `dashboard-frame ${position}`;
  frame.src = `dashboard.html?popup=${ids.join(',')}`;
  menuEl[position](frame);
  window.addEventListener('message', (e) => {
    if (e.source !== frame.contentWindow) return;
    if (e.data.type === 'resize') frame.style.height = `${e.data.height}px`;
    if (e.data.type === 'close' && !sidePanel) window.close();
  });
}

if (account !== null) {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') toDashboard({ type: 'close' });
  });
}

function renderMenu(groups, showTitles, showGroups, keyboardNav) {
  const btnHtml = (s) => `
    <button class="svc-icon-btn" data-host="${s.host}"
            data-url="${account === null ? `https://${s.host}/` : accountServiceUrl(s.host, account)}" title="${s.label}">
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
    btn.addEventListener('click', (e) => {
      // window.open, unlike chrome.tabs.create, lets Chrome open the link in an installed web app
      if (account === null) window.open(btn.dataset.url, '_blank', 'noopener');
      else toDashboard({ type: 'launch', url: btn.dataset.url, service: btn.dataset.host, newTab: e.ctrlKey || e.metaKey });
    });
  });

  if (keyboardNav) initKeyboardNav();
}

document.getElementById('options-btn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById('whats-new-btn').addEventListener('click', () => {
  chrome.tabs.create({ url: 'whats-new.html' });
});

document.getElementById('dashboard-btn').addEventListener('click', () => {
  chrome.tabs.create({ url: 'dashboard.html' });
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
