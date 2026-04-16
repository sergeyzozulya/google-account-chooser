/* global SERVICE_DEFS, SERVICE_GROUPS */

// Build per-service defaults from shared definitions
const DEFAULT_SERVICES = Object.fromEntries(
  Object.entries(SERVICE_DEFS).map(([host, def]) => [
    host, { ...def, intercept: true, popup: false, menu: true, skipIfUserSet: true },
  ])
);

// In-memory state (loaded from storage, then mutated on toggle)
let state = {
  enabled: true,
  popupPlacement: 'center',
  popupSize: 'custom',
  showPopupTitle: true,
  showMenuTitles: true,
  showMenuServices: true,
  showMenuGroups: true,
  keyboardNav: true,
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
    popupPlacement: state.popupPlacement,
    popupSize: state.popupSize,
    showPopupTitle: state.showPopupTitle,
    showMenuTitles: state.showMenuTitles,
    showMenuServices: state.showMenuServices,
    showMenuGroups: state.showMenuGroups,
    keyboardNav: state.keyboardNav,
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

function syncMenuServicesDependents() {
  const enabled = state.showMenuServices;
  document.getElementById('show-menu-titles').disabled = !enabled;
  document.getElementById('show-menu-groups').disabled = !enabled;
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
  { enabled: true, popupPlacement: 'center', popupSize: 'custom', showPopupTitle: true, showMenuTitles: true, showMenuServices: true, showMenuGroups: true, keyboardNav: true, groups: null, services: {} },
  (data) => {
    state.enabled = data.enabled;
    state.popupPlacement = data.popupPlacement;
    state.popupSize = data.popupSize;
    state.showPopupTitle = data.showPopupTitle;
    state.showMenuTitles = data.showMenuTitles;
    state.showMenuServices = data.showMenuServices;
    state.showMenuGroups = data.showMenuGroups;
    state.keyboardNav = data.keyboardNav;
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
    document.getElementById('popup-placement').value = state.popupPlacement;
    document.getElementById('popup-size').value = state.popupSize;
    document.getElementById('show-popup-title').checked = state.showPopupTitle;
    document.getElementById('show-menu-titles').checked = state.showMenuTitles;
    document.getElementById('show-menu-services').checked = state.showMenuServices;
    document.getElementById('show-menu-groups').checked = state.showMenuGroups;
    document.getElementById('keyboard-nav').checked = state.keyboardNav;

    syncMenuServicesDependents();
    render();
    syncAllSwitches();
  }
);
