/* global SERVICE_DEFS, DASHBOARD_SECTIONS, GMAIL_DEFAULTS, PANEL_DEFAULTS, accountFromUrl, accountServiceUrl, accountKey, orderAccounts, dashboardSections, sectionIcon, formatDate, setPageIcon, renderPageIcon */

const DOCS_KINDS = {
  document:     'docs.google.com',
  spreadsheets: 'sheets.google.com',
  presentation: 'slides.google.com',
  forms:        'forms.google.com',
};

// Docs URL path → its Options → Recent files → File types switch
const RECENT_TYPES = {
  document:     'recentDocs',
  spreadsheets: 'recentSheets',
  presentation: 'recentSlides',
  forms:        'recentForms',
};

const SECTION_SPANS = { full: 12, 'two-thirds': 8, half: 6, third: 4 };

const SVG_APPS = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">${
  [5, 12, 19].flatMap(y => [5, 12, 19].map(x => `<circle cx="${x}" cy="${y}" r="2.2"/>`)).join('')}</svg>`;

const MAX_ACCOUNTS = 10;

let accounts = [];       // [{ index, email?, name?, photo? }]
let detected = false;    // accounts came from Google rather than the manual count
let detecting = true;    // first detection still running and nothing cached
let unread = {};         // account index → Gmail unread count
const signedOut = new Set();  // account indexes whose Gmail session has lapsed (the feed answers 401)
let mail = {};           // account index → unread inbox messages (Atom feed, at most 20)
let mailSettings = { ...GMAIL_DEFAULTS };  // Options → Gmail
let panelSettings = { ...PANEL_DEFAULTS }; // Options → Open tabs, Recent files
let refreshTimer = null;
const foldedMail = new Set();   // account indexes whose list the unread badge folded
let accountLabels = {};  // accountKey → nickname (edited in Options)
let accountOrder = [];   // accountKeys in display order (edited in Options)
let hiddenAccounts = []; // accountKeys switched off in Options: no card, search or unread count
let manualCount = 1;
let titleFormat = 'auto';  // see formatDate in services-data.js
let openLinks = 'new';   // where links open: 'new' tab, 'current' tab, or 'pinned' (new tab only from a pinned dashboard)
let tabPosition = 'next'; // where new tabs go: 'next' to the dashboard or at the 'end' of its window
let sections = [];       // [{ id, label, visible, width, title }] in display order
let launcher = null;     // the open account launcher frame or inbox panel
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

// Open a dashboard link. When the URL names the account, the background lets it through without
// Account Chooser; otherwise (e.g. a recent file with no account in its URL) it's intercepted as usual.
// With tabId, the link replaces the dashboard in that tab. New tabs open with window.open, not
// chrome.tabs.create, so Chrome can open the link in an installed web app (e.g. Gmail);
// noopener keeps it capturable, since Chrome doesn't capture windows that have an opener.
async function launch(url, service, tabId) {
  const withAccount = service && accountFromUrl(url) !== null;
  if (withAccount) await chrome.runtime.sendMessage({ type: 'open', url, service, tabId });
  if (tabId) {
    if (!withAccount) await chrome.tabs.update(tabId, { url });
  } else {
    if (tabPosition === 'end' && !embedded) await moveNewTabToEnd();
    window.open(url, '_blank', 'noopener');
  }
  closePopup();
}

// A service's start page for an account switches to a tab or web app window already open on that
// service and account, if any; a link that differs from such a tab's page only after # (a Gmail
// message, #inbox/…) switches to it and follows the link there. Otherwise the link opens per
// Options → Dashboard → Open links. newTab (Ctrl/⌘-click) always opens a new one.
async function openLink(url, service, newTab = false) {
  const account = accountFromUrl(url);
  if (!newTab && service && account !== null) {
    const startPage = url === accountServiceUrl(service, account);
    const tab = (await chrome.tabs.query({})).find(t => t.url && serviceForUrl(t.url) === service
      && accountFromUrl(t.url) === account && (startPage || t.url.split('#')[0] === url.split('#')[0]));
    if (tab) {
      chrome.tabs.update(tab.id, { active: true });
      chrome.windows.update(tab.windowId, { focused: true });
      if (startPage) closePopup();
      else launch(url, service, tab.id);
      return;
    }
  }
  launch(url, service, await inPlaceTabId(newTab));
}

// Options → Dashboard → New tabs open → At the end. window.open puts the tab next to the dashboard,
// so the next tab created in the dashboard's window is moved to the end; a link that opens in an
// installed web app's window is left there.
async function moveNewTabToEnd() {
  const { windowId } = await chrome.tabs.getCurrent();
  const onCreated = (tab) => {
    chrome.tabs.onCreated.removeListener(onCreated);
    clearTimeout(timer);
    if (tab.windowId === windowId) chrome.tabs.move(tab.id, { index: -1 });
  };
  chrome.tabs.onCreated.addListener(onCreated);
  const timer = setTimeout(() => chrome.tabs.onCreated.removeListener(onCreated), 2000);
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

// Options → Popup → Layout → Accordion (dashboard.html?popup=…&accordion=<open section id>): one
// section open at a time, the others folded to their head, which opens them
const accordionOpen = new URLSearchParams(location.search).get('accordion');
const accordion = accordionOpen !== null;

function openSection(id) {
  for (const el of document.querySelectorAll('#sections > [data-section]:has(> .section-head)')) {
    el.classList.toggle('collapsed', el.dataset.section !== id);
  }
}

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
    el.hidden = !s.visible;
    el.style.gridColumn = `span ${SECTION_SPANS[s.width]}`;
    // Accounts keeps its head for the detection hint and stepper; renderAccountsHead hides it
    el.classList.toggle('no-title', !s.title && s.id !== 'accounts');
    container.append(el);
  }
  applyColumns();
  renderAccountsHead();
  // Bookmarks narrower than full width list down the section instead of along a bar
  bookmarkBar.classList.toggle('vertical', sections.find(s => s.id === 'bookmarks').width !== 'full');
  if (bookmarkTree) drawBookmarks();
}

// Options → Dashboard → Section height: how tall panel lists grow before they scroll
function applySectionHeight(height) {
  document.documentElement.style.setProperty('--section-height', height === 'auto' ? 'none' : `${height}px`);
}

// Options → Dashboard → Placement and Size: the page at the top or centered vertically, and how
// wide it gets. The popup fills its frame either way.
function applyPage(placement, size) {
  document.body.classList.toggle('centered', placement === 'center');
  document.documentElement.style.setProperty('--page-width', size === 'full' ? 'none' : `${size}px`);
}

// Accounts with a card, in display order; hidden ones still name open tabs, recent files and stats
const shownAccounts = () => orderAccounts(accounts.filter(a => !hiddenAccounts.includes(accountKey(a))), accountOrder);

// Accounts side by side when their section is full width; otherwise, and in the popup, one per row
function applyColumns() {
  const full = !embedded && sections.find(s => s.id === 'accounts').width === 'full';
  const count = full ? Math.max(shownAccounts().length, 1) : 1;
  const el = document.getElementById('accounts');
  el.style.gridTemplateColumns = `repeat(${count}, minmax(0, 1fr))`;
  el.classList.toggle('in-row', count > 1);
}

// The Accounts head: its title (Options → Dashboard → Sections → Title), and while detecting or
// when detection failed, the hint and account count stepper
function renderAccountsHead() {
  // An accordion's heads always show: they open their section
  const title = sections.find(s => s.id === 'accounts').title || accordion;
  document.getElementById('accounts-head').hidden = detected && !title;
  document.getElementById('accounts-title').hidden = !title;
  document.getElementById('accounts-hint').hidden = detected;
  document.getElementById('accounts-hint').textContent = detecting
    ? 'Detecting signed-in accounts…'
    : 'Couldn\'t detect signed-in accounts — set how many you use.';
  document.getElementById('account-stepper').hidden = detected || detecting;
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

// Gmail's Atom feed gives the unread count, names the account in its title
// ("Gmail - Inbox for user@example.com") and lists up to 20 unread inbox messages;
// { signedOut: true } when the account's Gmail session has lapsed, null when the slot has no feed.
// Fetched by the background worker (see fetchFeed there), so a lapsed session doesn't make
// Chrome ask for a username and password.
async function fetchInbox(n) {
  try {
    const feed = await chrome.runtime.sendMessage({ type: 'feed', n });
    if (feed?.status === 401) return { signedOut: true };
    if (!feed?.text) return null;
    const doc = new DOMParser().parseFromString(feed.text, 'text/xml');
    const count = doc.getElementsByTagName('fullcount')[0];
    if (!count) return null;
    const title = doc.getElementsByTagName('title')[0]?.textContent || '';
    const messages = [...doc.getElementsByTagName('entry')].map((entry) => {
      const text = (tag) => entry.getElementsByTagName(tag)[0]?.textContent || '';
      // The feed's own link names the account by email, which Account Chooser would intercept
      const href = entry.getElementsByTagName('link')[0]?.getAttribute('href');
      const id = href && new URL(href).searchParams.get('message_id');
      return {
        from: text('name') || text('email'),
        subject: text('title'),
        snippet: text('summary'),
        time: Date.parse(text('issued') || text('modified')),
        id,
        url: accountServiceUrl('mail.google.com', n) + (id ? `#inbox/${id}` : ''),
      };
    });
    return { count: Number(count.textContent), email: title.match(/\S+@\S+/)?.[0] ?? null, messages };
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
  if (detected) chrome.storage.local.set({ accountsCache: { accounts, unread, mail } });
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

  // Hidden accounts' mail isn't checked or counted
  for (const a of accounts) {
    if (shownAccounts().includes(a)) continue;
    delete unread[a.index];
    delete mail[a.index];
    signedOut.delete(a.index);
  }
  await Promise.all(shownAccounts().map(async (a) => {
    const inbox = await fetchInbox(a.index);
    if (inbox?.signedOut) signedOut.add(a.index);
    else signedOut.delete(a.index);
    if (inbox && !inbox.signedOut) {
      unread[a.index] = inbox.count;
      mail[a.index] = inbox.messages;
    } else {
      delete unread[a.index];
      delete mail[a.index];
    }
  }));
  renderUnread();
  renderMail();
  saveCache();
  chrome.runtime.sendMessage({ type: 'unread', unread });
}

function renderAccounts() {
  const el = document.getElementById('accounts');
  const gmail = SERVICE_DEFS['mail.google.com'];
  applyColumns();

  el.innerHTML = shownAccounts().map(a => {
    const name = displayName(a);
    const secondary = accountLabels[accountKey(a)] ? a.email : a.name;

    return `
      <section class="acct" data-index="${a.index}">
        <div class="acct-head">
          ${avatarHtml(a.photo, name)}
          <div class="acct-id">
            <div class="acct-name">${esc(name)}</div>
            ${secondary ? `<div class="acct-email">${esc(secondary)}</div>` : ''}
          </div>
          <button class="unread" data-inbox="${a.index}" data-url="${esc(accountServiceUrl('mail.google.com', a.index))}"
                  data-service="mail.google.com" title="Unread mail (Ctrl/⌘-click opens Gmail)" hidden>
            ${gmail.icon}<b></b>
          </button>
          <button class="icon-btn" data-launcher="${a.index}" title="Google apps">${SVG_APPS}</button>
        </div>
      </section>`;
  }).join('');

  renderAccountsHead();

  renderSearch();
  renderUnread();
  renderMail();
}

function renderUnread() {
  for (const a of accounts) {
    const btn = document.querySelector(`section[data-index="${a.index}"] .unread`);
    if (!btn) continue;
    // Signed out of Gmail: a warning badge, and a click opens Gmail to sign in again
    const out = signedOut.has(a.index);
    btn.hidden = !out && !(a.index in unread);
    btn.classList.toggle('empty-inbox', unread[a.index] === 0);
    btn.classList.toggle('signed-out', out);
    btn.title = out ? 'Signed out of Gmail — click to sign in' : 'Unread mail (Ctrl/⌘-click opens Gmail)';
    btn.querySelector('b').textContent = out ? '!' : unread[a.index] > 999 ? '999+' : unread[a.index] ?? '';
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
  const list = shownAccounts();
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
  if (toggleOff('launcher', index)) return;

  const frame = document.createElement('iframe');
  frame.className = 'launcher';
  frame.src = `popup.html?account=${index}`;
  frame.addEventListener('load', () => frame.contentWindow.focus());
  placeLauncher(frame, btn, 'launcher', index);
}

// Closes any open launcher or inbox; true when it was this one, so its button toggles it off
function toggleOff(kind, index) {
  const wasOpen = launcher?.dataset.kind === kind && launcher.dataset.index === index;
  closeLauncher();
  return wasOpen;
}

function placeLauncher(el, btn, kind, index) {
  el.dataset.kind = kind;
  el.dataset.index = index;
  // In the toolbar popup there's no room for a floating panel, and the launcher of accounts in a
  // column (section narrower than full width) fits their card: both expand inside the account card
  const column = sections.find(s => s.id === 'accounts').width !== 'full';
  if (embedded || (kind === 'launcher' && column)) {
    el.classList.add('inline');
    btn.closest('.acct').append(el);
  } else {
    const r = btn.getBoundingClientRect();
    el.style.top = `${r.bottom + scrollY + 6}px`;
    el.style.left = `${Math.max(8, r.right + scrollX - 300)}px`;
    document.body.append(el);
  }
  launcher = el;
}

function closeLauncher() {
  launcher?.remove();
  launcher = null;
  postHeight();
}

window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || e.source !== launcher?.contentWindow) return;
  const msg = e.data;
  if (msg.type === 'resize') {
    launcher.style.height = `${msg.height + (embedded ? 1 : 2)}px`;
    postHeight();
  }
  if (msg.type === 'close') closeLauncher();
  if (msg.type === 'launch') {
    closeLauncher();
    openLink(msg.url, msg.service, msg.newTab);
  }
});

// Only width changes move the launcher's anchor; in the popup, opening the launcher itself
// grows the frame's height, which must not close it again
let lastWidth = innerWidth;
window.addEventListener('resize', () => {
  if (innerWidth === lastWidth) return;
  lastWidth = innerWidth;
  if (!launcher?.classList.contains('inline')) closeLauncher();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeLauncher();
});

// ── Inbox ──────────────────────────────────────────────────────────────────

// An account's unread inbox mail (the Atom feed's, at most 20) is listed right away in its card
// where Options → Gmail → Expand unread emails says so, and the unread badge folds and unfolds it;
// elsewhere the badge opens the list in a panel placed like the launcher's. Ctrl/⌘-click on the
// badge opens Gmail. A message opens in its list (Ctrl/⌘-click: in Gmail), with Back to the list.
const PREVIEW_WIDTH = 640;

const mailExpanded = () => mailSettings.expandUnread === 'always' || mailSettings.expandUnread === (embedded ? 'popup' : 'dashboard');

// The emails a list shows (Options → Gmail → Emails listed)
const listed = (messages) => mailSettings.mailListCount === 'all' ? messages : messages.slice(0, Number(mailSettings.mailListCount));

// Avatars and text lines (Options → Gmail) are styles, so lists needn't be redrawn for them
function applyMailLook() {
  document.body.classList.toggle('no-avatars', !mailSettings.mailAvatars);
  document.body.classList.toggle('no-list-header', !mailSettings.mailListHeader);
  document.body.classList.toggle('no-snippets', mailSettings.mailSnippetLines === 0);
  document.body.style.setProperty('--snippet-lines', mailSettings.mailSnippetLines || 1);
}

// Re-detection and unread counts every Options → Gmail → Check mail every
function scheduleRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(refresh, mailSettings.mailCheckMinutes * 60 * 1000);
}

function messagesHtml(messages) {
  return messages.map(m => `
    <button class="message" data-message="${esc(m.id)}" data-url="${esc(m.url)}" data-service="mail.google.com" title="${esc(m.subject)}">
      <span class="sender-avatar" style="background: ${senderColor(m.from)}">${esc(m.from.charAt(0).toUpperCase())}</span>
      <span class="from">${esc(m.from)}</span>
      <span class="date">${mailDate(m.time)}</span>
      <span class="subject">${esc(m.subject || '(no subject)')}</span>
      <span class="snippet">${esc(m.snippet)}</span>
    </button>`).join('');
}

// Expanded lists in the account cards, redrawn only when their messages change and not while
// one shows a message
function renderMail() {
  for (const a of accounts) {
    const card = document.querySelector(`.acct[data-index="${a.index}"]`);
    if (!card) continue;
    let list = card.querySelector(':scope > .inbox');
    if (!mailExpanded() || foldedMail.has(a.index) || !mail[a.index]?.length) {
      list?.remove();
      continue;
    }
    if (list?.classList.contains('previewing')) continue;
    const ids = listed(mail[a.index]).map(m => m.id).join();
    if (list?.dataset.ids === ids) continue;
    if (!list) {
      list = document.createElement('div');
      list.className = 'inbox in-card';
      list.dataset.index = a.index;
      card.append(list);
    }
    list.dataset.ids = ids;
    list.innerHTML = `
      <div class="inbox-view">
        ${inboxHead(accountServiceUrl('mail.google.com', a.index))}
        <div class="inbox-list">${messagesHtml(listed(mail[a.index]))}</div>
      </div>`;
  }
}

// With no unread mail there's nothing to list, and signed out there's no list to get: the badge
// opens Gmail (which asks to sign in)
// "Inbox" and Open Gmail above a list; hidden in cards by Options → Gmail → List header
const inboxHead = (gmailUrl) => `
  <div class="inbox-head">
    <span class="inbox-title">Inbox</span>
    <button class="text-btn" data-url="${esc(gmailUrl)}" data-service="mail.google.com">Open Gmail</button>
  </div>`;

function onUnreadBadge(btn) {
  if (unread[btn.dataset.inbox] === 0 || signedOut.has(Number(btn.dataset.inbox))) {
    openLink(btn.dataset.url, btn.dataset.service);
    return;
  }
  if (!mailExpanded()) {
    openInbox(btn);
    return;
  }
  const index = Number(btn.dataset.inbox);
  if (!foldedMail.delete(index)) foldedMail.add(index);
  renderMail();
}

async function openInbox(btn) {
  const index = btn.dataset.inbox;
  if (toggleOff('inbox', index)) return;

  const panel = document.createElement('div');
  panel.className = 'launcher inbox';
  panel.innerHTML = `
    <div class="inbox-view">
      ${inboxHead(btn.dataset.url)}
      <div class="empty">Loading…</div>
    </div>`;
  placeLauncher(panel, btn, 'inbox', index);

  const inbox = await fetchInbox(index);
  if (launcher !== panel) return;
  if (inbox?.signedOut) {
    signedOut.add(Number(index));
    renderUnread();
    closeLauncher();
    openLink(btn.dataset.url, btn.dataset.service);
    return;
  }
  if (inbox) {
    unread[index] = inbox.count;
    mail[index] = inbox.messages;
    renderUnread();
  }
  panel.querySelector('.empty').outerHTML = !inbox
    ? '<div class="empty">Couldn\'t load this inbox.</div>'
    : `<div class="inbox-list">${messagesHtml(listed(inbox.messages)) || '<div class="empty">No unread mail in the inbox.</div>'}</div>`;
}

// The message's thread from Gmail's print view, laid out like Gmail's: earlier messages folded to
// a line, the last one open, a click on a message's head folds or unfolds it. The floating panel
// widens to the left, keeping its right edge under the badge.
async function showMessage(btn) {
  const panel = btn.closest('.inbox');
  panel.querySelector('.inbox-view').hidden = true;
  panel.classList.add('previewing');
  if (panel === launcher && !embedded) {
    panel.dataset.left = panel.style.left;
    panel.style.left = `${Math.max(8, parseFloat(panel.style.left) + 300 - PREVIEW_WIDTH)}px`;
  }
  panel.insertAdjacentHTML('beforeend', `
    <div class="inbox-preview">
      <div class="inbox-head">
        <button class="icon-btn" data-back title="Back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
        </button>
        <span class="inbox-title">${esc(btn.title || '(no subject)')}</span>
        <button class="text-btn" data-url="${esc(btn.dataset.url)}" data-service="mail.google.com">Open in Gmail</button>
      </div>
      <div class="empty">Loading…</div>
    </div>`);
  const preview = panel.lastElementChild;

  const thread = await fetchThread(panel.dataset.index, btn.dataset.message);
  if (!preview.isConnected) return;
  if (!thread) {
    preview.querySelector('.empty').textContent = 'Couldn\'t load this message.';
    return;
  }
  // Without a recognisable message list (the print view's layout changed), the whole page as one
  const messages = thread.messages.length ? thread.messages : [{ html: thread.page }];
  preview.querySelector('.empty').outerHTML = `<div class="thread">${messages.map((m, i) => `
    <div class="thread-msg${i === messages.length - 1 || mailSettings.threadOpen === 'all' ? ' open' : ''}">
      ${m.from === undefined ? '' : `
        <button class="thread-head">
          <span class="sender-avatar" style="background: ${senderColor(m.from)}">${esc(m.from.charAt(0).toUpperCase())}</span>
          <span class="from">${esc(m.from)}</span>
          <span class="date">${esc(m.date)}</span>
          <span class="snippet">${esc(m.snippet)}</span>
          <span class="to">${esc(m.to)}</span>
        </button>`}
    </div>`).join('')}</div>`;
  // Frames are made on first unfold, so folded messages cost nothing
  const items = [...preview.querySelectorAll('.thread-msg')];
  const frameFor = (i) => messageFrame(thread.head + messages[i].html);
  items.forEach((item, i) => { if (item.classList.contains('open')) item.append(frameFor(i)); });
  preview.querySelector('.thread').addEventListener('click', (e) => {
    const item = e.target.closest('.thread-head')?.parentElement;
    if (!item) return;
    item.classList.toggle('open');
    if (!item.querySelector('iframe')) item.append(frameFor(items.indexOf(item)));
  });
}

// A message body in a sandboxed frame: no scripts, links open in new tabs. allow-same-origin
// (harmless without allow-scripts) lets the frame be sized to its content once it has loaded.
function messageFrame(html) {
  const frame = document.createElement('iframe');
  frame.sandbox = 'allow-same-origin allow-popups allow-popups-to-escape-sandbox';
  frame.srcdoc = html;
  frame.addEventListener('load', () => {
    frame.style.height = `${frame.contentDocument.documentElement.scrollHeight}px`;
  });
  return frame;
}

function showList(panel) {
  panel.querySelector('.inbox-preview').remove();
  panel.querySelector('.inbox-view').hidden = false;
  panel.classList.remove('previewing');
  if (panel === launcher && !embedded) panel.style.left = panel.dataset.left;
  renderMail();
}

// Gmail's print view of a thread, split into its messages (table.message: sender and date, then
// recipients, then the body); head is the page's styles and base for each message's frame, page
// the whole thread for when no messages are found. Null on failure.
async function fetchThread(index, id) {
  try {
    const res = await fetch(`https://mail.google.com/mail/u/${index}/?view=pt&search=all&th=${encodeURIComponent(id)}`,
      { credentials: 'include' });
    if (!res.ok) return null;
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    doc.querySelectorAll('script').forEach(el => el.remove());
    const head = `<!doctype html><meta charset="utf-8"><base href="https://mail.google.com/mail/u/${index}/" target="_blank">`
      + [...doc.querySelectorAll('style')].map(el => el.outerHTML).join('')
      + '<style>body { margin: 8px 16px 16px; }</style>';
    const messages = [...doc.querySelectorAll('table.message')]
      .filter(table => !table.parentElement.closest('table.message') && table.rows.length >= 2)
      .map((table) => {
        const [sender, date] = table.rows[0].cells;
        const body = [...table.rows].at(-1).cells[0];
        return {
          from: (sender.querySelector('b') || sender).textContent.trim(),
          date: date?.textContent.trim() || '',
          to: table.querySelector('.recipient')?.textContent.replace(/\s+/g, ' ').trim() || '',
          snippet: body.textContent.replace(/\s+/g, ' ').trim().slice(0, 200),
          html: body.innerHTML,
        };
      });
    return { head, messages, page: (doc.querySelector('.maincontent') || doc.body).outerHTML };
  } catch {
    return null;
  }
}

// Dates as Gmail lists them: time today, month and day this year, a short date before that
function mailDate(ms) {
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return d.toLocaleDateString([], { year: '2-digit', month: 'numeric', day: 'numeric' });
}

// A steady letter-avatar color per sender, like the Gmail app's
function senderColor(name) {
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${hash} 45% 45%)`;
}

// ── Open tabs ──────────────────────────────────────────────────────────────

// Rows under a band per account key, in order of first appearance; items whose key is null go
// last under `other` (icon and label HTML). A known account's index and email (URLs name it either
// way, e.g. /u/0/ and authuser=name@gmail.com) share one band. Each group lists at most `limit` rows.
// One account can be named by number in some links and by email in others
const groupKey = (key) => key !== null && findAccount(key) ? String(findAccount(key).index) : key;

function groupedRows(items, keyOf, other, row) {
  const groups = new Map();
  for (const item of items) {
    const key = groupKey(keyOf(item));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups].sort(([a], [b]) => (a === null) - (b === null)).map(([key, list]) => `
    <div class="group-label">${key === null ? other : `${accountIcon(key)}${esc(accountLabel(key))}`}</div>
    ${list.map(row).join('')}
  `).join('');
}

// A row's account avatar when rows aren't grouped by account
const rowAccount = (key) => key === null ? ''
  : `<span class="row-account" title="${esc(accountLabel(key))}">${accountIcon(key)}</span>`;

const SVG_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

// Chrome's tab group colors, as in its tab strip
const TAB_GROUP_COLORS = {
  grey: '#5f6368', blue: '#1a73e8', red: '#d93025', yellow: '#f9ab00', green: '#1e8e3e',
  pink: '#d01884', purple: '#9334e6', cyan: '#007b83', orange: '#fa903e',
};

// Other sites' tabs show the favicon Chrome reports for them
const tabIcon = (t) => /^(https?|data):/.test(t.favIconUrl || '')
  ? `<img src="${esc(t.favIconUrl)}" alt="">` : sectionIcon('tabs');

async function renderTabs() {
  const el = document.getElementById('tabs');
  const all = panelSettings.tabsScope === 'all';
  // With all tabs, the extension's own pages (this dashboard among them) still aren't listed
  const ownPages = `${location.origin}/`;
  const tabs = (await chrome.tabs.query({}))
    .filter(t => t.url && (all ? !t.url.startsWith(ownPages) : serviceForUrl(t.url)));

  if (tabs.length === 0) {
    el.innerHTML = `<div class="empty">${all ? 'No tabs are open.' : 'No Google service tabs are open.'}</div>`;
    return;
  }

  const groups = panelSettings.tabsGroupColors
    ? new Map((await chrome.tabGroups.query({})).map(g => [g.id, g]))
    : new Map();

  // A Google service tab without an explicit account shows the default account (index 0)
  const accountOf = (t) => serviceForUrl(t.url) ? accountFromUrl(t.url) ?? '0' : null;
  const row = (t) => {
    const service = serviceForUrl(t.url);
    const group = groups.get(t.groupId);
    return `
      <button class="row${group ? ' in-group' : ''}" data-tab="${t.id}" data-window="${t.windowId}"
        ${group ? `style="--group: ${TAB_GROUP_COLORS[group.color]}"` : ''}
        title="${esc(group?.title ? `${group.title}\n${t.url}` : t.url)}">
        ${service ? SERVICE_DEFS[service].icon : tabIcon(t)}
        <span class="title">${esc(t.title || t.url)}</span>
        ${panelSettings.tabsAccount && panelSettings.tabsGroupBy !== 'account' ? rowAccount(accountOf(t)) : ''}
        ${panelSettings.tabsClose ? `<span class="close" data-close-tab="${t.id}" title="Close tab">${SVG_CLOSE}</span>` : ''}
      </button>`;
  };
  if (panelSettings.tabsGroupBy === 'account') {
    el.innerHTML = groupedRows(tabs, accountOf, `${sectionIcon('tabs')}Other tabs`, row);
    return;
  }
  // By window: the dashboard's (or popup's) window first, then other browser windows, then app
  // windows (an installed web app, or a service in its own window), one band per app however many
  // windows it has open (e.g. Gmail in two accounts), named after it. A single band needs no label.
  const current = (await chrome.windows.getCurrent()).id;
  const types = new Map((await chrome.windows.getAll({ windowTypes: ['normal', 'popup', 'app'] })).map(w => [w.id, w.type]));
  const isApp = (t) => types.get(t.windowId) !== 'normal';
  const appOf = (t) => serviceForUrl(t.url) || new URL(t.url).origin;
  const bandOf = (t) => isApp(t) ? `app:${appOf(t)}` : t.windowId;
  const bands = [...new Set(tabs.map(bandOf))]
    .sort((a, b) => (b === current) - (a === current) || (typeof a === 'string') - (typeof b === 'string'));
  let number = 1;
  const bandLabel = (band) => {
    if (band === current) return `${sectionIcon('tabs')}Current window`;
    if (typeof band === 'number') return `${sectionIcon('tabs')}Window ${++number}`;
    const tab = tabs.find(t => bandOf(t) === band);
    const service = serviceForUrl(tab.url);
    return service ? `${SERVICE_DEFS[service].icon}${SERVICE_DEFS[service].label}` : `${tabIcon(tab)}${esc(tab.title || tab.url)}`;
  };
  el.innerHTML = panelSettings.tabsGroupBy === 'none' || bands.length === 1
    ? tabs.map(row).join('')
    : bands.map(band => `
      <div class="group-label">${bandLabel(band)}</div>
      ${tabs.filter(t => bandOf(t) === band).map(row).join('')}
    `).join('');
}

let _tabsTimer = null;
function scheduleRenderTabs() {
  clearTimeout(_tabsTimer);
  _tabsTimer = setTimeout(renderTabs, 200);
}

// ── Edit mode (Recent files, Most visited, Statistics) ─────────────────────
// Rows stop opening their link, carry pin and remove buttons, and drag to re-order

const SVG_PIN = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>';
const sectionEditing = { recent: false, visited: false, stats: false };

function renderEditButtons(id, granted) {
  const editing = sectionEditing[id];
  const edit = document.getElementById(`${id}-edit`);
  edit.hidden = !granted;
  edit.textContent = editing ? 'Done' : 'Edit';
  document.getElementById(`${id}-edit-corner`).hidden = !granted;
  document.getElementById(`${id}-reset`).hidden = !granted || !editing;
  document.getElementById(id).classList.toggle('editing', editing);
}

const editButtons = (pinned, pinAttr, removeAttr, value) => `
  <span class="pin${pinned ? ' pinned' : ''}" ${pinAttr}="${esc(value)}" title="${pinned ? 'Unpin' : 'Pin to top'}">${SVG_PIN}</span>
  <span class="close" ${removeAttr}="${esc(value)}" title="Remove">${SVG_CLOSE}</span>`;

// ── Recent files (optional history permission) ─────────────────────────────

function relativeTime(ms) {
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 60) return `${Math.max(minutes, 1)}m`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}

// Options → Recent files → Date and time
function recentTime(ms) {
  if (panelSettings.recentTime === 'relative') return relativeTime(ms);
  if (panelSettings.recentTime === 'time-or-date') return mailDate(ms);
  return formatDate(new Date(ms), panelSettings.recentTime);
}

let recentFiles = new Map(); // document id → file, from the last render

async function renderRecent() {
  const el = document.getElementById('recent');
  const granted = await chrome.permissions.contains({ permissions: ['history'] });
  const editing = sectionEditing.recent;
  renderEditButtons('recent', granted);
  document.getElementById('recent-clear').hidden = !granted || editing;

  if (!granted) {
    el.innerHTML = `
      <div class="empty">
        Show Docs, Sheets, Slides and Forms you opened recently, read from your browser history.
        History stays on this device.<br>
        <button class="text-btn" id="history-on">Turn on</button>
      </div>`;
    return;
  }

  const { recentClearedAt, recentPinned, recentRemoved } = await chrome.storage.local.get({ recentClearedAt: 0, recentPinned: [], recentRemoved: {} });
  const pinnedIds = new Set(recentPinned.map(f => f.id));
  // All of history, not just the period: pinned files outside it still show their latest title and visit
  const items = await chrome.history.search({ text: 'docs.google.com', startTime: 0, maxResults: 1000 });
  items.sort((a, b) => b.lastVisitTime - a.lastVisitTime);

  // One entry per document, newest visit first, with the visits of all its URLs. Docs URLs often
  // omit the account, so take it from any visited URL of the same document and add it to the
  // newest URL as authuser.
  const files = new Map();
  for (const item of items) {
    const m = item.url.match(/^https:\/\/docs\.google\.com\/(document|spreadsheets|presentation|forms)\/(?:u\/\d+\/)?d\/(?:e\/)?([\w-]+)/);
    if (!m || !(panelSettings[RECENT_TYPES[m[1]]] || pinnedIds.has(m[2]))) continue;
    if (!files.has(m[2])) files.set(m[2], { ...item, id: m[2], service: DOCS_KINDS[m[1]], visits: 0 });
    const file = files.get(m[2]);
    file.visits += item.visitCount;
    const account = accountFromUrl(item.url);
    if (account !== null && accountFromUrl(file.url) === null) {
      const url = new URL(file.url);
      url.searchParams.set('authuser', account);
      file.url = url.href;
    }
  }

  recentFiles = files;

  // Pinned files stay listed, as last seen, once history no longer has them. Clear and Remove only
  // hide files opened before they were pressed.
  const pinned = recentPinned.map(f => files.get(f.id) ?? f);
  const since = Math.max(Date.now() - panelSettings.recentDays * 864e5, recentClearedAt);
  const list = [...files.values()].filter(f => !pinnedIds.has(f.id) && f.lastVisitTime >= since && f.lastVisitTime > (recentRemoved[f.id] ?? 0));

  if (pinned.length === 0 && list.length === 0) {
    el.innerHTML = `<div class="empty">No recently opened files.</div>`;
    return;
  }

  // Most visited first; equally visited files stay newest first
  if (panelSettings.recentSort === 'visits') list.sort((a, b) => b.visits - a.visits);

  // A file none of whose visits names an account opened in Google's default account (index 0); its
  // link stays as it was, so opening it still goes through Account Chooser
  const accountOf = (f) => accountFromUrl(f.url) ?? '0';
  const row = (f) => `
    <button class="row" ${editing
      ? `data-item="${esc(f.id)}"${pinnedIds.has(f.id) ? ' draggable="true"' : ''}`
      : `data-url="${esc(f.url)}" data-service="${f.service}"`} title="${esc(f.url)}">
      ${SERVICE_DEFS[f.service].icon}
      <span class="title">${esc((f.title || f.url).replace(/ - Google (Docs|Sheets|Slides|Forms)$/, ''))}</span>
      ${panelSettings.recentAccount && (panelSettings.recentGroupBy !== 'account' || pinnedIds.has(f.id)) ? rowAccount(accountOf(f)) : ''}
      ${panelSettings.recentTime === 'off' ? '' : `<span class="meta">${esc(recentTime(f.lastVisitTime))}</span>`}
      ${editing ? editButtons(pinnedIds.has(f.id), 'data-pin-file', 'data-remove-file', f.id) : ''}
    </button>`;
  // Pinned files always show and count towards the limit of their group, or of the whole list
  const keyOf = { account: f => groupKey(accountOf(f)), type: f => f.service }[panelSettings.recentGroupBy] ?? (() => '');
  const room = new Map();
  const listed = list.filter((f) => {
    const key = keyOf(f);
    if (!room.has(key)) room.set(key, panelSettings.recentPerAccount - pinned.filter(p => keyOf(p) === key).length);
    room.set(key, room.get(key) - 1);
    return room.get(key) >= 0;
  });
  // Pinned files come first; a band sets them apart from other groups
  const pinnedRows = (pinned.length && panelSettings.recentGroupBy !== 'none' ? `<div class="group-label">${SVG_PIN}Pinned</div>` : '')
    + pinned.map(row).join('');
  if (panelSettings.recentGroupBy === 'account') {
    el.innerHTML = pinnedRows + groupedRows(listed, accountOf, '', row);
  } else if (panelSettings.recentGroupBy === 'type') {
    // Docs, Sheets, Slides, Forms, in that order
    el.innerHTML = pinnedRows + Object.values(DOCS_KINDS)
      .map(service => [service, listed.filter(f => f.service === service)])
      .filter(([, files]) => files.length)
      .map(([service, files]) => `
        <div class="group-label">${SERVICE_DEFS[service].icon}${SERVICE_DEFS[service].label}</div>
        ${files.map(row).join('')}
      `).join('');
  } else {
    el.innerHTML = pinnedRows + listed.map(row).join('');
  }
}

async function togglePin(id) {
  const { recentPinned } = await chrome.storage.local.get({ recentPinned: [] });
  if (recentPinned.some(f => f.id === id)) {
    await chrome.storage.local.set({ recentPinned: recentPinned.filter(f => f.id !== id) });
    return;
  }
  const { url, title, service, lastVisitTime } = recentFiles.get(id);
  await chrome.storage.local.set({ recentPinned: [...recentPinned, { id, url, title, service, lastVisitTime }] });
}

// Hides the file until it's opened again
async function removeFile(id) {
  const { recentPinned, recentRemoved } = await chrome.storage.local.get({ recentPinned: [], recentRemoved: {} });
  await chrome.storage.local.set({
    recentPinned: recentPinned.filter(f => f.id !== id),
    recentRemoved: { ...recentRemoved, [id]: Date.now() },
  });
}

async function orderPinnedFiles(ids) {
  const { recentPinned } = await chrome.storage.local.get({ recentPinned: [] });
  await chrome.storage.local.set({ recentPinned: ids.map(id => recentPinned.find(f => f.id === id)) });
}

// ── Most visited (optional topSites + favicon permissions) ─────────────────
// Chrome's own list, the one its New Tab page shows

const VISITED_PERMISSIONS = { permissions: ['topSites', 'favicon'] };

// Options → Most visited → Icons and Text
function applyVisitedLook() {
  const el = document.getElementById('visited');
  el.classList.toggle('large', panelSettings.visitedIcons === 'large');
  el.classList.toggle('small-row', panelSettings.visitedIcons === 'small-row');
  el.classList.toggle('icons-only', !panelSettings.visitedText);
}

// Edit mode's changes, kept on this device. Chrome's own list isn't changed: removed sites just aren't
// listed, added and pinned ones ({ url, title }) stay listed even after Chrome drops them, and order
// ranks urls.
const VISITED_EDITS = { removed: [], pinned: [], order: [], added: [] };
let visitedSites = [];  // listed sites, in order

async function renderVisited() {
  const el = document.getElementById('visited');
  const granted = await chrome.permissions.contains(VISITED_PERMISSIONS);
  const editing = sectionEditing.visited;
  renderEditButtons('visited', granted);

  if (!granted) {
    el.innerHTML = `
      <div class="empty">
        Show the sites you visit most, from the list Chrome keeps for its New Tab page.
        The list stays on this device.<br>
        <button class="text-btn" id="visited-on">Turn on</button>
      </div>`;
    return;
  }

  const { removed, pinned, order, added } = await visitedEdits();
  const top = await chrome.topSites.get();
  const sites = [...added.filter(a => !top.some(s => s.url === a.url)), ...top];
  const rank = (s) => {
    const i = order.indexOf(s.url);
    return i === -1 ? Infinity : i;
  };
  const inOrder = (list) => [...list].sort((a, b) => rank(a) - rank(b));
  const pins = inOrder(pinned.map(p => sites.find(s => s.url === p.url) ?? p));
  const rest = inOrder(sites.filter(s => !removed.includes(s.url) && !pinned.some(p => p.url === s.url)));
  // Pinned sites always show; the others fill up to Options → Most visited → Sites listed
  visitedSites = [...pins, ...rest.slice(0, Math.max(0, panelSettings.visitedCount - pins.length))];

  const isPinned = (s) => pinned.some(p => p.url === s.url);
  // In edit mode rows don't open their site: they drag, and carry the pin and remove buttons
  const row = (s) => `
    <button class="row" ${editing
      ? `data-item="${esc(s.url)}" draggable="true"`
      : `data-url="${esc(s.url)}" data-service="${serviceForUrl(s.url) || ''}"`} title="${esc(s.title ? `${s.title}\n${s.url}` : s.url)}">
      ${bookmarkIcon(s.url, 64)}
      <span class="title">${esc(s.title || s.url)}</span>
      ${editing ? editButtons(isPinned(s), 'data-visited-pin', 'data-visited-remove', s.url) : ''}
    </button>`;
  const empty = sites.length
    ? `All sites are removed. Use Reset${editing ? '' : ' in Edit'} to bring them back.`
    : `Chrome has no most visited sites yet.${editing ? '' : ' Use Edit to add one.'}`;
  el.innerHTML = (visitedSites.length ? visitedSites.map(row).join('') : `<div class="empty">${empty}</div>`)
    + (editing ? `
      <form id="visited-add">
        <input name="url" placeholder="Add a site, like example.com" aria-label="Site address" autocomplete="off" required>
        <button class="text-btn">Add</button>
      </form>` : '');
}

async function visitedEdits() {
  const { visitedEdits } = await chrome.storage.local.get({ visitedEdits: VISITED_EDITS });
  return { ...VISITED_EDITS, ...visitedEdits };
}

async function editVisited(change) {
  const edits = await visitedEdits();
  await chrome.storage.local.set({ visitedEdits: { ...edits, ...change(edits) } });
}

// A typed address as a link: https unless it says otherwise, and only web pages
function siteUrl(text) {
  const value = text.trim();
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`);
    return /^https?:$/.test(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

// Added sites start pinned, so Sites listed can't hide them right away
function addVisited(url) {
  const site = { url, title: new URL(url).hostname.replace(/^www\./, '') };
  return editVisited(({ removed, pinned, added }) => ({
    removed: removed.filter(u => u !== url),
    pinned: pinned.some(p => p.url === url) ? pinned : [...pinned, site],
    added: added.some(a => a.url === url) ? added : [...added, site],
  }));
}

function toggleVisitedPin(url) {
  return editVisited(({ pinned }) => {
    if (pinned.some(p => p.url === url)) return { pinned: pinned.filter(p => p.url !== url) };
    const { title } = visitedSites.find(s => s.url === url);
    return { pinned: [...pinned, { url, title }] };
  });
}

function removeVisited(url) {
  return editVisited(({ removed, pinned, order, added }) => ({
    removed: [...removed, url],
    pinned: pinned.filter(p => p.url !== url),
    order: order.filter(u => u !== url),
    added: added.filter(a => a.url !== url),
  }));
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
let bookmarkTree = null;       // { bar, other } folders from the last getTree
const expandedFolders = new Set(); // folder ids open in the vertical list
let bookmarkListeners = false;
let bookmarkMenus = [];        // open menus, outermost first: { el, anchor }

// Google services get their own icon; other sites use Chrome's favicon cache
function bookmarkIcon(url, size = 32) {
  const service = serviceForUrl(url);
  if (service) return SERVICE_DEFS[service].icon;
  return `<img src="${chrome.runtime.getURL('/_favicon/')}?pageUrl=${encodeURIComponent(url)}&size=${size}" alt="">`;
}

// Bar button for a bookmark or folder; in the vertical list a folder has a chevron and opens in place
const barButton = (node, vertical = false) => node.url
  ? `<button class="bm-btn" data-bookmark="${node.id}" title="${esc(`${node.title}\n${node.url}`)}">${bookmarkIcon(node.url)}${node.title ? `<span>${esc(node.title)}</span>` : ''}</button>`
  : `<button class="bm-btn" data-folder="${node.id}" aria-expanded="${vertical && expandedFolders.has(node.id)}" title="${esc(node.title)}">${SVG_FOLDER}<span>${esc(node.title)}</span>${vertical ? SVG_CHEVRON : ''}</button>`;

// Buttons for nodes; in the vertical list an open folder's contents follow it, indented
function bookmarkButtons(nodes, vertical) {
  return nodes.map(node => barButton(node, vertical) + (vertical && !node.url && expandedFolders.has(node.id)
    ? `<div class="bm-children">${bookmarkButtons(node.children, true) || '<div class="empty">(empty)</div>'}</div>`
    : '')).join('');
}

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
  bookmarkTree = {
    bar: root.children.find(n => n.folderType === 'bookmarks-bar') || root.children[0],
    other: root.children.find(n => n.folderType === 'other') || root.children[1],
  };
  drawBookmarks();
}

function drawBookmarks() {
  closeBookmarkMenus();
  const { bar, other } = bookmarkTree;
  const vertical = bookmarkBar.classList.contains('vertical');
  bookmarkBar.innerHTML = `
    <div class="bm-items">${bookmarkButtons(bar.children, vertical)
      || '<div class="empty">For quick access, place your bookmarks here on the bookmarks bar.</div>'}</div>
    <button class="bm-btn bm-overflow" data-folder="overflow" aria-expanded="false" title="More bookmarks" hidden>»</button>
    ${other?.children.length ? bookmarkButtons([other], vertical) : ''}`;
  fitBookmarks();
}

// Hide bar items that don't fit; they're listed in the » menu instead. A vertical list shows them all.
function fitBookmarks() {
  const items = bookmarkBar.querySelector('.bm-items');
  const overflowBtn = bookmarkBar.querySelector('.bm-overflow');
  if (!items || !overflowBtn) return;
  const buttons = [...items.querySelectorAll('.bm-btn')];
  buttons.forEach(b => { b.hidden = false; });
  if (bookmarkBar.classList.contains('vertical')) { overflowBtn.hidden = true; return; }
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
function openBookmark(node, e) {
  closeBookmarkMenus();
  openLink(node.url, serviceForUrl(node.url), e.ctrlKey || e.metaKey || e.button === 1);
}

function onBookmarkClick(e) {
  const bookmark = e.target.closest('[data-bookmark]');
  if (bookmark) { openBookmark(bookmarkNodes.get(bookmark.dataset.bookmark), e); return; }
  const folder = e.target.closest('[data-folder]');
  if (!folder) return;
  if (bookmarkBar.classList.contains('vertical') && folder.closest('#bookmark-bar')) {
    const id = folder.dataset.folder;
    if (!expandedFolders.delete(id)) expandedFolders.add(id);
    drawBookmarks();
    return;
  }
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

function barRows(entries, iconFor, labelFor, group) {
  const max = entries[0][1];
  return entries.map(([key, count]) => `
    <div class="bar-row">
      ${iconFor(key)}
      <span class="name">${esc(labelFor(key))}</span>
      <div class="bar" style="width:${(count / max) * 100}%"></div>
      <span class="count">${count}</span>
      ${sectionEditing.stats ? `<span class="close" data-remove-stat="${group}" data-key="${esc(key)}" title="Remove">${SVG_CLOSE}</span>` : ''}
    </div>`).join('');
}

async function renderStats() {
  const el = document.getElementById('stats');
  const { stats } = await chrome.storage.local.get({ stats: { services: {}, accounts: {} } });
  const services = Object.entries(stats.services).filter(([h]) => SERVICE_DEFS[h]).sort((a, b) => b[1] - a[1]);
  const accts = Object.entries(stats.accounts).sort((a, b) => b[1] - a[1]);

  // Nothing to edit until something is counted
  if (services.length === 0) sectionEditing.stats = false;
  renderEditButtons('stats', services.length > 0);

  if (services.length === 0) {
    el.innerHTML = '<div class="empty">Services you open through the extension will be counted here.</div>';
    return;
  }

  el.innerHTML = `
    <div class="group-label"><img src="icons/google.webp" width="18" height="18" alt="">Services</div>
    ${barRows(services.slice(0, 10), h => SERVICE_DEFS[h].icon, h => SERVICE_DEFS[h].label, 'services')}
    ${accts.length ? `
      <div class="group-label">${sectionIcon('accounts')}Accounts</div>
      ${barRows(accts, accountIcon, accountLabel, 'accounts')}` : ''}
  `;
}

// Clears the count; the service or account comes back when it's opened again
async function removeStat(group, key) {
  const { stats } = await chrome.storage.local.get({ stats: { services: {}, accounts: {} } });
  delete stats[group][key];
  await chrome.storage.local.set({ stats });
}

// ── Init ───────────────────────────────────────────────────────────────────

function renderAll() {
  renderAccounts();
  renderTabs();
  renderRecent();
  renderVisited();
  renderStats();
  renderBookmarks();
}

async function init() {
  renderClock();
  addSectionIcons();
  const data = await chrome.storage.sync.get({
    accountLabels: {}, accountOrder: [], hiddenAccounts: [], manualAccountCount: 1, dashboardSections: null,
    searchButtons: searchButtons, dashboardTitleFormat: 'auto', dashboardOpenLinks: 'new', dashboardTabPosition: 'next', dashboardSectionHeight: '420', dashboardPlacement: 'top', dashboardSize: '1200', dashboardIcon: 'default', newTabTitle: '', ...GMAIL_DEFAULTS, ...PANEL_DEFAULTS,
  });
  titleFormat = data.dashboardTitleFormat;
  if (!embedded) setPageIcon(document.querySelector('.page-header img'), 64, data.dashboardIcon);
  openLinks = data.dashboardOpenLinks;
  tabPosition = data.dashboardTabPosition;
  applySectionHeight(data.dashboardSectionHeight);
  applyPage(data.dashboardPlacement, data.dashboardSize);
  mailSettings = Object.fromEntries(Object.keys(GMAIL_DEFAULTS).map(key => [key, data[key]]));
  applyMailLook();
  panelSettings = Object.fromEntries(Object.keys(PANEL_DEFAULTS).map(key => [key, data[key]]));
  applyVisitedLook();
  if (isNewTab) document.title = data.newTabTitle || NEW_TAB_TITLE;
  renderClock();
  accountLabels = data.accountLabels;
  accountOrder = data.accountOrder;
  hiddenAccounts = data.hiddenAccounts;
  manualCount = data.manualAccountCount;
  searchButtons = { ...searchButtons, ...data.searchButtons };
  sections = dashboardSections(data.dashboardSections);
  if (embedded) {
    document.body.classList.add('embedded');
    // Listed sections in the popup's order; titles follow Options → Dashboard → Sections
    sections = [
      ...popupIds.map(id => ({ ...sections.find(s => s.id === id), visible: true })),
      ...sections.filter(s => !popupIds.includes(s.id)).map(s => ({ ...s, visible: false })),
    ];
    if (accordion) {
      document.body.classList.add('accordion');
      openSection(accordionOpen);
      for (const head of document.querySelectorAll('#sections > [data-section] > .section-head')) head.tabIndex = 0;
    }
    new ResizeObserver(postHeight).observe(document.body);
  } else {
    document.getElementById('q').focus();
  }
  applyLayout();

  const { accountsCache } = await chrome.storage.local.get('accountsCache');
  if (accountsCache?.accounts?.length) {
    accounts = accountsCache.accounts;
    unread = accountsCache.unread || {};
    mail = accountsCache.mail || {};
    detected = true;
    detecting = false;
  }

  renderAll();
  // dashboard.html?popup=…&focus: the popup has no launcher, so its first control takes the focus
  if (new URLSearchParams(location.search).has('focus')) focusEdge('first');
  refresh();
  scheduleRefresh();
}

document.addEventListener('click', async (e) => {
  const launcherBtn = e.target.closest('[data-launcher]');
  if (launcherBtn) { openLauncher(launcherBtn); return; }

  const inbox = e.target.closest('[data-inbox]');
  if (inbox && !e.ctrlKey && !e.metaKey) { onUnreadBadge(inbox); return; }

  const message = e.target.closest('[data-message]');
  if (message && !e.ctrlKey && !e.metaKey && mailSettings.mailClick === 'preview') { showMessage(message); return; }
  if (e.target.closest('[data-back]')) { showList(e.target.closest('.inbox')); return; }

  // Clicks inside the inbox panel keep it open, except on a link
  if (!e.target.closest('.inbox') || e.target.closest('[data-url]')) closeLauncher();

  const visitedPin = e.target.closest('[data-visited-pin]');
  if (visitedPin) { toggleVisitedPin(visitedPin.dataset.visitedPin); return; }

  const visitedRemove = e.target.closest('[data-visited-remove]');
  if (visitedRemove) { removeVisited(visitedRemove.dataset.visitedRemove); return; }

  const pin = e.target.closest('[data-pin-file]');
  if (pin) { togglePin(pin.dataset.pinFile); return; }

  const removeStatBtn = e.target.closest('[data-remove-stat]');
  if (removeStatBtn) { removeStat(removeStatBtn.dataset.removeStat, removeStatBtn.dataset.key); return; }

  const removeFileBtn = e.target.closest('[data-remove-file]');
  if (removeFileBtn) { removeFile(removeFileBtn.dataset.removeFile); return; }

  const link = e.target.closest('[data-url]');
  if (link) { openLink(link.dataset.url, link.dataset.service, e.ctrlKey || e.metaKey); return; }

  const close = e.target.closest('[data-close-tab]');
  if (close) { chrome.tabs.remove(Number(close.dataset.closeTab)); return; }

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

  if (e.target.id === 'visited-on') {
    try {
      if (await chrome.permissions.request(VISITED_PERMISSIONS)) renderVisited();
    } catch (err) {
      e.target.insertAdjacentText('afterend', ` ${err.message}`);
    }
  }
});

// An accordion head opens its section (or folds it when open), here and in the popup's other frame
document.addEventListener('click', (e) => {
  const head = accordion && e.target.closest('#sections > [data-section] > .section-head');
  if (!head || e.target.closest('button')) return;
  const id = head.parentElement.classList.contains('collapsed') ? head.parentElement.dataset.section : '';
  openSection(id);
  toPopup({ type: 'section', id });
});

window.addEventListener('message', (e) => {
  if (e.source !== parent || e.origin !== location.origin) return;
  if (accordion && e.data.type === 'section') openSection(e.data.id);
  if (e.data.type === 'focus') focusEdge(e.data.at);
});

// ── Keyboard (popup) ───────────────────────────────────────────────────────
// In the toolbar popup the arrow keys move through every control in page order: Up and Down, and
// Left and Right outside a text field. Past the first or last one, the popup moves focus on to the
// launcher or its other frame.

// Clear and the Edit and Reset buttons are mouse-only: the arrow keys skip them
const navItems = () => [...document.querySelectorAll('button, input, .section-head[tabindex]')]
  .filter(el => !el.disabled && el.getClientRects().length && !el.matches('#recent-clear, [data-edit], #recent-reset, #visited-reset, #stats-reset'));

function focusEdge(at) {
  const items = navItems();
  (at === 'last' ? items.at(-1) : items[0])?.focus();
}

if (embedded) {
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    // An accordion head opens or folds its section with Enter or Space
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.section-head[tabindex]')) {
      e.preventDefault();
      e.target.click();
      return;
    }
    const typing = e.target.matches('input');
    const dir = e.key === 'ArrowDown' || (e.key === 'ArrowRight' && !typing) ? 1
      : e.key === 'ArrowUp' || (e.key === 'ArrowLeft' && !typing) ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const items = navItems();
    const next = items[items.indexOf(document.activeElement) + dir] ?? (items.includes(document.activeElement) ? null : items[0]);
    if (next) next.focus();
    else toPopup({ type: 'nav', dir: dir > 0 ? 'next' : 'prev' });
  });
}

document.getElementById('recent-clear').addEventListener('click', async () => {
  await chrome.storage.local.set({ recentClearedAt: Date.now() });
  renderRecent();
});

const EDIT_SECTIONS = {
  recent: {
    render: renderRecent,
    reset: () => chrome.storage.local.set({ recentPinned: [], recentRemoved: {} }),
  },
  visited: {
    render: renderVisited,
    reset: () => chrome.storage.local.set({ visitedEdits: VISITED_EDITS }),
  },
  stats: {
    render: renderStats,
    reset: () => chrome.storage.local.set({ stats: { services: {}, accounts: {} } }),
  },
};

document.querySelectorAll('[data-edit]').forEach(button => button.addEventListener('click', () => {
  const { edit } = button.dataset;
  sectionEditing[edit] = !sectionEditing[edit];
  EDIT_SECTIONS[edit].render();
}));

// Reset asks first: its first click only changes it to Confirm reset, for a few seconds
for (const [id, { reset }] of Object.entries(EDIT_SECTIONS)) {
  const button = document.getElementById(`${id}-reset`);
  let timer = null;
  const disarm = () => {
    clearTimeout(timer);
    timer = null;
    button.textContent = 'Reset';
  };
  button.addEventListener('click', () => {
    if (timer === null) {
      button.textContent = 'Confirm reset';
      timer = setTimeout(disarm, 4000);
      return;
    }
    disarm();
    reset();
  });
}

// Edit mode: drag a row onto another of its kind (pinned or not) to move it before or after that one.
// onMove gets the keys of all draggable rows in their new order.
function makeRowsSortable(id, onMove) {
  const list = document.getElementById(id);
  let dragged = null;
  const isPinned = (row) => !!row.querySelector('.pin.pinned');
  const clear = () => list.querySelectorAll('.drop-before, .drop-after')
    .forEach(el => el.classList.remove('drop-before', 'drop-after'));
  const target = (e) => {
    const row = e.target.closest('.row[draggable]');
    if (!row || row === dragged || isPinned(row) !== isPinned(dragged)) return null;
    const r = row.getBoundingClientRect();
    // The list runs down the section; the other layouts run along a line
    const along = getComputedStyle(list).display !== 'block';
    return { row, before: along ? e.clientX < r.left + r.width / 2 : e.clientY < r.top + r.height / 2 };
  };

  list.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.row[draggable]');
    if (!row) return;
    dragged = row;
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => row.classList.add('dragging'), 0);
  });
  list.addEventListener('dragover', (e) => {
    if (dragged === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clear();
    const t = target(e);
    if (t) t.row.classList.add(t.before ? 'drop-before' : 'drop-after');
  });
  list.addEventListener('drop', (e) => {
    const t = target(e);
    if (!t) return;
    e.preventDefault();
    const rows = [...list.querySelectorAll('.row[draggable]')].filter(row => row !== dragged);
    rows.splice(rows.indexOf(t.row) + (t.before ? 0 : 1), 0, dragged);
    onMove(rows.map(row => row.dataset.item));
  });
  list.addEventListener('dragend', () => {
    dragged?.classList.remove('dragging');
    dragged = null;
    clear();
  });
}

makeRowsSortable('recent', orderPinnedFiles);
makeRowsSortable('visited', urls => editVisited(({ order }) => ({ order: [...urls, ...order.filter(url => !urls.includes(url))] })));

// Most visited in edit mode: add a site by its address
{
  const list = document.getElementById('visited');
  list.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = e.target.elements.url;
    const url = siteUrl(input.value);
    if (url) {
      addVisited(url);
    } else {
      input.setCustomValidity('Enter a site address, like example.com');
      input.reportValidity();
    }
  });
  list.addEventListener('input', e => e.target.setCustomValidity(''));
}

document.getElementById('account-add').addEventListener('click', () => setManualCount(accounts.length + 1));
document.getElementById('account-remove').addEventListener('click', () => setManualCount(Math.max(1, accounts.length - 1)));

document.getElementById('search').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = document.getElementById('q').value.trim();
  // Enter with no search buttons searches Google
  const id = e.submitter?.value ?? 'google';
  const target = SEARCH_TARGETS[id];
  if (!q || !target) return;
  const url = target.url(encodeURIComponent(q), searchAccount[id] ?? 0);
  openLink(url, target.service);
});

chrome.tabs.onCreated.addListener(scheduleRenderTabs);
chrome.tabs.onRemoved.addListener(scheduleRenderTabs);
chrome.tabs.onAttached.addListener(scheduleRenderTabs);
chrome.tabs.onUpdated.addListener((_id, change) => {
  if (change.url || change.title || change.favIconUrl || change.groupId !== undefined) scheduleRenderTabs();
});
chrome.tabGroups.onUpdated.addListener(scheduleRenderTabs);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.stats) renderStats();
  if (area === 'local' && (changes.recentPinned || changes.recentRemoved)) renderRecent();
  if (area === 'local' && changes.visitedEdits) renderVisited();
  if (area !== 'sync') return;
  if (changes.newTabTitle && isNewTab) document.title = changes.newTabTitle.newValue || NEW_TAB_TITLE;
  if (changes.dashboardIcon && !embedded) setPageIcon(document.querySelector('.page-header img'), 64, changes.dashboardIcon.newValue);
  if (changes.dashboardOpenLinks) openLinks = changes.dashboardOpenLinks.newValue;
  if (changes.dashboardTabPosition) tabPosition = changes.dashboardTabPosition.newValue;
  if (changes.dashboardSectionHeight) applySectionHeight(changes.dashboardSectionHeight.newValue);
  if (changes.dashboardPlacement || changes.dashboardSize) {
    chrome.storage.sync.get({ dashboardPlacement: 'top', dashboardSize: '1200' })
      .then(data => applyPage(data.dashboardPlacement, data.dashboardSize));
  }
  const mailChanges = Object.keys(GMAIL_DEFAULTS).filter(key => changes[key]);
  if (mailChanges.length) {
    for (const key of mailChanges) mailSettings[key] = changes[key].newValue ?? GMAIL_DEFAULTS[key];
    applyMailLook();
    renderMail();
    if (changes.mailCheckMinutes) scheduleRefresh();
  }
  if (changes.dashboardTitleFormat) {
    titleFormat = changes.dashboardTitleFormat.newValue;
    renderClock();
  }
  if (changes.searchButtons) {
    searchButtons = { ...searchButtons, ...changes.searchButtons.newValue };
    renderSearch();
    applyLayout();
  }
  const panelChanges = Object.keys(PANEL_DEFAULTS).filter(key => changes[key]);
  if (panelChanges.length) {
    for (const key of panelChanges) panelSettings[key] = changes[key].newValue ?? PANEL_DEFAULTS[key];
    if (panelChanges.some(key => key.startsWith('tabs'))) renderTabs();
    if (panelChanges.some(key => key.startsWith('recent'))) renderRecent();
    if (panelChanges.some(key => key.startsWith('visited'))) {
      applyVisitedLook();
      renderVisited();
    }
  }
  if (changes.accountLabels || changes.accountOrder) {
    accountLabels = changes.accountLabels?.newValue ?? accountLabels;
    accountOrder = changes.accountOrder?.newValue ?? accountOrder;
    renderAll();
  }
  if (changes.hiddenAccounts) {
    hiddenAccounts = changes.hiddenAccounts.newValue ?? [];
    renderAll();
    refresh();
  }
  if (changes.dashboardSections && !embedded) {
    sections = dashboardSections(changes.dashboardSections.newValue);
    applyLayout();
  }
});

// The dashboard coming back into view (its tab selected, or its window focused) shows what changed
// meanwhile: accounts and mail, open tabs, and recent files and most visited sites, whose browser
// history sends no events
let activatedAt = Date.now();  // loading counts, init refreshes
function onActivate() {
  // Selecting the tab fires both visibilitychange and focus
  if (document.visibilityState !== 'visible' || Date.now() - activatedAt < 1000) return;
  activatedAt = Date.now();
  renderClock();
  renderPageIcon();
  renderTabs();
  renderRecent();
  renderVisited();
  refresh();
}

document.addEventListener('visibilitychange', onActivate);
window.addEventListener('focus', onActivate);

init();
