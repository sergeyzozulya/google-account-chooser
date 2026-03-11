/* global SERVICE_DEFS, SERVICE_GROUPS */

// Build per-service defaults from shared definitions
const DEFAULT_SERVICES = Object.fromEntries(
  Object.entries(SERVICE_DEFS).map(([host, def]) => [
    host, { ...def, intercept: true, popup: false, menu: false, skipIfUserSet: false },
  ])
);

// In-memory state (loaded from storage, then mutated on toggle)
let state = {
  enabled: true,
  popupPlacement: 'center',
  popupSize: 'default',
  showPopupTitle: true,
  showMenuTitles: true,
  showMenuServices: true,
  showMenuOptions: true,
  services: {},   // host → { intercept, popup, menu }
};

function mergeDefaults(saved) {
  const merged = {};
  for (const [host, def] of Object.entries(DEFAULT_SERVICES)) {
    merged[host] = { ...def, ...(saved[host] || {}) };
  }
  return merged;
}

function save() {
  const toSave = {};
  for (const [host, s] of Object.entries(state.services)) {
    toSave[host] = { intercept: s.intercept, popup: s.popup, menu: s.menu, skipIfUserSet: s.skipIfUserSet };
  }
  chrome.storage.sync.set({
    enabled: state.enabled,
    popupPlacement: state.popupPlacement,
    popupSize: state.popupSize,
    showPopupTitle: state.showPopupTitle,
    showMenuTitles: state.showMenuTitles,
    showMenuServices: state.showMenuServices,
    showMenuOptions: state.showMenuOptions,
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
        <div class="service-icon">${service.icon}</div>
        <div>
          <div class="service-label">${service.label}</div>
          <div class="service-host">${host}</div>
        </div>
      </div>
    </td>
    <td>
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
      <label class="switch menu-switch">
        <input type="checkbox" data-host="${host}" data-field="menu"
               ${service.menu ? 'checked' : ''}>
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
  `;
  return tr;
}

function renderGroupHeader(group) {
  const tr = document.createElement('tr');
  tr.className = 'group-header';

  tr.innerHTML = `
    <td>${group.label}</td>
    <td><label class="switch"><input type="checkbox" data-group="${group.label}" data-field="intercept"><span class="slider"></span></label></td>
    <td><label class="switch popup-switch"><input type="checkbox" data-group="${group.label}" data-field="popup"><span class="slider"></span></label></td>
    <td><label class="switch menu-switch"><input type="checkbox" data-group="${group.label}" data-field="menu"><span class="slider"></span></label></td>
    <td><label class="switch skip-switch"><input type="checkbox" data-group="${group.label}" data-field="skipIfUserSet"><span class="slider"></span></label></td>
  `;

  // indeterminate can't be set via HTML — must be done in JS after render
  for (const field of ['intercept', 'popup', 'menu', 'skipIfUserSet']) {
    const hosts = group.hosts.filter(h => state.services[h]);
    const count = hosts.filter(h => state.services[h][field]).length;
    const input = tr.querySelector(`[data-field="${field}"]`);
    input.checked = count === hosts.length;
    input.indeterminate = count > 0 && count < hosts.length;
  }

  return tr;
}

function render() {
  const tbody = document.getElementById('service-list');
  tbody.innerHTML = '';
  for (const group of SERVICE_GROUPS) {
    tbody.appendChild(renderGroupHeader(group));
    for (const host of group.hosts) {
      const service = state.services[host];
      if (service) tbody.appendChild(renderRow(host, service));
    }
  }
}

// ── Sync helpers ────────────────────────────────────────────────────────────

function syncSwitch(input, checkedCount, total) {
  input.checked = checkedCount === total;
  input.indeterminate = checkedCount > 0 && checkedCount < total;
}

function syncAllSwitches() {
  for (const group of SERVICE_GROUPS) {
    const hosts = group.hosts.filter(h => state.services[h]);
    for (const field of ['intercept', 'popup', 'menu', 'skipIfUserSet']) {
      const input = document.querySelector(
        `input[data-group="${group.label}"][data-field="${field}"]`
      );
      if (!input) continue;
      const count = hosts.filter(h => state.services[h][field]).length;
      syncSwitch(input, count, hosts.length);
    }
  }
}

function syncMenuServicesDependents() {
  const enabled = state.showMenuServices;
  document.getElementById('show-menu-titles').disabled = !enabled;
}

// ── Events ─────────────────────────────────────────────────────────────────

document.getElementById('global-toggle').addEventListener('change', (e) => {
  state.enabled = e.target.checked;
  save();
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

document.getElementById('show-menu-services').addEventListener('change', (e) => {
  state.showMenuServices = e.target.checked;
  syncMenuServicesDependents();
  save();
});

document.getElementById('show-menu-options').addEventListener('change', (e) => {
  state.showMenuOptions = e.target.checked;
  save();
});

// Per-row and per-group switches
document.getElementById('service-list').addEventListener('change', (e) => {
  const input = e.target;
  const field = input.dataset.field;
  if (!field) return;

  if (input.dataset.group) {
    // Group-level switch
    const group = SERVICE_GROUPS.find(g => g.label === input.dataset.group);
    if (!group) return;
    for (const host of group.hosts.filter(h => state.services[h])) {
      state.services[host][field] = input.checked;
      if (field === 'intercept' && !input.checked) {
        state.services[host].popup = false;
      }
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
    if (!input.checked) {
      state.services[host].popup = false;
      row.querySelector('[data-field="popup"]').checked = false;
    }
  }

  syncAllSwitches();
  save();
});

// ── Init ───────────────────────────────────────────────────────────────────

chrome.storage.sync.get(
  { enabled: true, popupPlacement: 'center', popupSize: 'default', showPopupTitle: true, showMenuTitles: true, showMenuServices: true, showMenuOptions: true, services: {} },
  (data) => {
    state.enabled = data.enabled;
    state.popupPlacement = data.popupPlacement;
    state.popupSize = data.popupSize;
    state.showPopupTitle = data.showPopupTitle;
    state.showMenuTitles = data.showMenuTitles;
    state.showMenuServices = data.showMenuServices;
    state.showMenuOptions = data.showMenuOptions;
    state.services = mergeDefaults(data.services);

    document.getElementById('global-toggle').checked = state.enabled;
    document.getElementById('popup-placement').value = state.popupPlacement;
    document.getElementById('popup-size').value = state.popupSize;
    document.getElementById('show-popup-title').checked = state.showPopupTitle;
    document.getElementById('show-menu-titles').checked = state.showMenuTitles;
    document.getElementById('show-menu-services').checked = state.showMenuServices;
    document.getElementById('show-menu-options').checked = state.showMenuOptions;

    syncMenuServicesDependents();
    render();
    syncAllSwitches();
  }
);
