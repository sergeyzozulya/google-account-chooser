/* global SERVICE_DEFS, SERVICE_GROUPS, DASHBOARD_SECTIONS, dashboardSections, popupOrder, sectionIcon, accountKey, orderAccounts, TITLE_FORMATS, formatDate */

// Build per-service defaults from shared definitions
const DEFAULT_SERVICES = Object.fromEntries(
  Object.entries(SERVICE_DEFS).map(([host, def]) => [
    host, { ...def, intercept: true, popup: false, menu: true, skipIfUserSet: true },
  ])
);

// In-memory state (loaded from storage, then mutated on toggle)
let state = {
  enabled: true,
  dashboardNewTab: false,
  newTabTitle: '',
  actionOpens: 'popup',   // toolbar icon: 'popup' or 'sidepanel'
  popupPlacement: 'center',
  popupSize: 'custom',
  showPopupTitle: true,
  showMenuTitles: true,
  showMenuServices: true,
  showMenuGroups: true,
  keyboardNav: true,
  dashboardColumns: 'all',
  recentPerAccount: 5,
  dashboardTitleFormat: 'auto',
  dashboardOpenLinks: 'new', // 'new', 'current' or 'pinned' (new tab only from a pinned dashboard)
  popupSections: { search: false, accounts: false, tabs: false, recent: false, stats: false },
  popupOrder: [],        // launcher + dashboard section ids, in popup order
  searchButtons: { google: true, gmail: true, drive: true },
  dashboardSections: [], // [{ id, label, visible, width }] in display order
  accounts: [],          // dashboard accounts ({ index, email?, name?, photo? }) in display order
  accountOrder: [],      // accountKeys in display order
  accountLabels: {},     // accountKey → nickname
  groups: [],     // array of { label, hosts[] }
  services: {},   // host → { intercept, popup, menu }
};

function mergeDefaults(saved) {
  const merged = {};
  for (const [host, def] of Object.entries(DEFAULT_SERVICES)) {
    merged[host] = { ...def, ...(saved[host] || {}) };
  }
  return merged;
}

// Ensure every host in SERVICE_DEFS is covered by some group;
// any uncovered hosts are appended to the last group.
function reconcileGroups(groups) {
  const covered = new Set(groups.flatMap(g => g.hosts));
  const uncovered = Object.keys(SERVICE_DEFS).filter(h => !covered.has(h));
  if (uncovered.length > 0) groups[groups.length - 1].hosts.push(...uncovered);
  return groups;
}

function save() {
  const toSave = {};
  for (const [host, s] of Object.entries(state.services)) {
    toSave[host] = { intercept: s.intercept, popup: s.popup, menu: s.menu, skipIfUserSet: s.skipIfUserSet };
  }
  chrome.storage.sync.set({
    enabled: state.enabled,
    dashboardNewTab: state.dashboardNewTab,
    newTabTitle: state.newTabTitle,
    actionOpens: state.actionOpens,
    popupPlacement: state.popupPlacement,
    popupSize: state.popupSize,
    showPopupTitle: state.showPopupTitle,
    showMenuTitles: state.showMenuTitles,
    showMenuServices: state.showMenuServices,
    showMenuGroups: state.showMenuGroups,
    keyboardNav: state.keyboardNav,
    dashboardColumns: state.dashboardColumns,
    recentPerAccount: state.recentPerAccount,
    dashboardTitleFormat: state.dashboardTitleFormat,
    dashboardOpenLinks: state.dashboardOpenLinks,
    popupSections: state.popupSections,
    popupOrder: state.popupOrder,
    searchButtons: state.searchButtons,
    dashboardSections: state.dashboardSections.map(({ id, visible, width, title }) => ({ id, visible, width, title })),
    accountOrder: state.accountOrder,
    accountLabels: state.accountLabels,
    groups: state.groups.map(g => ({ id: g.id, label: g.label, hosts: [...g.hosts] })),
    services: toSave,
  });
  showToast();
}

function showToast() {
  const toast = document.getElementById('toast');
  toast.classList.add('show');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => toast.classList.remove('show'), 1800);
}

// ── Render ─────────────────────────────────────────────────────────────────

function renderRow(host, service) {
  const tr = document.createElement('tr');
  tr.dataset.host = host;
  if (!service.intercept) tr.classList.add('disabled');

  tr.innerHTML = `
    <td>
      <div class="service-name">
        <span class="drag-handle" draggable="true">${SVG_GRIP}</span>
        <div class="service-icon">${service.icon}</div>
        <div>
          <div class="service-label">${service.label}</div>
          <div class="service-host">${host}</div>
        </div>
      </div>
    </td>
    <td class="col-intercept">
      <label class="switch">
        <input type="checkbox" data-host="${host}" data-field="intercept"
               ${service.intercept ? 'checked' : ''}>
        <span class="slider"></span>
      </label>
    </td>
    <td>
      <label class="switch popup-switch">
        <input type="checkbox" data-host="${host}" data-field="popup"
               ${service.popup ? 'checked' : ''}>
        <span class="slider"></span>
      </label>
    </td>
    <td>
      <label class="switch skip-switch">
        <input type="checkbox" data-host="${host}" data-field="skipIfUserSet"
               ${service.skipIfUserSet ? 'checked' : ''}>
        <span class="slider"></span>
      </label>
    </td>
    <td class="col-menu">
      <label class="switch menu-switch">
        <input type="checkbox" data-host="${host}" data-field="menu"
               ${service.menu ? 'checked' : ''}>
        <span class="slider"></span>
      </label>
    </td>
  `;
  return tr;
}

const SVG_GRIP  = `<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" style="display:block"><circle cx="4" cy="2.5" r="1.2"/><circle cx="8" cy="2.5" r="1.2"/><circle cx="4" cy="6" r="1.2"/><circle cx="8" cy="6" r="1.2"/><circle cx="4" cy="9.5" r="1.2"/><circle cx="8" cy="9.5" r="1.2"/></svg>`;
const SVG_EDIT  = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
const SVG_CHECK = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
const SVG_TRASH = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;

function renderGroupHeader(group) {
  const tr = document.createElement('tr');
  tr.className = 'group-header';
  tr.dataset.groupId = group.id;

  const canDelete = state.groups.length > 1;

  tr.innerHTML = `
    <td>
      <div class="group-header-inner">
        <span class="drag-handle" draggable="true">${SVG_GRIP}</span>
        <span class="group-label-text">${group.label}</span>
        <input class="group-label-input" type="text" value="${group.label}" style="display:none">
        <div class="group-actions">
          <button class="group-action-btn edit-btn" title="Rename group">${SVG_EDIT}</button>
          <button class="group-action-btn save-btn" title="Save name" style="display:none">${SVG_CHECK}</button>
          <button class="group-action-btn delete-btn" title="Delete group" ${!canDelete ? 'disabled' : ''}>${SVG_TRASH}</button>
        </div>
      </div>
    </td>
    <td class="col-intercept"><label class="switch"><input type="checkbox" data-group="${group.id}" data-field="intercept"><span class="slider"></span></label></td>
    <td><label class="switch popup-switch"><input type="checkbox" data-group="${group.id}" data-field="popup"><span class="slider"></span></label></td>
    <td><label class="switch skip-switch"><input type="checkbox" data-group="${group.id}" data-field="skipIfUserSet"><span class="slider"></span></label></td>
    <td class="col-menu"><label class="switch menu-switch"><input type="checkbox" data-group="${group.id}" data-field="menu"><span class="slider"></span></label></td>
  `;

  for (const field of ['intercept', 'popup', 'menu', 'skipIfUserSet']) {
    const hosts = group.hosts.filter(h => state.services[h]);
    const count = hosts.filter(h => state.services[h][field]).length;
    const input = tr.querySelector(`[data-field="${field}"]`);
    input.checked = hosts.length > 0 && count === hosts.length;
    input.indeterminate = count > 0 && count < hosts.length;
  }

  const labelText  = tr.querySelector('.group-label-text');
  const labelInput = tr.querySelector('.group-label-input');
  const editBtn    = tr.querySelector('.edit-btn');
  const saveBtn    = tr.querySelector('.save-btn');
  const deleteBtn  = tr.querySelector('.delete-btn');

  function enterEdit() {
    labelText.style.display  = 'none';
    labelInput.style.display = '';
    editBtn.style.display    = 'none';
    saveBtn.style.display    = '';
    labelInput.focus();
    labelInput.select();
  }

  function exitEdit() {
    labelText.style.display  = '';
    labelInput.style.display = 'none';
    editBtn.style.display    = '';
    saveBtn.style.display    = 'none';
  }

  editBtn.addEventListener('click', enterEdit);

  saveBtn.addEventListener('click', () => {
    const newLabel = labelInput.value.trim();
    if (!newLabel || newLabel === group.label) { exitEdit(); return; }
    renameGroup(group.id, newLabel);
  });

  labelInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveBtn.click();
    if (e.key === 'Escape') exitEdit();
  });

  deleteBtn.addEventListener('click', () => {
    if (state.groups.length > 1) deleteGroup(group.id);
  });

  return tr;
}

function render() {
  const tbody = document.getElementById('service-list');
  tbody.innerHTML = '';
  for (const group of state.groups) {
    tbody.appendChild(renderGroupHeader(group));
    for (const host of group.hosts) {
      const service = state.services[host];
      if (service) tbody.appendChild(renderRow(host, service));
    }
  }
}

// ── Sync helpers ────────────────────────────────────────────────────────────

function syncSwitch(input, checkedCount, total) {
  input.checked = total > 0 && checkedCount === total;
  input.indeterminate = checkedCount > 0 && checkedCount < total;
}

function syncAllSwitches() {
  for (const group of state.groups) {
    const hosts = group.hosts.filter(h => state.services[h]);
    for (const field of ['intercept', 'popup', 'menu', 'skipIfUserSet']) {
      const input = document.querySelector(
        `input[data-group="${group.id}"][data-field="${field}"]`
      );
      if (!input) continue;
      const count = hosts.filter(h => state.services[h][field]).length;
      syncSwitch(input, count, hosts.length);
    }
  }
}

// ── Group management ────────────────────────────────────────────────────────

function renameGroup(id, newLabel) {
  const group = state.groups.find(g => g.id === id);
  if (!group) return;
  group.label = newLabel;
  save();
  render();
  syncAllSwitches();
}

function deleteGroup(id) {
  if (state.groups.length <= 1) return;
  const idx = state.groups.findIndex(g => g.id === id);
  if (idx === -1) return;
  const [removed] = state.groups.splice(idx, 1);
  const target = state.groups[Math.max(0, idx - 1)];
  for (const host of removed.hosts) {
    if (!target.hosts.includes(host)) target.hosts.push(host);
  }
  save();
  render();
  syncAllSwitches();
}

function addGroup() {
  state.groups.push({ id: newGroupId(), label: 'New Group', hosts: [] });
  save();
  render();
  syncAllSwitches();
  const rows = document.querySelectorAll('#service-list tr.group-header');
  rows[rows.length - 1]?.querySelector('.edit-btn')?.click();
}

// ── Drag and drop ────────────────────────────────────────────────────────────

let dragState = null;

function newGroupId() { return 'g_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

function clearDropIndicators() {
  document.querySelectorAll('#service-list .drop-above, #service-list .drop-below, #service-list .drop-into')
    .forEach(el => el.classList.remove('drop-above', 'drop-below', 'drop-into'));
}

function clearDragAll() {
  clearDropIndicators();
  document.querySelectorAll('#service-list .dragging').forEach(el => el.classList.remove('dragging'));
  dragState = null;
}

function onDragStart(e) {
  const handle = e.target.closest('.drag-handle');
  if (!handle) return;
  const tr = handle.closest('tr');
  if (!tr) return;

  if (tr.classList.contains('group-header')) {
    dragState = { type: 'group', id: tr.dataset.groupId };
  } else if (tr.dataset.host) {
    dragState = { type: 'service', host: tr.dataset.host };
  } else return;

  e.dataTransfer.effectAllowed = 'move';
  const rect = tr.getBoundingClientRect();
  e.dataTransfer.setDragImage(tr, e.clientX - rect.left, e.clientY - rect.top);
  setTimeout(() => tr.classList.add('dragging'), 0);
}

function onDragOver(e) {
  if (!dragState) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  clearDropIndicators();

  const tr = e.target.closest('tr');
  if (!tr) return;

  const isAbove = e.clientY < tr.getBoundingClientRect().top + tr.getBoundingClientRect().height / 2;

  if (dragState.type === 'group') {
    if (!tr.classList.contains('group-header') || tr.dataset.groupId === dragState.id) return;
    tr.classList.add(isAbove ? 'drop-above' : 'drop-below');
  } else {
    if (tr.classList.contains('group-header')) {
      tr.classList.add('drop-into');
    } else if (tr.dataset.host && tr.dataset.host !== dragState.host) {
      tr.classList.add(isAbove ? 'drop-above' : 'drop-below');
    }
  }
}

function onDrop(e) {
  if (!dragState) return;
  e.preventDefault();

  const tr = e.target.closest('tr');
  if (!tr) { clearDragAll(); return; }

  const isAbove = e.clientY < tr.getBoundingClientRect().top + tr.getBoundingClientRect().height / 2;

  if (dragState.type === 'group') {
    if (!tr.classList.contains('group-header')) { clearDragAll(); return; }
    const targetId = tr.dataset.groupId;
    if (targetId === dragState.id) { clearDragAll(); return; }

    const srcIdx = state.groups.findIndex(g => g.id === dragState.id);
    const [grp] = state.groups.splice(srcIdx, 1);
    let tgtIdx = state.groups.findIndex(g => g.id === targetId);
    if (!isAbove) tgtIdx++;
    state.groups.splice(tgtIdx, 0, grp);

  } else {
    const host = dragState.host;
    const srcGroup = state.groups.find(g => g.hosts.includes(host));
    if (!srcGroup) { clearDragAll(); return; }

    if (tr.classList.contains('group-header')) {
      const tgtGroup = state.groups.find(g => g.id === tr.dataset.groupId);
      if (!tgtGroup || tgtGroup === srcGroup) { clearDragAll(); return; }
      srcGroup.hosts = srcGroup.hosts.filter(h => h !== host);
      tgtGroup.hosts.push(host);

    } else if (tr.dataset.host && tr.dataset.host !== host) {
      const targetHost = tr.dataset.host;
      const tgtGroup = state.groups.find(g => g.hosts.includes(targetHost));
      if (!tgtGroup) { clearDragAll(); return; }

      const srcOrigIdx = srcGroup.hosts.indexOf(host);
      let tgtIdx = tgtGroup.hosts.indexOf(targetHost);
      if (!isAbove) tgtIdx++;
      srcGroup.hosts.splice(srcOrigIdx, 1);
      if (srcGroup === tgtGroup && srcOrigIdx < tgtIdx) tgtIdx--;
      tgtGroup.hosts.splice(tgtIdx, 0, host);

    } else { clearDragAll(); return; }
  }

  clearDragAll();
  save();
  render();
  syncAllSwitches();
}

// What the toolbar popup shows, in order: the Launcher (its own service grid, stored as
// showMenuServices) and dashboard sections
function renderPopupSections() {
  document.getElementById('popup-sections').innerHTML = state.popupOrder.map((id, i) => {
    const launcher = id === 'launcher';
    const label = launcher
      ? 'Launcher<div class="hint">Service buttons that open through Account Chooser</div>'
      : DASHBOARD_SECTIONS.find(d => d.id === id).label;
    const on = launcher ? state.showMenuServices : state.popupSections[id];
    return `
      <div class="table-row" data-index="${i}" data-popup-section="${id}">
        <span class="drag-handle" draggable="true">${SVG_GRIP}</span>
        <span class="section-icon">${sectionIcon(id)}</span>
        <div class="label">${label}</div>
        <label class="switch"><input type="checkbox" ${on ? 'checked' : ''}><span class="slider"></span></label>
      </div>`;
  }).join('');
}

document.getElementById('popup-sections').addEventListener('change', (e) => {
  const id = e.target.closest('[data-popup-section]')?.dataset.popupSection;
  if (!id) return;
  if (id === 'launcher') state.showMenuServices = e.target.checked;
  else state.popupSections[id] = e.target.checked;
  save();
});

// ── Events ─────────────────────────────────────────────────────────────────

document.getElementById('dashboard-new-tab').addEventListener('change', (e) => {
  state.dashboardNewTab = e.target.checked;
  document.getElementById('new-tab-title').disabled = !state.dashboardNewTab;
  save();
});

document.getElementById('action-opens').addEventListener('change', (e) => {
  state.actionOpens = e.target.value;
  save();
});

// Saved on Enter or leaving the field; empty means Chrome's own "New tab"
document.getElementById('new-tab-title').addEventListener('change', (e) => {
  state.newTabTitle = e.target.value.trim();
  save();
});

document.getElementById('global-toggle').addEventListener('change', (e) => {
  state.enabled = e.target.checked;
  save();
});

document.querySelectorAll('[data-search]').forEach(input => input.addEventListener('change', () => {
  state.searchButtons[input.dataset.search] = input.checked;
  save();
}));

// Dashboard title: preset formats (shown as live examples), static text, or a custom format
const titleSelect = document.getElementById('title-format');
const titleInput = document.getElementById('title-custom');
// 'preset', 'text' or 'custom'; custom stays selected even when its text matches a preset
let titleMode = 'preset';

const titleModeOf = (format) =>
  format.startsWith('text:') ? 'text' : TITLE_FORMATS.includes(format) ? 'preset' : 'custom';
const TITLE_TOKENS = ['dddd', 'ddd', 'D', 'DD', 'MMMM', 'MMM', 'M', 'MM', 'YYYY', 'YY', 'H', 'HH', 'h', 'hh', 'mm', 'ss', 'A'];

function renderTitleFormat() {
  const now = new Date();
  titleSelect.innerHTML = TITLE_FORMATS.map(f => `<option value="${esc(f)}">${esc(formatDate(now, f))}</option>`).join('')
    + '<option value="text">Text…</option><option value="custom">Custom format…</option>';
  titleSelect.value = titleMode === 'preset' ? state.dashboardTitleFormat : titleMode;
  document.getElementById('title-custom-row').hidden = titleMode === 'preset';
  document.getElementById('title-custom-label').textContent = titleMode === 'text' ? 'Title text' : 'Custom title format';
  document.getElementById('title-format-help').hidden = titleMode !== 'custom';
  titleInput.placeholder = titleMode === 'text' ? 'Dashboard' : 'dddd D MMMM · HH:mm';
  document.getElementById('title-tokens').innerHTML =
    TITLE_TOKENS.map(t => `<code>${t}</code> ${esc(formatDate(now, t))}`).join(' · ')
    + ' · <code>[text]</code> shown as is';
  previewTitle();
}

function previewTitle() {
  document.getElementById('title-preview').textContent = formatDate(new Date(), titleInput.value || 'auto');
}

titleSelect.addEventListener('change', () => {
  const previous = titleMode;
  titleMode = titleSelect.value === 'text' || titleSelect.value === 'custom' ? titleSelect.value : 'preset';
  if (titleMode === 'text') {
    if (previous !== 'text') titleInput.value = 'Dashboard';
    state.dashboardTitleFormat = `text:${titleInput.value}`;
  } else if (titleMode === 'custom') {
    // Start from the current format so there's something to edit
    if (previous !== 'custom') titleInput.value = previous === 'preset' && state.dashboardTitleFormat !== 'auto' ? state.dashboardTitleFormat : 'dddd D MMMM · HH:mm';
    state.dashboardTitleFormat = titleInput.value;
  } else {
    state.dashboardTitleFormat = titleSelect.value;
  }
  save();
  renderTitleFormat();
  if (titleMode !== 'preset') titleInput.focus();
});

titleInput.addEventListener('input', previewTitle);
// Saved on Enter or leaving the field, not per keystroke (sync storage limits writes per minute).
// An empty field goes back to the default title.
titleInput.addEventListener('change', () => {
  const value = titleInput.value.trim();
  if (!value) titleMode = 'preset';
  state.dashboardTitleFormat = !value ? 'auto' : titleMode === 'text' ? `text:${value}` : value;
  save();
  renderTitleFormat();
});

document.getElementById('recent-per-account').addEventListener('change', (e) => {
  state.recentPerAccount = Number(e.target.value);
  save();
});

document.getElementById('dashboard-open-links').addEventListener('change', (e) => {
  state.dashboardOpenLinks = e.target.value;
  save();
});

document.getElementById('dashboard-columns').addEventListener('change', (e) => {
  state.dashboardColumns = e.target.value;
  save();
});

const SECTION_WIDTHS = [['full', 'Full width'], ['two-thirds', 'Two thirds'], ['half', 'Half'], ['third', 'One third']];

const esc = (s) => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function renderDashboardSections() {
  document.getElementById('dashboard-sections').innerHTML = state.dashboardSections.map((s, i) => `
    <div class="table-row" data-index="${i}">
      <span class="drag-handle" draggable="true">${SVG_GRIP}</span>
      <span class="section-icon">${sectionIcon(s.id)}</span>
      <div class="label">${s.label}</div>
      ${s.id === 'search' ? '' : `
        <label class="inline-switch" title="Show the section title">Title
          <span class="switch"><input type="checkbox" data-field="title" ${s.title ? 'checked' : ''}><span class="slider"></span></span>
        </label>`}
      <select class="select-field" data-field="width">
        ${SECTION_WIDTHS.map(([value, label]) => `<option value="${value}" ${s.width === value ? 'selected' : ''}>${label}</option>`).join('')}
      </select>
      <label class="switch">
        <input type="checkbox" data-field="visible" ${s.visible ? 'checked' : ''}>
        <span class="slider"></span>
      </label>
    </div>`).join('');
}

function renderDashboardAccounts() {
  const el = document.getElementById('dashboard-accounts');
  if (state.accounts.length === 0) {
    el.innerHTML = '<div class="accounts-empty">No accounts detected yet — open the dashboard first.</div>';
    return;
  }
  el.innerHTML = state.accounts.map((a, i) => {
    const nickname = state.accountLabels[accountKey(a)] || '';
    const name = nickname || a.email || `Account ${a.index}`;
    const secondary = nickname ? a.email : a.name;
    const avatar = a.photo
      ? `<img class="account-avatar" src="${esc(a.photo)}" alt="">`
      : `<div class="account-avatar">${esc(name.charAt(0).toUpperCase())}</div>`;
    return `
      <div class="table-row" data-index="${i}">
        <span class="drag-handle" draggable="true">${SVG_GRIP}</span>
        ${avatar}
        <div class="label">
          <div class="group-header-inner">
            <span class="account-name">${esc(name)}</span>
            <input class="group-label-input account-name-input" type="text" value="${esc(nickname)}"
                   placeholder="${esc(a.email || '')}" style="display:none">
            <div class="group-actions">
              <button class="group-action-btn edit-btn" title="Rename account">${SVG_EDIT}</button>
              <button class="group-action-btn save-btn" title="Save name" style="display:none">${SVG_CHECK}</button>
            </div>
          </div>
          ${secondary ? `<div class="hint">${esc(secondary)}</div>` : ''}
        </div>
      </div>`;
  }).join('');
}

// Inline rename, same interaction as group names in the services table.
// An empty name (or the email itself) clears the nickname.
function editAccountName(row) {
  row.querySelector('.account-name').style.display = 'none';
  row.querySelector('.edit-btn').style.display = 'none';
  row.querySelector('.save-btn').style.display = '';
  const input = row.querySelector('.account-name-input');
  input.style.display = '';
  input.focus();
  input.select();
}

function saveAccountName(row) {
  const a = state.accounts[Number(row.dataset.index)];
  const key = accountKey(a);
  const value = row.querySelector('.account-name-input').value.trim();
  if (value !== (state.accountLabels[key] || '')) {
    if (value && value !== a.email) state.accountLabels[key] = value;
    else delete state.accountLabels[key];
    save();
  }
  renderDashboardAccounts();
}

// Drag-to-reorder for a list of .card-row[data-index] rows; onMove(from, to) updates the data
function makeSortable(container, onMove) {
  let from = null;
  const clear = () => container.querySelectorAll('.drop-above, .drop-below')
    .forEach(el => el.classList.remove('drop-above', 'drop-below'));
  const target = (e) => {
    const row = e.target.closest('[data-index]');
    if (!row || from === null) return null;
    const r = row.getBoundingClientRect();
    return { row, index: Number(row.dataset.index), above: e.clientY < r.top + r.height / 2 };
  };

  container.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.drag-handle')?.closest('[data-index]');
    if (!row) return;
    from = Number(row.dataset.index);
    e.dataTransfer.effectAllowed = 'move';
    const r = row.getBoundingClientRect();
    e.dataTransfer.setDragImage(row, e.clientX - r.left, e.clientY - r.top);
    setTimeout(() => row.classList.add('dragging'), 0);
  });
  container.addEventListener('dragover', (e) => {
    if (from === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clear();
    const t = target(e);
    if (t && t.index !== from) t.row.classList.add(t.above ? 'drop-above' : 'drop-below');
  });
  container.addEventListener('drop', (e) => {
    const t = target(e);
    if (!t) return;
    e.preventDefault();
    let to = t.index + (t.above ? 0 : 1);
    if (from < to) to--;
    if (to !== from) onMove(from, to);
  });
  container.addEventListener('dragend', () => {
    clear();
    container.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
    from = null;
  });
  container.addEventListener('dragleave', (e) => {
    if (!container.contains(e.relatedTarget)) clear();
  });
}

const move = (list, from, to) => list.splice(to, 0, list.splice(from, 1)[0]);

makeSortable(document.getElementById('dashboard-sections'), (from, to) => {
  move(state.dashboardSections, from, to);
  renderDashboardSections();
  save();
});

makeSortable(document.getElementById('popup-sections'), (from, to) => {
  move(state.popupOrder, from, to);
  renderPopupSections();
  save();
});

makeSortable(document.getElementById('dashboard-accounts'), (from, to) => {
  move(state.accounts, from, to);
  state.accountOrder = state.accounts.map(accountKey);
  renderDashboardAccounts();
  save();
});

document.getElementById('dashboard-sections').addEventListener('change', (e) => {
  const section = state.dashboardSections[Number(e.target.closest('[data-index]').dataset.index)];
  if (e.target.dataset.field === 'width') section.width = e.target.value;
  if (e.target.dataset.field === 'visible') section.visible = e.target.checked;
  if (e.target.dataset.field === 'title') section.title = e.target.checked;
  save();
});

document.getElementById('dashboard-accounts').addEventListener('click', (e) => {
  const row = e.target.closest('[data-index]');
  if (e.target.closest('.edit-btn')) editAccountName(row);
  if (e.target.closest('.save-btn')) saveAccountName(row);
});

document.getElementById('dashboard-accounts').addEventListener('keydown', (e) => {
  if (!e.target.classList.contains('account-name-input')) return;
  if (e.key === 'Enter') saveAccountName(e.target.closest('[data-index]'));
  if (e.key === 'Escape') renderDashboardAccounts();
});

document.getElementById('popup-placement').addEventListener('change', (e) => {
  state.popupPlacement = e.target.value;
  save();
});

document.getElementById('popup-size').addEventListener('change', (e) => {
  state.popupSize = e.target.value;
  save();
});

document.getElementById('show-popup-title').addEventListener('change', (e) => {
  state.showPopupTitle = e.target.checked;
  save();
});

document.getElementById('show-menu-titles').addEventListener('change', (e) => {
  state.showMenuTitles = e.target.checked;
  save();
});

document.getElementById('show-menu-groups').addEventListener('change', (e) => {
  state.showMenuGroups = e.target.checked;
  save();
});

document.getElementById('keyboard-nav').addEventListener('change', (e) => {
  state.keyboardNav = e.target.checked;
  save();
});


document.getElementById('add-group-btn').addEventListener('click', addGroup);

const serviceList = document.getElementById('service-list');
serviceList.addEventListener('dragstart', onDragStart);
serviceList.addEventListener('dragover',  onDragOver);
serviceList.addEventListener('drop',      onDrop);
serviceList.addEventListener('dragend',   clearDragAll);
serviceList.addEventListener('dragleave', (e) => {
  if (!serviceList.contains(e.relatedTarget)) clearDropIndicators();
});

// Per-row and per-group switches
document.getElementById('service-list').addEventListener('change', (e) => {
  const input = e.target;
  const field = input.dataset.field;
  if (!field) return;

  if (input.dataset.group) {
    // Group-level switch
    const group = state.groups.find(g => g.id === input.dataset.group);
    if (!group) return;
    for (const host of group.hosts.filter(h => state.services[h])) {
      state.services[host][field] = input.checked;
    }
    render();
    syncAllSwitches();
    save();
    return;
  }

  if (!input.dataset.host) return;
  const host = input.dataset.host;
  state.services[host][field] = input.checked;

  const row = input.closest('tr');
  if (field === 'intercept') {
    row.classList.toggle('disabled', !input.checked);
  }

  syncAllSwitches();
  save();
});

// ── Init ───────────────────────────────────────────────────────────────────

chrome.storage.sync.get(
  { enabled: true, dashboardNewTab: false, newTabTitle: '', actionOpens: 'popup', popupPlacement: 'center', popupSize: 'custom', showPopupTitle: true, showMenuTitles: true, showMenuServices: true, showMenuGroups: true, keyboardNav: true, dashboardColumns: 'all', recentPerAccount: 5, dashboardTitleFormat: 'auto', dashboardOpenLinks: 'new', popupSections: {}, popupOrder: null, searchButtons: {}, dashboardSections: null, accountOrder: [], accountLabels: {}, manualAccountCount: 1, groups: null, services: {} },
  (data) => {
    state.enabled = data.enabled;
    state.dashboardNewTab = data.dashboardNewTab;
    state.newTabTitle = data.newTabTitle;
    state.actionOpens = data.actionOpens;
    state.popupPlacement = data.popupPlacement;
    state.popupSize = data.popupSize;
    state.showPopupTitle = data.showPopupTitle;
    state.showMenuTitles = data.showMenuTitles;
    state.showMenuServices = data.showMenuServices;
    state.showMenuGroups = data.showMenuGroups;
    state.keyboardNav = data.keyboardNav;
    state.dashboardColumns = data.dashboardColumns;
    state.recentPerAccount = data.recentPerAccount;
    state.dashboardTitleFormat = data.dashboardTitleFormat;
    state.dashboardOpenLinks = data.dashboardOpenLinks;
    state.popupSections = { ...state.popupSections, ...data.popupSections };
    state.popupOrder = popupOrder(data.popupOrder);
    state.searchButtons = { ...state.searchButtons, ...data.searchButtons };
    state.dashboardSections = dashboardSections(data.dashboardSections);
    state.accountLabels = data.accountLabels;
    state.accountOrder = data.accountOrder;
    state.groups = data.groups
      ? reconcileGroups(data.groups.map(g => ({ id: g.id || newGroupId(), label: g.label, hosts: [...g.hosts] })))
      : SERVICE_GROUPS.map(g => ({ id: g.id, label: g.label, hosts: [...g.hosts] }));
    state.services = mergeDefaults(data.services);

    // Persist defaults for any host not yet in storage (e.g. new service added in an update)
    const missingHosts = Object.keys(DEFAULT_SERVICES).filter(h => !(h in data.services));
    if (missingHosts.length > 0) {
      const patch = { ...data.services };
      for (const host of missingHosts) {
        const s = state.services[host];
        patch[host] = { intercept: s.intercept, popup: s.popup, menu: s.menu, skipIfUserSet: s.skipIfUserSet };
      }
      chrome.storage.sync.set({ services: patch });
    }

    document.getElementById('global-toggle').checked = state.enabled;
    document.getElementById('dashboard-new-tab').checked = state.dashboardNewTab;
    document.getElementById('new-tab-title').value = state.newTabTitle;
    document.getElementById('action-opens').value = state.actionOpens;
    document.getElementById('new-tab-title').disabled = !state.dashboardNewTab;
    document.getElementById('popup-placement').value = state.popupPlacement;
    document.getElementById('popup-size').value = state.popupSize;
    document.getElementById('show-popup-title').checked = state.showPopupTitle;
    document.getElementById('show-menu-titles').checked = state.showMenuTitles;
    document.getElementById('show-menu-groups').checked = state.showMenuGroups;
    document.getElementById('keyboard-nav').checked = state.keyboardNav;
    document.getElementById('dashboard-columns').value = state.dashboardColumns;
    document.getElementById('recent-per-account').value = state.recentPerAccount;
    document.getElementById('dashboard-open-links').value = state.dashboardOpenLinks;
    titleMode = titleModeOf(state.dashboardTitleFormat);
    if (titleMode !== 'preset') titleInput.value = state.dashboardTitleFormat.replace(/^text:/, '');
    renderTitleFormat();
    document.querySelectorAll('[data-search]').forEach(input => { input.checked = state.searchButtons[input.dataset.search]; });
    renderDashboardSections();
    renderPopupSections();

    // Accounts as last detected by the dashboard, or the manual count when detection failed
    chrome.storage.local.get('accountsCache', ({ accountsCache }) => {
      const detected = accountsCache?.accounts || [];
      const list = detected.length ? detected : Array.from({ length: data.manualAccountCount }, (_, index) => ({ index }));
      state.accounts = orderAccounts(list, data.accountOrder);
      renderDashboardAccounts();
    });

    render();
    syncAllSwitches();
  }
);
