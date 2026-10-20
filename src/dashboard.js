/* global SERVICE_DEFS, DASHBOARD_SECTIONS, accountFromUrl, accountServiceUrl, accountKey, orderAccounts, dashboardSections, sectionIcon, formatDate */

const DOCS_KINDS = {
  document:     'docs.google.com',
  spreadsheets: 'sheets.google.com',
  presentation: 'slides.google.com',
  forms:        'forms.google.com',
};

const SECTION_SPANS = { full: 12, 'two-thirds': 8, half: 6, third: 4 };

const SVG_APPS = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">${
  [5, 12, 19].flatMap(y => [5, 12, 19].map(x => `<circle cx="${x}" cy="${y}" r="2.2"/>`)).join('')}</svg>`;

const REFRESH_MS = 2 * 60 * 1000;
const HISTORY_DAYS = 30;
const MAX_ACCOUNTS = 10;

let accounts = [];       // [{ index, email?, name?, photo? }]
let detected = false;    // accounts came from Google rather than the manual count
let detecting = true;    // first detection still running and nothing cached
let unread = {};         // account index → Gmail unread count
let accountLabels = {};  // accountKey → nickname (edited in Options)
let accountOrder = [];   // accountKeys in display order (edited in Options)
let manualCount = 1;
let columns = 'all';     // accounts per row: 'all' or a number as a string
let recentPerAccount = 5;
let titleFormat = 'auto';  // see formatDate in services-data.js
let openLinks = 'new';   // where links open: 'new' tab, 'current' tab, or 'pinned' (new tab only from a pinned dashboard)
let sections = [];       // [{ id, label, visible, width, title }] in display order
let launcherFrame = null;
let searchButtons = { google: true, gmail: true, drive: true };
const searchAccount = {};  // search target → account index chosen in its split button

const esc = (s) => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const displayName = (a) => accountLabels[accountKey(a)] || a.email || `Account ${a.index}`;

// Service host for a URL, mapping docs.google.com paths to Sheets/Slides/Forms
function serviceForUrl(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.hostname === 'docs.google.com') return DOCS_KINDS[u.pathname.split('/')[1]] || 'docs.google.com';
  return SERVICE_DEFS[u.hostname] ? u.hostname : null;
}

// Resolve an account index or email (as found in a URL) to a known account
function findAccount(key) {
  return /^\d+$/.test(key)
    ? accounts.find(a => a.index === Number(key))
    : accounts.find(a => a.email === key);
}

function accountLabel(key) {
  const acct = findAccount(key);
  if (acct) return displayName(acct);
  return /^\d+$/.test(key) ? `Account ${key}` : key;
}

// Profile photo, or the first letter of the account's display name
function avatarHtml(photo, name, cls = 'avatar') {
  return photo
    ? `<img class="${cls}" src="${esc(photo)}" alt="">`
    : `<span class="${cls}">${esc(name.charAt(0).toUpperCase())}</span>`;
}

const accountIcon = (key) => avatarHtml(findAccount(key)?.photo, accountLabel(key), 'avatar sm');

// Open a dashboard link. When the URL names the account, the background opens it without
// Account Chooser; otherwise (e.g. a recent file with no account in its URL) it's intercepted as usual.
// With tabId, the link replaces the dashboard in that tab.
function launch(url, service, tabId) {
  // Not a Google service (e.g. a bookmark), or no account in the URL: open normally
  const opened = !service || accountFromUrl(url) === null
    ? (tabId ? chrome.tabs.update(tabId, { url }) : chrome.tabs.create({ url }))
    : chrome.runtime.sendMessage({ type: 'open', url, service, tabId });
  opened.then(closePopup);
}

// The dashboard's tab id when a link should open in place (Options → Dashboard → Open links).
// Ctrl/⌘-click always opens a new tab, and so does the popup.
async function inPlaceTabId(newTab) {
  if (embedded || newTab || openLinks === 'new') return undefined;
  const tab = await chrome.tabs.getCurrent();
  return openLinks === 'pinned' && tab.pinned ? undefined : tab.id;
}

// ── Popup mode ─────────────────────────────────────────────────────────────

// dashboard.html?popup=search,accounts,… is embedded in the toolbar popup: no header, one
// column, just the listed sections in that order, and the popup closes once something opens
const popupIds = new URLSearchParams(location.search).get('popup')?.split(',');
const embedded = popupIds !== undefined;

// dashboard.html?newtab replaces Chrome's New Tab page (Options → General) and takes its tab title
const isNewTab = new URLSearchParams(location.search).has('newtab');
const NEW_TAB_TITLE = 'New tab';
const toPopup = (msg) => parent.postMessage(msg, location.origin);

function closePopup() {
  if (embedded) toPopup({ type: 'close' });
}

// Content height (the launcher expands inline here). Not documentElement.scrollHeight: it never
// drops below the frame's current height, so the popup could grow but never shrink back.
function postHeight() {
  if (embedded) toPopup({ type: 'resize', height: Math.ceil(document.body.getBoundingClientRect().height) });
}

// ── Header clock ───────────────────────────────────────────────────────────

let _clockTimer = null;
function renderClock() {
  document.getElementById('now').textContent = formatDate(new Date(), titleFormat);
  clearTimeout(_clockTimer);
  _clockTimer = setTimeout(renderClock, 1000 - (Date.now() % 1000));
}

// ── Layout ─────────────────────────────────────────────────────────────────

// Section icons, shared with the section list in Options
function addSectionIcons() {
  document.querySelector('.search-field').insertAdjacentHTML('afterbegin', sectionIcon('search'));
  for (const el of document.querySelectorAll('#sections > [data-section]')) {
    el.querySelector('.section-head h2')?.insertAdjacentHTML('afterbegin', sectionIcon(el.dataset.section, 16));
  }
}

function applyLayout() {
  const container = document.getElementById('sections');
  for (const s of sections) {
    const el = container.querySelector(`:scope > [data-section="${s.id}"]`);
    // Search has nothing to offer with every search button turned off
    el.hidden = !s.visible || (s.id === 'search' && !Object.values(searchButtons).some(Boolean));
    el.style.gridColumn = `span ${SECTION_SPANS[s.width]}`;
    el.classList.toggle('no-title', !s.title);
    container.append(el);
  }
}

function applyColumns() {
  const count = columns === 'all' ? Math.max(accounts.length, 1) : Number(columns);
  document.getElementById('accounts').style.gridTemplateColumns = `repeat(${count}, minmax(0, 1fr))`;
}

// ── Accounts ───────────────────────────────────────────────────────────────

// Google's own account-switcher endpoint (undocumented). It rejects requests with an
// extension Origin, so rules.json strips that header from requests marked gac=1.
async function listAccounts() {
  try {
    const res = await fetch('https://accounts.google.com/ListAccounts?gac=1&gpsia=1&source=ogb&json=standard',
      { method: 'POST', credentials: 'include' });
    if (!res.ok) return [];
    const text = await res.text();
    const data = JSON.parse(text.slice(text.indexOf('[')));
    return (data[1] || [])
      .map((entry, index) => {
        const email = entry.find(v => typeof v === 'string' && v.includes('@'));
        const before = entry[entry.indexOf(email) - 1];
        return {
          index,
          email,
          name: typeof before === 'string' ? before : null,
          photo: entry.find(v => typeof v === 'string' && v.startsWith('https://')) || null,
        };
      })
      .filter(a => a.email);
  } catch {
    return [];
  }
}

// Gmail's Atom feed gives the unread count and names the account in its title
// ("Gmail - Inbox for user@example.com"); null when the slot has no feed
async function fetchInbox(n) {
  try {
    const res = await fetch(`https://mail.google.com/mail/u/${n}/feed/atom`, { credentials: 'include' });
    const doc = new DOMParser().parseFromString(await res.text(), 'text/xml');
    const count = doc.getElementsByTagName('fullcount')[0];
    if (!count) return null;
    const title = doc.getElementsByTagName('title')[0]?.textContent || '';
    return { count: Number(count.textContent), email: title.match(/\S+@\S+/)?.[0] ?? null };
  } catch {
    return null;
  }
}

// Fallback: probe /u/0/, /u/1/, … until a slot has no feed or repeats an account already found
async function probeGmailFeeds() {
  const found = [];
  for (let index = 0; index < MAX_ACCOUNTS; index++) {
    const inbox = await fetchInbox(index);
    if (!inbox?.email || found.some(a => a.email === inbox.email)) break;
    found.push({ index, email: inbox.email });
  }
  return found;
}

async function detectAccounts() {
  const listed = await listAccounts();
  return listed.length ? listed : probeGmailFeeds();
}

function saveCache() {
  if (detected) chrome.storage.local.set({ accountsCache: { accounts, unread } });
}

// Re-detect accounts and unread counts; the page renders from cache meanwhile
async function refresh() {
  const found = await detectAccounts();
  const wasDetecting = detecting;
  detecting = false;

  if (found.length > 0) {
    const changed = !detected || JSON.stringify(found) !== JSON.stringify(accounts);
    accounts = found;
    detected = true;
    if (changed) renderAll();
  } else if (!detected && wasDetecting) {
    // Nothing detected and nothing cached: fall back to the manual account count
    accounts = Array.from({ length: manualCount }, (_, index) => ({ index }));
    renderAll();
  }

  await Promise.all(accounts.map(async (a) => {
    const inbox = await fetchInbox(a.index);
    if (inbox) unread[a.index] = inbox.count;
    else delete unread[a.index];
  }));
  renderUnread();
  saveCache();
  chrome.runtime.sendMessage({ type: 'unread', unread });
}

function renderAccounts() {
  const el = document.getElementById('accounts');
  const gmail = SERVICE_DEFS['mail.google.com'];
  applyColumns();

  el.innerHTML = orderAccounts(accounts, accountOrder).map(a => {
    const name = displayName(a);
    const secondary = accountLabels[accountKey(a)] ? a.email : a.name;

    return `
      <section class="card" data-index="${a.index}">
        <div class="acct-head">
          ${avatarHtml(a.photo, name)}
          <div class="acct-id">
            <div class="acct-name">${esc(name)}</div>
            ${secondary ? `<div class="acct-email">${esc(secondary)}</div>` : ''}
          </div>
          <button class="unread" data-url="${esc(accountServiceUrl('mail.google.com', a.index))}"
                  data-service="mail.google.com" title="Open Gmail inbox" hidden>
            ${gmail.icon}<b></b>
          </button>
          <button class="icon-btn" data-launcher="${a.index}" title="Google apps">${SVG_APPS}</button>
        </div>
      </section>`;
  }).join('');

  document.getElementById('accounts-hint').textContent =
    detected  ? 'Signed-in accounts detected from your Google session.' :
    detecting ? 'Detecting signed-in accounts…' :
                'Couldn\'t detect signed-in accounts — set how many you use.';
  document.getElementById('account-stepper').hidden = detected || detecting;

  renderSearch();
  renderUnread();
}

function renderUnread() {
  for (const a of accounts) {
    const btn = document.querySelector(`section[data-index="${a.index}"] .unread`);
    if (!btn) continue;
    btn.hidden = !(a.index in unread);
    btn.classList.toggle('empty-inbox', unread[a.index] === 0);
    btn.querySelector('b').textContent = unread[a.index] > 999 ? '999+' : unread[a.index] ?? '';
  }
}

function setManualCount(count) {
  manualCount = count;
  accounts = Array.from({ length: count }, (_, index) => ({ index }));
  chrome.storage.sync.set({ manualAccountCount: count });
  renderAll();
}

// ── Search ─────────────────────────────────────────────────────────────────

// In button order; the first visible one is the default for Enter
const SEARCH_TARGETS = {
  google: { label: 'Google', url: (q) => `https://www.google.com/search?q=${q}` },
  gmail:  { label: 'Gmail', service: 'mail.google.com',  url: (q, n) => `https://mail.google.com/mail/u/${n}/#search/${q}` },
  drive:  { label: 'Drive', service: 'drive.google.com', url: (q, n) => `https://drive.google.com/drive/u/${n}/search?q=${q}` },
};

const searchButtonsEl = document.getElementById('search-buttons');

function renderSearch() {
  const list = orderAccounts(accounts, accountOrder);
  const shown = Object.keys(SEARCH_TARGETS).filter(t => searchButtons[t]);

  searchButtonsEl.innerHTML = shown.map((t, i) => {
    const cls = i === 0 ? 'search-default' : '';
    if (t === 'google') return `<button type="submit" value="google" class="${cls}">Google</button>`;

    if (!list.some(a => a.index === searchAccount[t])) searchAccount[t] = list[0]?.index ?? 0;
    const current = list.find(a => a.index === searchAccount[t]);
    const title = `${current ? `${displayName(current)} ` : ''}${SEARCH_TARGETS[t].label}`;
    return `
      <div class="split" data-target="${t}">
        <button type="submit" value="${t}" class="split-main ${cls}" title="${esc(title)}">${esc(title)}</button>
        <button type="button" class="split-toggle" title="Choose account" aria-haspopup="listbox" aria-expanded="false"></button>
        <div class="picker-menu" role="listbox" hidden>
          ${list.map(a => `
            <button type="button" class="picker-option" role="option" data-account="${a.index}"
                    aria-selected="${a.index === searchAccount[t]}">
              ${avatarHtml(a.photo, displayName(a), 'avatar sm')}<span>${esc(displayName(a))}</span>
            </button>`).join('')}
        </div>
      </div>`;
  }).join('');
}

function toggleMenu(split, open) {
  const menu = split.querySelector('.picker-menu');
  menu.hidden = !open;
  split.querySelector('.split-toggle').setAttribute('aria-expanded', open);
  if (open) (menu.querySelector('[aria-selected="true"]') || menu.firstElementChild)?.focus();
}

function closeMenus() {
  searchButtonsEl.querySelectorAll('.split').forEach(split => toggleMenu(split, false));
}

searchButtonsEl.addEventListener('click', (e) => {
  const split = e.target.closest('.split');
  if (!split) return;
  if (e.target.closest('.split-toggle')) {
    const open = split.querySelector('.picker-menu').hidden;
    closeMenus();
    toggleMenu(split, open);
    return;
  }
  const option = e.target.closest('[data-account]');
  if (option) {
    searchAccount[split.dataset.target] = Number(option.dataset.account);
    renderSearch();
    document.getElementById('q').focus();
  }
});

searchButtonsEl.addEventListener('keydown', (e) => {
  const split = e.target.closest('.split');
  if (!split) return;
  if (e.target.closest('.split-toggle')) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    closeMenus();
    toggleMenu(split, true);
  } else if (e.target.closest('.picker-menu')) {
    const options = [...split.querySelectorAll('.picker-option')];
    const i = options.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') options[Math.min(i + 1, options.length - 1)].focus();
    else if (e.key === 'ArrowUp') options[Math.max(i - 1, 0)].focus();
    else if (e.key === 'Escape') { toggleMenu(split, false); split.querySelector('.split-toggle').focus(); }
    else return;
  } else return;
  e.preventDefault();
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('#search .split')) closeMenus();
});

// ── Per-account launcher (the extension popup in account mode) ─────────────

function openLauncher(btn) {
  const index = btn.dataset.launcher;
  const wasOpen = launcherFrame?.dataset.index === index;
  closeLauncher();
  if (wasOpen) return;

  const frame = document.createElement('iframe');
  frame.className = 'launcher';
  frame.dataset.index = index;
  frame.src = `popup.html?account=${index}`;
  frame.addEventListener('load', () => frame.contentWindow.focus());
  if (embedded) {
    // In the toolbar popup there's no room for a floating panel: expand inside the account card
    frame.classList.add('inline');
    btn.closest('section.card').append(frame);
  } else {
    const r = btn.getBoundingClientRect();
    frame.style.top = `${r.bottom + scrollY + 6}px`;
    frame.style.left = `${Math.max(8, r.right + scrollX - 300)}px`;
    document.body.append(frame);
  }
  launcherFrame = frame;
}

function closeLauncher() {
  launcherFrame?.remove();
  launcherFrame = null;
  postHeight();
}

window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || e.source !== launcherFrame?.contentWindow) return;
  const msg = e.data;
  if (msg.type === 'resize') {
    launcherFrame.style.height = `${msg.height + (embedded ? 1 : 2)}px`;
    postHeight();
  }
  if (msg.type === 'close') closeLauncher();
  if (msg.type === 'launch') {
    closeLauncher();
    inPlaceTabId(msg.newTab).then(tabId => launch(msg.url, msg.service, tabId));
  }
});

// Only width changes move the launcher's anchor; in the popup, opening the launcher itself
// grows the frame's height, which must not close it again
let lastWidth = innerWidth;
window.addEventListener('resize', () => {
  if (innerWidth === lastWidth) return;
  lastWidth = innerWidth;
  closeLauncher();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeLauncher();
});

// ── Open tabs ──────────────────────────────────────────────────────────────

// Items with a url, grouped by account key in order of first appearance.
// URLs without an explicit account are grouped under `fallback`.
function groupByAccount(items, fallback) {
  const groups = new Map();
  for (const item of items) {
    const key = accountFromUrl(item.url) ?? fallback;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

async function renderTabs() {
  const el = document.getElementById('tabs');
  const tabs = (await chrome.tabs.query({})).filter(t => t.url && serviceForUrl(t.url));

  if (tabs.length === 0) {
    el.innerHTML = '<div class="empty">No Google service tabs are open.</div>';
    return;
  }

  // A tab without an explicit account shows the default account (index 0)
  el.innerHTML = [...groupByAccount(tabs, '0')].map(([key, list]) => `
    <div class="group-label">${accountIcon(key)}${esc(accountLabel(key))}</div>
    ${list.map(t => `
      <button class="row" data-tab="${t.id}" data-window="${t.windowId}" title="${esc(t.url)}">
        ${SERVICE_DEFS[serviceForUrl(t.url)].icon}
        <span class="title">${esc(t.title || t.url)}</span>
      </button>`).join('')}
  `).join('');
}

let _tabsTimer = null;
function scheduleRenderTabs() {
  clearTimeout(_tabsTimer);
  _tabsTimer = setTimeout(renderTabs, 200);
}

// ── Recent files (optional history permission) ─────────────────────────────

function relativeTime(ms) {
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 60) return `${Math.max(minutes, 1)}m`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}

async function renderRecent() {
  const el = document.getElementById('recent');
  const granted = await chrome.permissions.contains({ permissions: ['history'] });
  document.getElementById('recent-clear').hidden = !granted;

  if (!granted) {
    el.innerHTML = `
      <div class="empty">
        Show Docs, Sheets, Slides and Forms you opened recently, read from your browser history.
        History stays on this device.<br>
        <button class="text-btn" id="history-on">Turn on</button>
      </div>`;
    return;
  }

  const items = await chrome.history.search({
    text: 'docs.google.com',
    // Clear only hides files opened before it was pressed
    startTime: Math.max(Date.now() - HISTORY_DAYS * 864e5, (await chrome.storage.local.get({ recentClearedAt: 0 })).recentClearedAt),
    maxResults: 1000,
  });
  items.sort((a, b) => b.lastVisitTime - a.lastVisitTime);

  // One entry per document, newest visit first. Docs URLs often omit the account, so take it
  // from any visited URL of the same document and add it to the newest URL as authuser.
  const files = new Map();
  for (const item of items) {
    const m = item.url.match(/^https:\/\/docs\.google\.com\/(document|spreadsheets|presentation|forms)\/(?:u\/\d+\/)?d\/(?:e\/)?([\w-]+)/);
    if (!m) continue;
    if (!files.has(m[2])) files.set(m[2], { ...item, service: DOCS_KINDS[m[1]] });
    const file = files.get(m[2]);
    const account = accountFromUrl(item.url);
    if (account !== null && accountFromUrl(file.url) === null) {
      const url = new URL(file.url);
      url.searchParams.set('authuser', account);
      file.url = url.href;
    }
  }

  if (files.size === 0) {
    el.innerHTML = `<div class="empty">No recently opened files.</div>`;
    return;
  }

  // Files whose account can't be told go last; opening them goes through Account Chooser
  const groups = [...groupByAccount(files.values(), null)].sort(([a], [b]) => (a === null) - (b === null));
  el.innerHTML = groups.map(([key, list]) => `
    <div class="group-label">${key === null
      ? `${sectionIcon('accounts')}Account not known`
      : `${accountIcon(key)}${esc(accountLabel(key))}`}</div>
    ${list.slice(0, recentPerAccount).map(f => `
      <button class="row" data-url="${esc(f.url)}" data-service="${f.service}" title="${esc(f.url)}">
        ${SERVICE_DEFS[f.service].icon}
        <span class="title">${esc((f.title || f.url).replace(/ - Google (Docs|Sheets|Slides|Forms)$/, ''))}</span>
        <span class="meta">${relativeTime(f.lastVisitTime)}</span>
      </button>`).join('')}
  `).join('');
}

// ── Bookmarks bar (optional bookmarks + favicon permissions) ───────────────
// Modelled on Chrome's bookmarks bar, since the dashboard can replace the New Tab page:
// bar items in order, folders open bookmarkMenus (subfolders open to the side), items that don't
// fit go behind », and Other bookmarks sits on the right.

const BOOKMARK_PERMISSIONS = { permissions: ['bookmarks', 'favicon'] };
const svg = (body, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const SVG_FOLDER = svg('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>');
const SVG_CHEVRON = svg('<polyline points="9 18 15 12 9 6"/>', 'chevron');
const bookmarkBar = document.getElementById('bookmark-bar');
let bookmarkNodes = new Map(); // id → node, for opening folder bookmarkMenus
let bookmarkListeners = false;
let bookmarkMenus = [];        // open menus, outermost first: { el, anchor }

// Google services get their own icon; other sites use Chrome's favicon cache
function bookmarkIcon(url) {
  const service = serviceForUrl(url);
  if (service) return SERVICE_DEFS[service].icon;
  return `<img src="${chrome.runtime.getURL('/_favicon/')}?pageUrl=${encodeURIComponent(url)}&size=32" alt="">`;
}

// Bar button for a bookmark or folder
const barButton = (node) => node.url
  ? `<button class="bm-btn" data-bookmark="${node.id}" title="${esc(`${node.title}\n${node.url}`)}">${bookmarkIcon(node.url)}${node.title ? `<span>${esc(node.title)}</span>` : ''}</button>`
  : `<button class="bm-btn" data-folder="${node.id}" aria-expanded="false" title="${esc(node.title)}">${SVG_FOLDER}<span>${esc(node.title)}</span></button>`;

async function renderBookmarks() {
  closeBookmarkMenus();
  if (!await chrome.permissions.contains(BOOKMARK_PERMISSIONS)) {
    bookmarkBar.innerHTML = `<div class="empty">Bookmarks bar<button class="text-btn" id="bookmarks-on">Turn on</button></div>`;
    return;
  }
  if (!bookmarkListeners) {
    bookmarkListeners = true;
    for (const event of ['onCreated', 'onRemoved', 'onChanged', 'onMoved', 'onChildrenReordered']) {
      chrome.bookmarks[event].addListener(renderBookmarks);
    }
  }

  const [root] = await chrome.bookmarks.getTree();
  bookmarkNodes = new Map();
  (function index(node) { bookmarkNodes.set(node.id, node); node.children?.forEach(index); })(root);
  const bar = root.children.find(n => n.folderType === 'bookmarks-bar') || root.children[0];
  const other = root.children.find(n => n.folderType === 'other') || root.children[1];

  bookmarkBar.innerHTML = `
    <div class="bm-items">${bar.children.map(barButton).join('')
      || '<div class="empty">For quick access, place your bookmarks here on the bookmarks bar.</div>'}</div>
    <button class="bm-btn bm-overflow" data-folder="overflow" aria-expanded="false" title="More bookmarks" hidden>»</button>
    ${other?.children.length ? barButton(other) : ''}`;
  fitBookmarks();
}

// Hide bar items that don't fit; they're listed in the » menu instead
function fitBookmarks() {
  const items = bookmarkBar.querySelector('.bm-items');
  const overflowBtn = bookmarkBar.querySelector('.bm-overflow');
  if (!items || !overflowBtn) return;
  const buttons = [...items.querySelectorAll('.bm-btn')];
  buttons.forEach(b => { b.hidden = false; });
  overflowBtn.hidden = false; // reserve its space while measuring
  const limit = items.getBoundingClientRect().right;
  const hidden = buttons.filter(b => b.getBoundingClientRect().right > limit + 0.5);
  hidden.forEach(b => { b.hidden = true; });
  overflowBtn.hidden = hidden.length === 0;
}

new ResizeObserver(() => { closeBookmarkMenus(); fitBookmarks(); }).observe(bookmarkBar);

function menuItem(node) {
  if (node.url) return `<button data-bookmark="${node.id}" title="${esc(node.url)}">${bookmarkIcon(node.url)}<span>${esc(node.title || node.url)}</span></button>`;
  return `<button data-folder="${node.id}">${SVG_FOLDER}<span>${esc(node.title)}</span>${SVG_CHEVRON}</button>`;
}

// Open a folder's menu at `level` (0 = from the bar, below the button; deeper = beside the item)
function openBookmarkMenu(anchor, level) {
  closeBookmarkMenus(level);
  const id = anchor.dataset.folder;
  const nodes = id === 'overflow'
    ? [...bookmarkBar.querySelectorAll('.bm-items .bm-btn[hidden]')].map(b => bookmarkNodes.get(b.dataset.bookmark || b.dataset.folder))
    : bookmarkNodes.get(id).children;

  const el = document.createElement('div');
  el.className = 'bm-menu';
  el.innerHTML = nodes.length ? nodes.map(menuItem).join('') : '<div class="empty">(empty)</div>';
  document.body.append(el);

  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  let left = level === 0 ? r.left : r.right - 4;
  if (left + w > innerWidth - 8) left = level === 0 ? innerWidth - 8 - w : r.left - w + 4;
  el.style.left = `${Math.max(8, left) + scrollX}px`;
  el.style.top = `${(level === 0 ? r.bottom + 4 : r.top - 7) + scrollY}px`;

  if (level === 0) anchor.setAttribute('aria-expanded', 'true');
  else anchor.classList.add('open');
  bookmarkMenus.push({ el, anchor });
}

// Close bookmarkMenus from `level` down (all by default)
function closeBookmarkMenus(level = 0) {
  for (const { el, anchor } of bookmarkMenus.splice(level)) {
    el.remove();
    anchor.setAttribute('aria-expanded', 'false');
    anchor.classList.remove('open');
  }
}

// Ctrl/⌘ or the middle button open a new tab
async function openBookmark(node, e) {
  closeBookmarkMenus();
  launch(node.url, serviceForUrl(node.url), await inPlaceTabId(e.ctrlKey || e.metaKey || e.button === 1));
}

function onBookmarkClick(e) {
  const bookmark = e.target.closest('[data-bookmark]');
  if (bookmark) { openBookmark(bookmarkNodes.get(bookmark.dataset.bookmark), e); return; }
  const folder = e.target.closest('[data-folder]');
  if (!folder) return;
  const level = folder.closest('.bm-menu') ? bookmarkMenus.findIndex(m => m.el === folder.closest('.bm-menu')) + 1 : 0;
  if (level === 0 && folder.getAttribute('aria-expanded') === 'true') closeBookmarkMenus();
  else openBookmarkMenu(folder, level);
}

bookmarkBar.addEventListener('click', onBookmarkClick);
bookmarkBar.addEventListener('auxclick', (e) => { if (e.button === 1) onBookmarkClick(e); });
document.addEventListener('click', (e) => {
  if (e.target.closest('.bm-menu')) onBookmarkClick(e);
  else if (!e.target.closest('#bookmark-bar')) closeBookmarkMenus();
});
// Like Chrome: with a menu open, hovering another bar folder switches to it; hovering a
// subfolder opens it beside the menu
document.addEventListener('mouseover', (e) => {
  if (!bookmarkMenus.length) return;
  const folder = e.target.closest('[data-folder]');
  const menu = e.target.closest('.bm-menu');
  if (folder && folder.closest('#bookmark-bar') && !folder.hidden && folder.getAttribute('aria-expanded') !== 'true') openBookmarkMenu(folder, 0);
  else if (menu) {
    const level = bookmarkMenus.findIndex(m => m.el === menu) + 1;
    if (folder && !folder.classList.contains('open')) openBookmarkMenu(folder, level);
    else if (!folder && e.target.closest('button')) closeBookmarkMenus(level);
  }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeBookmarkMenus(); });

// ── Statistics ─────────────────────────────────────────────────────────────

function barRows(entries, iconFor, labelFor) {
  const max = entries[0][1];
  return entries.map(([key, count]) => `
    <div class="bar-row">
      ${iconFor(key)}
      <span class="name">${esc(labelFor(key))}</span>
      <div class="bar" style="width:${(count / max) * 100}%"></div>
      <span class="count">${count}</span>
    </div>`).join('');
}

async function renderStats() {
  const el = document.getElementById('stats');
  const { stats } = await chrome.storage.local.get({ stats: { services: {}, accounts: {} } });
  const services = Object.entries(stats.services).filter(([h]) => SERVICE_DEFS[h]).sort((a, b) => b[1] - a[1]);
  const accts = Object.entries(stats.accounts).sort((a, b) => b[1] - a[1]);

  if (services.length === 0) {
    el.innerHTML = '<div class="empty">Services you open through the extension will be counted here.</div>';
    return;
  }

  el.innerHTML = `
    <div class="group-label"><img src="icons/google.webp" width="18" height="18" alt="">Services</div>
    ${barRows(services.slice(0, 10), h => SERVICE_DEFS[h].icon, h => SERVICE_DEFS[h].label)}
    ${accts.length ? `
      <div class="group-label">${sectionIcon('accounts')}Accounts</div>
      ${barRows(accts, accountIcon, accountLabel)}` : ''}
  `;
}

// ── Init ───────────────────────────────────────────────────────────────────

function renderAll() {
  renderAccounts();
  renderTabs();
  renderRecent();
  renderStats();
  renderBookmarks();
}

async function init() {
  renderClock();
  addSectionIcons();
  const data = await chrome.storage.sync.get({
    accountLabels: {}, accountOrder: [], manualAccountCount: 1, dashboardColumns: 'all', dashboardSections: null, recentPerAccount: 5,
    searchButtons: searchButtons, dashboardTitleFormat: 'auto', dashboardOpenLinks: 'new', newTabTitle: '',
  });
  titleFormat = data.dashboardTitleFormat;
  openLinks = data.dashboardOpenLinks;
  if (isNewTab) document.title = data.newTabTitle || NEW_TAB_TITLE;
  renderClock();
  accountLabels = data.accountLabels;
  accountOrder = data.accountOrder;
  manualCount = data.manualAccountCount;
  columns = data.dashboardColumns;
  recentPerAccount = data.recentPerAccount;
  searchButtons = { ...searchButtons, ...data.searchButtons };
  sections = dashboardSections(data.dashboardSections);
  if (embedded) {
    document.body.classList.add('embedded');
    columns = '1';
    // Listed sections in the popup's order; titles follow Options → Dashboard → Sections
    sections = [
      ...popupIds.map(id => ({ ...sections.find(s => s.id === id), visible: true })),
      ...sections.filter(s => !popupIds.includes(s.id)).map(s => ({ ...s, visible: false })),
    ];
    new ResizeObserver(postHeight).observe(document.body);
  } else {
    document.getElementById('q').focus();
  }
  applyLayout();

  const { accountsCache } = await chrome.storage.local.get('accountsCache');
  if (accountsCache?.accounts?.length) {
    accounts = accountsCache.accounts;
    unread = accountsCache.unread || {};
    detected = true;
    detecting = false;
  }

  renderAll();
  refresh();
  setInterval(refresh, REFRESH_MS);
}

document.addEventListener('click', async (e) => {
  const launcherBtn = e.target.closest('[data-launcher]');
  if (launcherBtn) { openLauncher(launcherBtn); return; }
  closeLauncher();

  const link = e.target.closest('[data-url]');
  if (link) { launch(link.dataset.url, link.dataset.service, await inPlaceTabId(e.ctrlKey || e.metaKey)); return; }

  const tab = e.target.closest('[data-tab]');
  if (tab) {
    chrome.tabs.update(Number(tab.dataset.tab), { active: true });
    chrome.windows.update(Number(tab.dataset.window), { focused: true });
    closePopup();
    return;
  }

  if (e.target.id === 'bookmarks-on') {
    try {
      if (await chrome.permissions.request(BOOKMARK_PERMISSIONS)) renderBookmarks();
    } catch (err) {
      e.target.insertAdjacentText('afterend', ` ${err.message}`);
    }
  }

  if (e.target.id === 'history-on') {
    try {
      if (await chrome.permissions.request({ permissions: ['history'] })) renderRecent();
    } catch (err) {
      e.target.insertAdjacentText('afterend', ` ${err.message}`);
    }
  }
});

document.getElementById('recent-clear').addEventListener('click', async () => {
  await chrome.storage.local.set({ recentClearedAt: Date.now() });
  renderRecent();
});

document.getElementById('stats-reset').addEventListener('click', () => {
  chrome.storage.local.set({ stats: { services: {}, accounts: {} } });
});

document.getElementById('account-add').addEventListener('click', () => setManualCount(accounts.length + 1));
document.getElementById('account-remove').addEventListener('click', () => setManualCount(Math.max(1, accounts.length - 1)));

document.getElementById('search').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = document.getElementById('q').value.trim();
  const target = SEARCH_TARGETS[e.submitter?.value];
  if (!q || !target) return;
  const url = target.url(encodeURIComponent(q), searchAccount[e.submitter.value] ?? 0);
  launch(url, target.service, await inPlaceTabId());
});

chrome.tabs.onCreated.addListener(scheduleRenderTabs);
chrome.tabs.onRemoved.addListener(scheduleRenderTabs);
chrome.tabs.onUpdated.addListener((_id, change) => {
  if (change.url || change.title) scheduleRenderTabs();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.stats) renderStats();
  if (area !== 'sync') return;
  if (changes.newTabTitle && isNewTab) document.title = changes.newTabTitle.newValue || NEW_TAB_TITLE;
  if (changes.dashboardOpenLinks) openLinks = changes.dashboardOpenLinks.newValue;
  if (changes.dashboardTitleFormat) {
    titleFormat = changes.dashboardTitleFormat.newValue;
    renderClock();
  }
  if (changes.searchButtons) {
    searchButtons = { ...searchButtons, ...changes.searchButtons.newValue };
    renderSearch();
    applyLayout();
  }
  if (changes.recentPerAccount) {
    recentPerAccount = changes.recentPerAccount.newValue;
    renderRecent();
  }
  if (changes.dashboardColumns && !embedded) {
    columns = changes.dashboardColumns.newValue;
    applyColumns();
  }
  if (changes.accountLabels || changes.accountOrder) {
    accountLabels = changes.accountLabels?.newValue ?? accountLabels;
    accountOrder = changes.accountOrder?.newValue ?? accountOrder;
    renderAll();
  }
  if (changes.dashboardSections && !embedded) {
    sections = dashboardSections(changes.dashboardSections.newValue);
    applyLayout();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  renderClock();
  refresh();
});

init();
