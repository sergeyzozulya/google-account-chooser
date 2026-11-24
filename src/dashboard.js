/* global SERVICE_DEFS, DASHBOARD_SECTIONS, GMAIL_DEFAULTS, PANEL_DEFAULTS, VISITED_EDITS, visitedEditsOf, visitedCountOf, accountFromUrl, accountServiceUrl, accountKey, orderAccounts, dashboardSections, sectionIcon, formatDate, setPageIcon, renderPageIcon */

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
let searchLayout = 'separate';  // search buttons side by side, or one 'menu' button with every search in its menu
let searchTarget = null;  // with one button: the search it runs, chosen in its menu
let searchLabels = 'text';  // search buttons show their 'text' ("Gmail: account"), the service's 'icon', or 'both'
let searchRemember = false;  // with one button: keep the menu's choice (chrome.storage.local searchChoice) across reloads
let searchTypeToFocus = false;  // typing outside a field goes into the search field
let searchSuggest = suggestSources(null);  // where suggestions come from as you type, in order: [{ id, on }]
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
  google: { label: 'Google', icon: 'google.webp', url: (q) => `https://www.google.com/search?q=${q}` },
  gmail:  { label: 'Gmail', icon: 'gmail.webp', service: 'mail.google.com',  url: (q, n) => `https://mail.google.com/mail/u/${n}/#search/${q}` },
  drive:  { label: 'Drive', icon: 'drive.webp', service: 'drive.google.com', url: (q, n) => `https://drive.google.com/drive/u/${n}/search?q=${q}` },
};

const searchButtonsEl = document.getElementById('search-buttons');

const accountOption = (a, selected, target = '') => `
  <button type="button" class="picker-option" role="option" data-account="${a.index}"${target && ` data-target="${target}"`}
          aria-selected="${selected}">
    ${avatarHtml(a.photo, displayName(a), 'avatar sm')}<span>${esc(displayName(a))}</span>
  </button>`;

function renderSearch() {
  const list = shownAccounts();
  const shown = Object.keys(SEARCH_TARGETS).filter(t => searchButtons[t]);
  for (const t of shown) {
    if (t !== 'google' && !list.some(a => a.index === searchAccount[t])) searchAccount[t] = list[0]?.index ?? 0;
  }
  // "Gmail: account": the service first, which a long account name would otherwise cut off
  const searchTitle = (t) => {
    const current = t !== 'google' && list.find(a => a.index === searchAccount[t]);
    return `${SEARCH_TARGETS[t].label}${current ? `: ${displayName(current)}` : ''}`;
  };
  // A button's content: the title, the service icon and the account's avatar with the title as tooltip, or the icon and the title
  const searchLabel = (t, title) => {
    if (searchLabels === 'text') return esc(title);
    const icon = `<img src="icons/${SEARCH_TARGETS[t].icon}" width="20" height="20" alt="">`;
    if (searchLabels === 'both') return `${icon}<span>${esc(title)}</span>`;
    const current = t !== 'google' && list.find(a => a.index === searchAccount[t]);
    return `<img src="icons/${SEARCH_TARGETS[t].icon}" width="20" height="20" alt="${esc(title)}">${current ? avatarHtml(current.photo, displayName(current), 'avatar sm') : ''}`;
  };
  document.getElementById('search').classList.toggle('icon-labels', searchLabels !== 'text');
  document.getElementById('search').classList.toggle('icon-only', searchLabels === 'icon');

  // One button: it runs the search last chosen in its menu, where each search lists its accounts
  const oneButton = searchLayout === 'menu' && shown.length > 1;
  document.getElementById('search').classList.toggle('one-button', oneButton);
  if (oneButton) {
    if (!shown.includes(searchTarget)) searchTarget = shown[0];
    const title = searchTitle(searchTarget);
    // With icons, one control: it opens the menu, and Enter in the field runs the search it shows
    const single = searchLabels === 'icon';
    searchButtonsEl.innerHTML = `
      <div class="split${single ? ' single' : ''}" data-target="${searchTarget}">
        ${single
          ? `<button type="button" class="split-toggle" title="${esc(title)} · Choose search" aria-haspopup="listbox" aria-expanded="false">${searchLabel(searchTarget, title)}</button>`
          : `<button type="submit" value="${searchTarget}" class="split-main search-default" title="${esc(title)}">${searchLabel(searchTarget, title)}</button>
        <button type="button" class="split-toggle" title="Choose search" aria-haspopup="listbox" aria-expanded="false"></button>`}
        <div class="picker-menu" role="listbox" hidden>
          ${shown.map(t => t === 'google'
            ? `<button type="button" class="picker-option" role="option" data-target="google" aria-selected="${searchTarget === 'google'}"><img src="icons/google.webp" width="18" height="18" alt=""><span>Google</span></button>`
            : `<div class="picker-group"><img src="icons/${SEARCH_TARGETS[t].icon}" width="14" height="14" alt="">${SEARCH_TARGETS[t].label}</div>
              ${list.map(a => accountOption(a, searchTarget === t && a.index === searchAccount[t], t)).join('')}`).join('')}
        </div>
      </div>`;
    return;
  }

  searchButtonsEl.innerHTML = shown.map((t, i) => {
    const cls = i === 0 ? 'search-default' : '';
    if (t === 'google') return `<button type="submit" value="google" class="${cls}" title="Google">${searchLabel('google', 'Google')}</button>`;

    const title = searchTitle(t);
    return `
      <div class="split" data-target="${t}">
        <button type="submit" value="${t}" class="split-main ${cls}" title="${esc(title)}">${searchLabel(t, title)}</button>
        <button type="button" class="split-toggle" title="Choose account" aria-haspopup="listbox" aria-expanded="false"></button>
        <div class="picker-menu" role="listbox" hidden>
          ${list.map(a => accountOption(a, a.index === searchAccount[t])).join('')}
        </div>
      </div>`;
  }).join('');
}

// A remembered choice of the one search button: renderSearch drops a search turned off or an account gone
function applySearchChoice(choice) {
  if (!choice) return;
  searchTarget = choice.target;
  if (choice.account !== null) searchAccount[choice.target] = choice.account;
}

function toggleMenu(split, open) {
  const menu = split.querySelector('.picker-menu');
  menu.hidden = !open;
  split.querySelector('.split-toggle').setAttribute('aria-expanded', open);
  if (open) (menu.querySelector('[aria-selected="true"]') || menu.querySelector('.picker-option'))?.focus();
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
  const option = e.target.closest('.picker-option');
  if (option) {
    const target = option.dataset.target ?? split.dataset.target;
    searchTarget = target;
    if (option.dataset.account) searchAccount[target] = Number(option.dataset.account);
    if (searchLayout === 'menu' && searchRemember) chrome.storage.local.set({ searchChoice: { target, account: searchAccount[target] ?? null } });
    renderSearch();
    // The one control with icons searches right away for what's typed
    if (split.classList.contains('single') && qInput.value.trim()) runSearch(target);
    else document.getElementById('q').focus();
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
// "Inbox" and Open Gmail above a list
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

// ── Most visited (optional favicon permission, plus topSites or history) ───
// Options → Most visited → Source: Chrome's own list, the one its New Tab page shows; sites counted
// from browser history; or only the sites added in Edit mode

const VISITED_SOURCES = {
  chrome: {
    permissions: ['topSites', 'favicon'],
    intro: 'Show the sites you visit most, from the list Chrome keeps for its New Tab page. The list stays on this device.',
    sites: () => chrome.topSites.get(),
  },
  history: {
    permissions: ['history', 'favicon'],
    intro: 'Show the sites you visit most, counted from your browser history. History stays on this device.',
    sites: historySites,
  },
  mine: {
    permissions: ['favicon'],
    intro: 'Show the sites you add yourself, with their icons.',
    sites: async () => [],
  },
};

const visitedSource = () => VISITED_SOURCES[panelSettings.visitedSource] ?? VISITED_SOURCES.chrome;
const visitedPermissions = () => ({ permissions: visitedSource().permissions });
const hostOf = (url) => new URL(url).hostname;

// Sites visited in Options → Most visited → Period, by visits. Account Chooser is left out: this
// extension sends Google links through it, so it would top the list.
async function historySites() {
  const items = await chrome.history.search({ text: '', startTime: Date.now() - panelSettings.visitedDays * 864e5, maxResults: 5000 });
  const sites = new Map();
  for (const item of items) {
    let url;
    try { url = new URL(item.url); } catch { continue; }
    if (!/^https?:$/.test(url.protocol) || url.hostname === 'accounts.google.com') continue;
    if (!sites.has(url.origin)) sites.set(url.origin, { url: `${url.origin}/`, title: url.hostname.replace(/^www\./, ''), visits: 0, top: 0 });
    const site = sites.get(url.origin);
    site.visits += item.visitCount;
    // The icon of the site's most visited page: Chrome may have none for a home page never opened
    if (item.visitCount > site.top) Object.assign(site, { top: item.visitCount, iconUrl: item.url });
  }
  return [...sites.values()].sort((a, b) => b.visits - a.visits);
}

// A host's registrable domain: its last two labels, or three under a ccTLD's com., co., org. and the
// like (bbc.co.uk). IP addresses and single-label hosts stay as they are.
const COUNTRY_SECOND_LEVELS = new Set(['ac', 'co', 'com', 'edu', 'gob', 'gov', 'mil', 'ne', 'net', 'or', 'org']);
function domainOf(host) {
  if (/^[\d.]+$|:/.test(host)) return host;
  const labels = host.split('.');
  const country = labels.length > 2 && labels.at(-1).length === 2 && COUNTRY_SECOND_LEVELS.has(labels.at(-2));
  return labels.slice(country ? -3 : -2).join('.');
}

// Options → Most visited → Group by domain: one site per domain, in the place of its first site, its
// visits added up; the domain's own address unless its first site is the domain itself
function sitesByDomain(sites) {
  const domains = new Map();
  for (const s of sites) {
    const domain = domainOf(hostOf(s.url));
    const site = domains.get(domain);
    if (site) site.visits += s.visits ?? 0;
    else domains.set(domain, {
      url: hostOf(s.url) === domain ? s.url : `https://${domain}/`,
      title: domain,
      iconUrl: s.iconUrl ?? s.url,
      visits: s.visits ?? 0,
    });
  }
  return [...domains.values()].sort((a, b) => b.visits - a.visits);
}

// Options → Most visited → Icons (with large icons per row, or small ones' columns) and Text. Small
// icons in one column are a list like the other sections'; in more, or Auto, they're laid out in a row.
function applyVisitedLook() {
  const el = document.getElementById('visited');
  const large = panelSettings.visitedIcons === 'large';
  const columns = large ? panelSettings.visitedLargePerRow : panelSettings.visitedColumns;
  el.classList.toggle('large', large);
  el.classList.toggle('small-row', !large && columns !== '1');
  el.classList.toggle('icons-only', !panelSettings.visitedText);
  el.classList.toggle('fixed-columns', columns !== 'auto');
  el.style.setProperty('--visited-columns', columns);
}

let visitedSites = [];  // listed sites, in order
const VISIT_COUNT = new Intl.NumberFormat(undefined, { notation: 'compact' });  // 1.2K
let visitedSourceUrls = new Set();  // urls of the sites the source lists, from the last render

async function renderVisited() {
  const el = document.getElementById('visited');
  const granted = await chrome.permissions.contains(visitedPermissions());
  const editing = sectionEditing.visited;
  renderEditButtons('visited', granted);

  if (!granted) {
    el.innerHTML = `
      <div class="empty">
        ${visitedSource().intro}<br>
        <button class="text-btn" id="visited-on">Turn on</button>
      </div>`;
    return;
  }

  const { removed, pinned, order, added, names } = await visitedEdits();
  // Removed sites aren't listed from the source; sites added by hand always are
  const listed = await visitedSource().sites();
  const source = (panelSettings.visitedByDomain ? sitesByDomain(listed) : listed).filter(s => !removed.includes(hostOf(s.url)));
  visitedSourceUrls = new Set(source.map(s => s.url));
  const sites = [...added.filter(a => !source.some(s => s.url === a.url)), ...source];
  const rank = (s) => {
    const i = order.indexOf(s.url);
    return i === -1 ? Infinity : i;
  };
  const inOrder = (list) => [...list].sort((a, b) => rank(a) - rank(b));
  const pins = inOrder(pinned.map(p => sites.find(s => s.url === p.url) ?? p));
  const rest = inOrder(sites.filter(s => !pinned.some(p => p.url === s.url)));
  // Pinned sites always show; the others fill up to Options → Most visited → Sites listed, which
  // doesn't limit the sites added by hand alone
  const room = panelSettings.visitedSource === 'mine' ? Infinity : Math.max(0, visitedCountOf(panelSettings.visitedCount) - pins.length);
  visitedSites = [...pins, ...rest.slice(0, room)];

  const isPinned = (s) => pinned.some(p => p.url === s.url);
  const name = (s) => names[s.url] || s.title || s.url;
  // Options → Most visited → Visits
  const visits = (s) => panelSettings.visitedVisits && panelSettings.visitedSource === 'history' && s.visits
    ? `<span class="meta" title="${s.visits} ${s.visits === 1 ? 'visit' : 'visits'}">${VISIT_COUNT.format(s.visits)}</span>` : '';
  // In edit mode rows don't open their site: they drag, the name renames, and they carry the pin
  // and remove buttons
  const row = (s) => `
    <button class="row" ${editing
      ? `data-item="${esc(s.url)}" draggable="true"`
      : `data-url="${esc(s.url)}" data-service="${serviceForUrl(s.url) || ''}"`} title="${esc(`${name(s)}\n${s.url}`)}">
      ${bookmarkIcon(s.iconUrl ?? s.url, 64)}
      <span class="title"${editing ? ` data-visited-rename="${esc(s.url)}" title="Rename"` : ''}>${esc(name(s))}</span>
      ${visits(s)}
      ${editing ? editButtons(isPinned(s), 'data-visited-pin', 'data-visited-remove', s.url) : ''}
    </button>`;
  const empty = panelSettings.visitedSource === 'mine' ? `No sites yet.${editing ? '' : ' Use Edit to add one.'}`
    : removed.length ? `No sites to list. Use Reset${editing ? '' : ' in Edit'}, or Options → Most visited, to bring back removed ones.`
    : `No most visited sites yet.${editing ? '' : ' Use Edit to add one.'}`;
  el.innerHTML = (visitedSites.length ? visitedSites.map(row).join('') : `<div class="empty">${empty}</div>`)
    + (editing ? `
      <form id="visited-add">
        <input name="url" placeholder="Add a site, like example.com" aria-label="Site address" autocomplete="off" required>
        <button class="text-btn">Add</button>
      </form>` : '');
}

async function visitedEdits() {
  const { visitedEdits } = await chrome.storage.local.get({ visitedEdits: VISITED_EDITS });
  return visitedEditsOf(visitedEdits);
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

// Added sites go to the top of the list; adding one brings back its removed site
function addVisited(url) {
  const site = { url, title: hostOf(url).replace(/^www\./, '') };
  return editVisited(({ removed, order, added }) => ({
    removed: removed.filter(host => host !== hostOf(url)),
    order: [url, ...order.filter(u => u !== url)],
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

// Remove hides every page of the site from the source; a site added by hand is deleted
function removeVisited(url) {
  return editVisited(({ removed, pinned, order, added, names }) => {
    const host = hostOf(url);
    const keep = (u) => hostOf(u) !== host;
    const hide = visitedSourceUrls.has(url) || !added.some(a => a.url === url);
    return {
      removed: hide ? [...removed, host] : removed,
      pinned: pinned.filter(p => keep(p.url)),
      order: order.filter(keep),
      added: added.filter(a => a.url !== url),
      names: Object.fromEntries(Object.entries(names).filter(([u]) => keep(u))),
    };
  });
}

// An empty name goes back to the site's own
function renameVisited(url, name) {
  return editVisited(({ names }) => {
    const { [url]: _, ...rest } = names;
    return { names: name ? { ...rest, [url]: name } : rest };
  });
}

// The name in edit mode turns into a field: Enter saves, Escape or leaving it cancels
function startVisitedRename(title) {
  const url = title.dataset.visitedRename;
  const row = title.closest('.row');
  const form = document.createElement('form');
  form.className = 'row visited-rename';
  form.innerHTML = `${row.querySelector('img, svg')?.outerHTML ?? ''}
    <input name="name" value="${esc(title.textContent)}" placeholder="${esc(visitedSites.find(s => s.url === url)?.title || url)}" aria-label="Site name" autocomplete="off">`;
  form.dataset.url = url;
  row.replaceWith(form);
  const input = form.elements.name;
  input.select();
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') renderVisited();
  });
  input.addEventListener('blur', () => form.isConnected && renderVisited());
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
    searchButtons: searchButtons, searchLayout: 'separate', searchLabels: 'text', searchRemember: false, searchTypeToFocus: false, searchSuggest: null, dashboardTitleFormat: 'auto', dashboardOpenLinks: 'new', dashboardTabPosition: 'next', dashboardSectionHeight: '420', dashboardPlacement: 'top', dashboardSize: '1200', dashboardIcon: 'default', newTabTitle: '', ...GMAIL_DEFAULTS, ...PANEL_DEFAULTS,
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
  searchLayout = data.searchLayout;
  searchLabels = data.searchLabels;
  searchRemember = data.searchRemember;
  searchTypeToFocus = data.searchTypeToFocus;
  searchSuggest = suggestSources(data.searchSuggest);
  if (searchRemember) applySearchChoice((await chrome.storage.local.get('searchChoice')).searchChoice);
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

  const visitedRename = e.target.closest('[data-visited-rename]');
  if (visitedRename) { startVisitedRename(visitedRename); return; }

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
      if (await chrome.permissions.request(visitedPermissions())) renderVisited();
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

// Most visited in edit mode: add a site by its address, or save its new name
{
  const list = document.getElementById('visited');
  list.addEventListener('submit', (e) => {
    e.preventDefault();
    if (e.target.matches('.visited-rename')) {
      e.target.remove();
      renameVisited(e.target.dataset.url, e.target.elements.name.value.trim()).then(renderVisited);
      return;
    }
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

// Options → Search → Type to search: a character typed outside a field moves focus to the search
// field, which then gets it. Space still scrolls, and shortcuts are left alone.
document.addEventListener('keydown', (e) => {
  if (!searchTypeToFocus || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key.length !== 1 || e.key === ' ' || e.target.closest('input, textarea, select, [contenteditable]')) return;
  const q = document.getElementById('q');
  if (q.getClientRects().length) q.focus();
});

// ── Search suggestions (Options → Search → Suggestions) ───────────────────
// Like Chrome's address bar: answers (calculator, units, time), Gmail search words, open tabs,
// Google services and new files in an account, sites from browser history, bookmarks and most
// visited, and Google's own suggestions, each when it's turned on there (and its permission is
// granted), in the order set there. The best site whose address starts with what's typed completes
// it in the field, selected, so typing on replaces it; ↑ and ↓ pick a suggestion and Enter or a
// click runs it.

const qInput = document.getElementById('q');
const suggestEl = document.createElement('div');
suggestEl.className = 'suggestions';
suggestEl.setAttribute('role', 'listbox');
suggestEl.hidden = true;
qInput.closest('.search-field').append(suggestEl);

// A suggestion: { icon, title, detail, kind, fill (put in the field by ↑ and ↓), and what it does:
// url (+ service) to open, chromeUrl (a Chrome page) to open, tabId to switch to, or copy to put in
// the field and on the clipboard }
let suggestions = [];    // shown, in order
let suggestIndex = -1;   // the one picked with ↑ and ↓, or -1 for what's typed
let typedText = '';      // what's typed, without the completion
let completion = null;   // the suggestion completing the field, if any
let suggestRun = 0;      // the latest lookup; older ones that finish later are dropped
const SUGGEST_LIMIT = 8;

const bareUrl = (url) => url.replace(/^https?:\/\/(www\.)?/i, '');
const serviceIcon = (host) => SERVICE_DEFS[host]?.icon ?? '';

// Sites from browser history, bookmarks and most visited: [{ url, title, sources, prefix, score }] best first
async function lookupSites(text, wanted) {
  const [history, bookmarks, topSites] = await Promise.all(['history', 'bookmarks', 'topSites']
    .map(p => wanted.has(p) && chrome.permissions.contains({ permissions: [p] })));
  if (!history && !bookmarks && !topSites) return [];
  // Chrome's own search may miss a word still being typed ("blaze w"), so it gets the longest word
  // only, and history's latest pages are looked through as well; every word is matched below
  const longest = text.split(/\s+/).reduce((a, b) => (b.length > a.length ? b : a), '');
  const [found, latest, marked, top] = await Promise.all([
    history ? chrome.history.search({ text: longest, startTime: 0, maxResults: 500 }) : [],
    history ? chrome.history.search({ text: '', startTime: 0, maxResults: 1000 }) : [],
    bookmarks ? chrome.bookmarks.search(longest) : [],
    topSites ? chrome.topSites.get() : [],
  ]);
  const visited = [...new Map([...latest, ...found].map(h => [h.url, h])).values()];
  const sites = new Map();  // url → { url, title, weight, sources }
  const add = (url, title, weight, sources) => {
    if (!url || !/^https?:/i.test(url) || new URL(url).hostname === 'accounts.google.com') return;
    const site = sites.get(url) ?? { url, title: title || '', weight: 0, sources: new Set() };
    site.weight += weight;
    sources.forEach(source => site.sources.add(source));
    if (!site.title && title) site.title = title;
    sites.set(url, site);
  };
  for (const h of visited) add(h.url, h.title, Math.log1p(h.visitCount + 5 * h.typedCount) + (Date.now() - h.lastVisitTime < 7 * 864e5 ? 1 : 0), ['history']);
  for (const b of marked) add(b.url, b.title, 3, ['bookmarks']);
  for (const t of top) add(t.url, t.title, 2, ['topSites']);
  // A site typed by its address also suggests its home page, which is what the field completes to
  const lower = text.toLowerCase();
  for (const site of [...sites.values()]) {
    const u = new URL(site.url);
    if (bareUrl(u.origin).toLowerCase().startsWith(lower) && !sites.has(`${u.origin}/`)) add(`${u.origin}/`, u.hostname.replace(/^www\./, ''), site.weight / 2, site.sources);
  }

  // Where the text matches: the start of the address, then the start of a word in the title or of a
  // part of the address, then anywhere; every word typed has to match. A title with what's typed in
  // it as a phrase ranks above them, as a file's or page's name usually is what's typed.
  const escape = (w) => w.replace(/[.*+?^$()|[\]{}\\]/g, '\\$&');
  const words = lower.split(/\s+/).filter(Boolean);
  const gap = '[^\\p{L}\\p{N}]';  // not a letter or digit, in any script
  // Each word typed starts a word of the title, one after another: "blaz webs" in "Blaze Website"
  const phrase = new RegExp(`(^|${gap})${words.map(escape).join(`[\\p{L}\\p{N}]*${gap}+`)}`, 'u');
  const scored = [...sites.values()].map(site => {
    const address = bareUrl(site.url).toLowerCase();
    const title = site.title.toLowerCase();
    const at = (w) => address.startsWith(w) ? 4
      : new RegExp(`(^|${gap})${escape(w)}`, 'u').test(title) || new RegExp(`[./?=&_-]${escape(w)}`).test(address) ? 3
      : address.includes(w) || title.includes(w) ? 1 : 0;
    const match = words.map(at);
    // A typed word that's a whole word of the title, like "blaze" in "Blaze Website" but not in
    // "blazereviews", counts a little more
    const whole = words.filter(w => new RegExp(`(^|${gap})${escape(w)}(${gap}|$)`, 'u').test(title)).length;
    const score = match.includes(0) ? 0 : Math.min(...match) * 10 + (phrase.test(title) ? 15 : 0) + whole * 4 + site.weight;
    return { ...site, prefix: address.startsWith(lower), score };
  }).filter(s => s.score > 0);
  scored.sort((a, b) => b.prefix - a.prefix || b.score - a.score || a.url.length - b.url.length);
  return scored.slice(0, 6);
}

// What a site is: a Docs, Sheets, Slides or Forms file, or else where it came from, a bookmark
// first, as Chrome's address bar marks them
const FILE_KINDS = { document: 'Document', spreadsheets: 'Spreadsheet', presentation: 'Presentation', forms: 'Form' };

function siteKind(s) {
  const file = s.url.match(/^https:\/\/docs\.google\.com\/(document|spreadsheets|presentation|forms)\/(?:u\/\d+\/)?d\//);
  if (file) return FILE_KINDS[file[1]];
  if (s.sources.has('bookmarks')) return 'Bookmark';
  if (s.sources.has('topSites')) return 'Most visited';
  return 'History';
}

const siteSuggestion = (s) => ({
  icon: bookmarkIcon(s.url), title: s.title || bareUrl(s.url), detail: bareUrl(s.url), kind: siteKind(s),
  url: s.url, fill: bareUrl(s.url).replace(/\/$/, ''), prefix: s.prefix, sources: s.sources,
});

// A number as people write it, rounded off floating-point noise
const formatNumber = (n, digits = 12) => Number(n.toPrecision(digits)).toLocaleString(undefined, { maximumFractionDigits: 10 });
const plainNumber = (n, digits = 12) => String(Number(n.toPrecision(digits)));

// Calculator: + - * / ^, ( ), % after a number (15% of 80 too), pi, e, sqrt, sin, cos, tan, log, ln, abs, round
const CALC_FUNCTIONS = { sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, tan: Math.tan, log: Math.log10, ln: Math.log, abs: Math.abs, round: Math.round };

function calculate(text) {
  const source = text.replace(/^=\s*/, '').toLowerCase().replace(/×/g, '*').replace(/÷/g, '/').replace(/%\s*of\b/g, '%*');
  if (!/\d/.test(source) || !/[-+*/^%(]|[a-z]/.test(source.replace(/^-/, ''))) return null;
  const tokens = source.match(/\d*\.?\d+(?:e[-+]?\d+)?|[a-z]+|\*\*|[-+*/^%()]|\S/g);
  let i = 0;
  const peek = () => tokens[i];
  const fail = () => { throw new Error('not a calculation'); };
  const expect = (t) => (tokens[i++] === t ? t : fail());
  const expr = () => {
    let v = term();
    while (peek() === '+' || peek() === '-') v = tokens[i++] === '+' ? v + term() : v - term();
    return v;
  };
  const term = () => {
    let v = power();
    while (peek() === '*' || peek() === '/') v = tokens[i++] === '*' ? v * power() : v / power();
    return v;
  };
  const power = () => {
    const v = unary();
    if (peek() === '^' || peek() === '**') { i++; return v ** power(); }
    return v;
  };
  const unary = () => {
    if (peek() === '-') { i++; return -unary(); }
    if (peek() === '+') { i++; return unary(); }
    let v = primary();
    while (peek() === '%') { i++; v /= 100; }
    return v;
  };
  const primary = () => {
    const t = tokens[i++];
    if (t === undefined) fail();
    if (/^\d|^\./.test(t)) return Number(t);
    if (t === '(') { const v = expr(); expect(')'); return v; }
    if (t === 'pi') return Math.PI;
    if (t === 'e') return Math.E;
    if (CALC_FUNCTIONS[t]) { expect('('); const v = expr(); expect(')'); return CALC_FUNCTIONS[t](v); }
    return fail();
  };
  try {
    const value = expr();
    return i === tokens.length && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function calcSuggestions(text) {
  const date = dateMath(text);
  if (date) return [{ icon: suggestIcon('calc', 16), title: date.title, detail: date.detail, kind: 'Date', copy: date.title, fill: text }];
  const value = calculate(text);
  if (value === null) return [];
  return [{ icon: suggestIcon('calc', 16), title: formatNumber(value), detail: text.replace(/^=\s*/, ''), kind: 'Calculator', copy: plainNumber(value), fill: text }];
}

// Date math: today, tomorrow, yesterday, 2026-12-25, dec 25, 25 december 2026; days until or since
// a date, a date plus or minus days, weeks, months or years, the days between two dates, the week
// number. A date without a year is the next one (until) or the last one (since).
const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const DAY_MS = 864e5;
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const longDate = (d) => d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const daysBetween = (a, b) => Math.round((b - a) / DAY_MS);

function parseDate(text) {
  const t = text.trim().toLowerCase().replace(/,/g, '');
  const today = startOfToday();
  const shift = { today: 0, tomorrow: 1, yesterday: -1 }[t];
  if (shift !== undefined) return { date: new Date(today.getFullYear(), today.getMonth(), today.getDate() + shift), year: true };
  const month = (name) => (name.length >= 3 ? MONTH_NAMES.findIndex(m => m.startsWith(name.replace(/\.$/, ''))) : -1);
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return { date: new Date(m[1], m[2] - 1, m[3]), year: true };
  m = t.match(/^([a-z.]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(\d{4}))?$/) ?? t.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z.]+)(?:\s+(\d{4}))?$/)?.slice(0, 4);
  if (!m) return null;
  const [name, day] = /^\d/.test(m[1]) ? [m[2], m[1]] : [m[1], m[2]];
  const index = month(name);
  if (index < 0 || day < 1 || day > 31) return null;
  return { date: new Date(m[3] ?? today.getFullYear(), index, day), year: Boolean(m[3]) };
}

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / DAY_MS + 1) / 7);
}

function dateMath(text) {
  const t = text.trim().toLowerCase();
  const today = startOfToday();
  const days = (n) => `${n.toLocaleString()} ${Math.abs(n) === 1 ? 'day' : 'days'}${Math.abs(n) >= 14 ? ` (${Math.floor(Math.abs(n) / 7)} weeks${Math.abs(n) % 7 ? ` ${Math.abs(n) % 7} d` : ''})` : ''}`;
  let m = t.match(/^(?:how many\s+)?(?:days\s+)?(until|till|to|since)\s+(.+)$/);
  if (m) {
    const d = parseDate(m[2]);
    if (!d) return null;
    const since = m[1] === 'since';
    if (!d.year && (since ? d.date > today : d.date < today)) d.date.setFullYear(d.date.getFullYear() + (since ? -1 : 1));
    return { title: days(since ? daysBetween(d.date, today) : daysBetween(today, d.date)), detail: `${since ? 'since' : 'until'} ${longDate(d.date)}` };
  }
  m = t.match(/^(.+?)\s*([+-])\s*(\d+)\s*(d|days?|w|weeks?|m|months?|y|years?)$/);
  if (m) {
    const d = parseDate(m[1]);
    if (!d) return null;
    const n = Number(m[3]) * (m[2] === '-' ? -1 : 1);
    const date = new Date(d.date);
    const unit = m[4][0];
    if (unit === 'd' || unit === 'w') date.setDate(date.getDate() + n * (unit === 'w' ? 7 : 1));
    else date.setMonth(date.getMonth() + n * (unit === 'y' ? 12 : 1));
    return { title: longDate(date), detail: `${m[1]} ${m[2]} ${m[3]} ${m[4]}` };
  }
  m = t.match(/^(.+?)\s+-\s+(.+)$/);
  if (m) {
    const [a, b] = [parseDate(m[1]), parseDate(m[2])];
    if (!a || !b) return null;
    return { title: days(daysBetween(b.date, a.date)), detail: `from ${longDate(b.date)} to ${longDate(a.date)}` };
  }
  m = t.match(/^week(?:\s+(?:number|no\.?|#))?(?:\s+(?:of\s+)?(.+))?$/);
  if (m) {
    const d = m[1] ? parseDate(m[1]) : { date: today };
    if (!d) return null;
    return { title: `Week ${isoWeek(d.date)}`, detail: longDate(d.date) };
  }
  const d = parseDate(t);
  if (!d) return null;
  const n = daysBetween(today, d.date);
  return { title: longDate(d.date), detail: n === 0 ? 'today' : n > 0 ? `in ${days(n)}` : `${days(-n)} ago` };
}

// Units by kind, each as its size in the kind's base unit; temperatures convert by formula
const UNITS = {
  length: { m: 1, meter: 1, metre: 1, mm: 1e-3, cm: 1e-2, km: 1e3, kilometer: 1e3, kilometre: 1e3, in: .0254, inch: .0254, ft: .3048, foot: .3048, feet: .3048, yd: .9144, yard: .9144, mi: 1609.344, mile: 1609.344, nmi: 1852 },
  mass: { g: 1, gram: 1, mg: 1e-3, kg: 1e3, kilogram: 1e3, t: 1e6, ton: 1e6, tonne: 1e6, oz: 28.349523125, ounce: 28.349523125, lb: 453.59237, pound: 453.59237, st: 6350.29318, stone: 6350.29318 },
  volume: { l: 1, liter: 1, litre: 1, ml: 1e-3, cl: 1e-2, dl: .1, gal: 3.785411784, gallon: 3.785411784, qt: .946352946, quart: .946352946, pt: .473176473, pint: .473176473, cup: .2365882365, floz: .0295735295625, tbsp: .01478676478125, tsp: .00492892159375 },
  speed: { 'm/s': 1, 'km/h': 1 / 3.6, kmh: 1 / 3.6, kph: 1 / 3.6, mph: .44704, kn: .514444, knot: .514444 },
  data: { b: 1, byte: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4 },
};
const TEMPERATURES = {
  c: { toK: v => v + 273.15, fromK: k => k - 273.15, name: '°C' },
  f: { toK: v => (v - 32) * 5 / 9 + 273.15, fromK: k => (k - 273.15) * 9 / 5 + 32, name: '°F' },
  k: { toK: v => v, fromK: k => k, name: 'K' },
};
const TEMPERATURE_NAMES = { celsius: 'c', fahrenheit: 'f', kelvin: 'k' };

// A unit as typed: lower case, without ° and spaces, and singular ("miles", "fl oz", "°F")
function unitOf(text) {
  let u = text.toLowerCase().replace(/[°\s.]/g, '');
  if (TEMPERATURES[u] || TEMPERATURE_NAMES[u]) return { temperature: TEMPERATURES[u] ? u : TEMPERATURE_NAMES[u] };
  for (const name of [u, u.replace(/e?s$/, ''), u.replace(/s$/, '')]) {
    for (const [kind, units] of Object.entries(UNITS)) if (units[name]) return { kind, size: units[name], name };
  }
  return null;
}

function convertSuggestions(text) {
  const m = text.match(/^(-?\d*\.?\d+)\s*([a-z°/ .]+?)\s+(?:in|to|into|as|=)\s+([a-z°/ .]+?)$/i);
  if (!m) return [];
  const value = Number(m[1]);
  const from = unitOf(m[2]);
  const to = unitOf(m[3]);
  if (!from || !to) return [];
  let result;
  let toName = m[3].trim();
  if (from.temperature && to.temperature) {
    result = TEMPERATURES[to.temperature].fromK(TEMPERATURES[from.temperature].toK(value));
    toName = TEMPERATURES[to.temperature].name;
  } else if (from.kind && from.kind === to.kind) {
    result = value * from.size / to.size;
  } else {
    return [];
  }
  return [{ icon: suggestIcon('convert', 16), title: `${formatNumber(result, 6)} ${toName}`, detail: text, kind: 'Conversion', copy: plainNumber(result, 6), fill: text }];
}

// Time in a city: its time zone by the city's name in the zone (Tokyo, New York), or a common city
// or name that isn't one
const TIME_ALIASES = {
  utc: 'UTC', gmt: 'UTC', nyc: 'America/New_York', boston: 'America/New_York', washington: 'America/New_York', miami: 'America/New_York',
  atlanta: 'America/New_York', philadelphia: 'America/New_York', montreal: 'America/Toronto', ottawa: 'America/Toronto',
  'san francisco': 'America/Los_Angeles', sf: 'America/Los_Angeles', seattle: 'America/Los_Angeles', la: 'America/Los_Angeles',
  'san diego': 'America/Los_Angeles', 'las vegas': 'America/Los_Angeles', dallas: 'America/Chicago', houston: 'America/Chicago',
  austin: 'America/Chicago', beijing: 'Asia/Shanghai', 'hong kong': 'Asia/Hong_Kong', delhi: 'Asia/Kolkata', 'new delhi': 'Asia/Kolkata',
  mumbai: 'Asia/Kolkata', bangalore: 'Asia/Kolkata', bengaluru: 'Asia/Kolkata', osaka: 'Asia/Tokyo', kyoto: 'Asia/Tokyo',
  kyiv: 'Europe/Kiev', kiev: 'Europe/Kiev', munich: 'Europe/Berlin', frankfurt: 'Europe/Berlin', hamburg: 'Europe/Berlin',
  barcelona: 'Europe/Madrid', milan: 'Europe/Rome', 'st petersburg': 'Europe/Moscow', 'tel aviv': 'Asia/Jerusalem',
  geneva: 'Europe/Zurich', 'abu dhabi': 'Asia/Dubai', 'ho chi minh': 'Asia/Ho_Chi_Minh', 'rio de janeiro': 'America/Sao_Paulo',
};
let timeZones = null;  // [[city, zone]] from the browser's time zone list

function zonesFor(place) {
  timeZones ??= (Intl.supportedValuesOf?.('timeZone') ?? []).map(z => [z.split('/').pop().replace(/_/g, ' ').toLowerCase(), z]);
  // A short name (nyc, sf) shows as the zone's city
  const alias = TIME_ALIASES[place];
  if (alias) return [[place.length > 3 ? place : alias.split('/').pop().replace(/_/g, ' ').toLowerCase(), alias]];
  const exact = timeZones.filter(([city]) => city === place);
  if (exact.length) return exact;
  return place.length >= 3 ? timeZones.filter(([city]) => city.startsWith(place)).slice(0, 2) : [];
}

// The offset of a time zone from UTC at a moment, in ms
function zoneOffset(zone, date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
    .formatToParts(date).map(x => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(date / 1000) * 1000;
}

// The moment it's h:m today in a time zone; the offset is taken again at the first guess, for a
// day the clocks change
function wallClock(zone, h, m) {
  const now = new Date();
  const there = new Date(now.getTime() + zoneOffset(zone, now));
  const utc = Date.UTC(there.getUTCFullYear(), there.getUTCMonth(), there.getUTCDate(), h, m);
  const guess = utc - zoneOffset(zone, new Date(utc));
  return new Date(utc - zoneOffset(zone, new Date(guess)));
}

// A time of day as typed: 3pm, 3:30 pm, 15:00, noon, midnight; a bare number isn't one
function parseClock(text) {
  if (text === 'noon') return [12, 0];
  if (text === 'midnight') return [0, 0];
  const m = text.match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/);
  if (!m || (!m[2] && !m[3])) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (min > 59 || h > 23 || (m[3] && (h < 1 || h > 12))) return null;
  if (m[3]) h = h % 12 + (m[3][0] === 'p' ? 12 : 0);
  return [h, min];
}

const LOCAL_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const zoneName = (city, zone) => (zone === 'UTC' ? 'UTC' : city.replace(/\b\p{L}/gu, c => c.toUpperCase()));
const zoneOffsetName = (zone, date) => new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(date).find(p => p.type === 'timeZoneName')?.value ?? '';
const timeIn = (zone, date) => date.toLocaleTimeString(undefined, { timeZone: zone, hour: 'numeric', minute: '2-digit' });
const dayIn = (zone, date) => date.toLocaleDateString(undefined, { timeZone: zone, weekday: 'long', day: 'numeric', month: 'long' });
const placeZone = (place) => (/^(local|here|my time)$/.test(place) ? ['your time', LOCAL_ZONE] : zonesFor(place)[0]);

// "time tokyo" or "tokyo time": the time there now. "3pm london in tokyo", or "3pm in tokyo" from
// your time, or "3pm london" to your time: that time today in another time zone.
function timeSuggestions(text) {
  const t = text.toLowerCase().trim();
  const clock = t.match(/^(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?|noon|midnight)(?:\s+(?!(?:in|to)\s)(.+?))?(?:\s+(?:in|to)\s+(.+))?$/);
  const hm = clock && parseClock(clock[1].trim());
  if (hm && (clock[2] || clock[3])) {
    const from = clock[2] ? placeZone(clock[2]) : ['your time', LOCAL_ZONE];
    const to = clock[3] ? placeZone(clock[3]) : ['your time', LOCAL_ZONE];
    if (!from || !to || from[1] === to[1]) return [];
    const at = wallClock(from[1], ...hm);
    const time = timeIn(to[1], at);
    const toName = to[0] === 'your time' ? 'your time' : zoneName(...to);
    const fromName = from[0] === 'your time' ? 'your time' : zoneName(...from);
    return [{ icon: suggestIcon('time', 16), title: `${time} ${toName === 'your time' ? 'your time' : `in ${toName}`}`,
      detail: `${timeIn(from[1], at)} ${fromName === 'your time' ? 'your time' : `in ${fromName}`} · ${dayIn(to[1], at)} · ${zoneOffsetName(to[1], at)}`,
      kind: 'Time', copy: time, fill: text }];
  }
  const m = t.match(/^(?:time\s+(?:in\s+)?(.+)|(.+?)\s+time)$/);
  if (!m) return [];
  const now = new Date();
  return zonesFor((m[1] ?? m[2]).trim()).map(([city, zone]) => {
    const time = timeIn(zone, now);
    return { icon: suggestIcon('time', 16), title: `${time} in ${zoneName(city, zone)}`, detail: `${dayIn(zone, now)} · ${zoneOffsetName(zone, now)}`, kind: 'Time', copy: time, fill: text };
  });
}

// Currencies, with ExchangeRate-API's free daily rates for about 160 currencies (Options → Search →
// Suggestions → Currency conversion and its permission), fetched at most every 6 hours and kept on
// this device. Codes (usd) or symbols ($).
const CURRENCY_RATES = 'https://open.er-api.com/v6/latest/EUR';
const CURRENCY_SYMBOLS = { '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₴': 'UAH', '₹': 'INR', '₩': 'KRW', '₺': 'TRY', '₪': 'ILS', '₽': 'RUB', '₱': 'PHP', '฿': 'THB', '₫': 'VND', '₦': 'NGN', '₸': 'KZT', '₾': 'GEL', 'zł': 'PLN', 'kč': 'CZK', 'r$': 'BRL', 'c$': 'CAD', 'a$': 'AUD', 'hk$': 'HKD' };
let ratesRequest = null;

function currencyRates() {
  ratesRequest ??= (async () => {
    const { exchangeRates: cached } = await chrome.storage.local.get('exchangeRates');
    if (cached && Date.now() - cached.fetchedAt < 6 * 36e5) return cached;
    if (!await chrome.permissions.contains({ origins: SUGGEST_SOURCES.find(s => s.id === 'currency').origins })) return cached ?? null;
    try {
      const data = await (await fetch(CURRENCY_RATES)).json();
      if (data.result !== 'success') return cached ?? null;
      const fresh = { updated: data.time_last_update_unix * 1000, rates: data.rates, fetchedAt: Date.now() };
      chrome.storage.local.set({ exchangeRates: fresh });
      return fresh;
    } catch {
      return cached ?? null;
    }
  })().finally(() => { ratesRequest = null; });
  return ratesRequest;
}

async function currencySuggestions(text) {
  const unit = '(zł|kč|r\\$|c\\$|a\\$|hk\\$|[$€£¥₴₹₩₺₪₽₱฿₫₦₸₾]|[a-z]{3})';
  const m = text.toLowerCase().trim().match(new RegExp(`^${unit}?\\s*(\\d[\\d,]*(?:\\.\\d+)?)?\\s*${unit}?\\s+(?:in|to|into|=)\\s+${unit}$`));
  if (!m || Boolean(m[1]) === Boolean(m[3])) return [];
  const code = (u) => CURRENCY_SYMBOLS[u] ?? u.toUpperCase();
  const [from, to] = [code(m[1] ?? m[3]), code(m[4])];
  const data = await currencyRates();
  if (!data || !data.rates[from] || !data.rates[to] || from === to) return [];
  const amount = Number((m[2] ?? '1').replace(/,/g, ''));
  const result = amount / data.rates[from] * data.rates[to];
  const money = (n, c) => n.toLocaleString(undefined, { style: 'currency', currency: c });
  return [{ icon: suggestIcon('currency', 16), title: money(result, to), detail: `${money(amount, from)} · rate of ${new Date(data.updated).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, by ExchangeRate-API`, kind: 'Currency', copy: result.toFixed(2), fill: text }];
}

// Chrome's own pages, by name: "settings", "downloads", "clear history"
const CHROME_PAGES = [
  { label: 'Settings', url: 'chrome://settings', words: ['settings', 'preferences', 'options'] },
  { label: 'History', url: 'chrome://history', words: ['history'] },
  { label: 'Downloads', url: 'chrome://downloads', words: ['downloads'] },
  { label: 'Extensions', url: 'chrome://extensions', words: ['extensions', 'add-ons', 'addons'] },
  { label: 'Bookmark manager', url: 'chrome://bookmarks', words: ['bookmarks', 'bookmark manager'] },
  { label: 'Password manager', url: 'chrome://password-manager', words: ['passwords', 'password manager'] },
  { label: 'Clear browsing data', url: 'chrome://settings/clearBrowserData', words: ['clear history', 'clear browsing data', 'clear cache', 'clear cookies', 'delete history'] },
  { label: 'Autofill and payments', url: 'chrome://settings/autofill', words: ['autofill', 'payment methods', 'addresses'] },
  { label: 'Privacy and security', url: 'chrome://settings/privacy', words: ['privacy', 'security'] },
  { label: 'Site settings', url: 'chrome://settings/content', words: ['site settings', 'permissions', 'cookies'] },
  { label: 'Search engines', url: 'chrome://settings/searchEngines', words: ['search engines', 'site search'] },
  { label: 'Default browser', url: 'chrome://settings/defaultBrowser', words: ['default browser'] },
  { label: 'About Chrome', url: 'chrome://settings/help', words: ['about chrome', 'update chrome', 'chrome version', 'version'] },
  { label: 'Flags', url: 'chrome://flags', words: ['flags', 'experiments'] },
  { label: 'Apps', url: 'chrome://apps', words: ['apps'] },
];

function chromeSuggestions(text) {
  const t = text.toLowerCase().trim().replace(/^chrome:\/\/|^chrome\s+/, '');
  if (t.length < 3) return [];
  return CHROME_PAGES.filter(p => p.words.some(w => w.startsWith(t)) || p.url.slice(9).startsWith(t)).slice(0, 3).map(p => ({
    icon: suggestIcon('chrome', 16), title: p.label, detail: p.url, kind: 'Chrome', chromeUrl: p.url, fill: p.url,
  }));
}

// Search a Google service: a name, then what to search for ("maps cafe", "yt lofi"). Services
// with accounts get one row per account; "translate hello to spanish" picks the language.
const SITE_SEARCHES = [
  { keys: ['maps', 'map'], host: 'maps.google.com', account: true, url: (q, n) => `https://www.google.com/maps/search/${q}?authuser=${n}` },
  { keys: ['youtube', 'yt'], label: 'YouTube', url: q => `https://www.youtube.com/results?search_query=${q}` },
  { keys: ['translate', 'tr'], label: 'Translate', translate: true },
  { keys: ['images', 'image', 'img'], label: 'Google Images', url: q => `https://www.google.com/search?tbm=isch&q=${q}` },
  { keys: ['news'], label: 'Google News', url: q => `https://www.google.com/search?tbm=nws&q=${q}` },
  { keys: ['photos'], host: 'photos.google.com', account: true, url: (q, n) => `https://photos.google.com/u/${n}/search/${q}` },
  { keys: ['drive'], host: 'drive.google.com', account: true, url: (q, n) => SEARCH_TARGETS.drive.url(q, n) },
  { keys: ['gmail', 'mail'], host: 'mail.google.com', account: true, url: (q, n) => SEARCH_TARGETS.gmail.url(q, n) },
  { keys: ['calendar', 'cal'], host: 'calendar.google.com', account: true, url: (q, n) => `https://calendar.google.com/calendar/u/${n}/r/search?q=${q}` },
  { keys: ['keep'], host: 'keep.google.com', account: true, url: (q, n) => `https://keep.google.com/u/${n}/#search/text%3D${q}` },
  { keys: ['contacts'], host: 'contacts.google.com', account: true, url: (q, n) => `https://contacts.google.com/u/${n}/search/${q}` },
  { keys: ['play'], label: 'Play', host: 'play.google.com', url: q => `https://play.google.com/store/search?q=${q}` },
];
const TRANSLATE_LANGUAGES = ['af', 'ar', 'bg', 'bn', 'ca', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fa', 'fi', 'fr', 'he', 'hi', 'hr', 'hu', 'id', 'it', 'ja', 'ka', 'ko', 'lt', 'lv', 'ms', 'nl', 'no', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sr', 'sv', 'th', 'tr', 'uk', 'ur', 'vi', 'zh-CN', 'zh-TW'];
let languageNames = null;  // name or code, lower case → code

function translateLanguage(word) {
  if (!languageNames) {
    const names = new Intl.DisplayNames(['en'], { type: 'language' });
    const local = new Intl.DisplayNames([navigator.language], { type: 'language' });
    languageNames = new Map(TRANSLATE_LANGUAGES.flatMap(code => [[code.toLowerCase(), code], [names.of(code).toLowerCase(), code], [local.of(code).toLowerCase(), code]]));
    languageNames.set('chinese', 'zh-CN');
  }
  return languageNames.get(word.toLowerCase());
}

function siteSearchSuggestions(text) {
  const [, key, query] = text.trim().match(/^(\S+)\s+(.+)$/) ?? [];
  const site = key && SITE_SEARCHES.find(s => s.keys.includes(key.toLowerCase()));
  if (!site) return [];
  const label = site.label ?? SERVICE_DEFS[site.host].label;
  const icon = site.host ? serviceIcon(site.host) : '<img src="icons/google.webp" alt="">';
  if (site.translate) {
    const m = query.match(/^(.+?)\s+(?:to|in|into)\s+(\S+(?:\s\S+)?)$/);
    const target = m && translateLanguage(m[2]);
    const words = target ? m[1] : query;
    const to = target ?? translateLanguage(navigator.language.split('-')[0]) ?? 'en';
    const url = `https://translate.google.com/?sl=auto&tl=${to}&text=${encodeURIComponent(words)}&op=translate`;
    return [{ icon, title: words, detail: `Translate to ${new Intl.DisplayNames([navigator.language], { type: 'language' }).of(to)}`, kind: 'Search', url, fill: text }];
  }
  const q = encodeURIComponent(query);
  if (!site.account) {
    return [{ icon, title: query, detail: `Search ${label}`, kind: 'Search', url: site.url(q), fill: text }];
  }
  const first = searchAccount[site.host === 'mail.google.com' ? 'gmail' : 'drive'];
  const list = shownAccounts().sort((a, b) => (b.index === first) - (a.index === first)).slice(0, 3);
  return list.map(a => ({ icon, title: query, detail: `Search ${label} · ${displayName(a)}`, kind: 'Search', url: site.url(q, a.index), service: site.host, fill: text }));
}

// Accounts a suggestion can be for: the ones whose name or email has the given word, or all
function accountsFor(word) {
  const list = shownAccounts();
  if (!word) return list;
  return list.filter(a => `${displayName(a)} ${a.email ?? ''} ${a.name ?? ''}`.toLowerCase().includes(word));
}

// Gmail search words, like from:anna or has:attachment, search Gmail in each account
const GMAIL_WORDS = /(^|\s)-?(from|to|cc|bcc|subject|label|has|is|in|filename|after|before|older_than|newer_than|larger|smaller|category|list|deliveredto|rfc822msgid):\S/i;

function gmailSuggestions(text) {
  if (!GMAIL_WORDS.test(text)) return [];
  const first = searchAccount.gmail;
  const list = shownAccounts().sort((a, b) => (b.index === first) - (a.index === first)).slice(0, 3);
  return list.map(a => ({
    icon: serviceIcon('mail.google.com'), title: text, detail: `Search Gmail · ${displayName(a)}`, kind: 'Gmail',
    url: SEARCH_TARGETS.gmail.url(encodeURIComponent(text), a.index), service: 'mail.google.com', fill: text,
  }));
}

// Open tabs whose title or address has every word typed; the dashboard's own tab isn't one
async function tabSuggestions(text) {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (text.length < 2) return [];
  const ownPages = `${location.origin}/`;
  const tabs = (await chrome.tabs.query({})).filter(t => t.url && !t.url.startsWith(ownPages)
    && words.every(w => `${t.title ?? ''} ${bareUrl(t.url)}`.toLowerCase().includes(w)));
  tabs.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  return tabs.slice(0, 3).map(t => ({
    icon: serviceIcon(serviceForUrl(t.url)) || tabIcon(t), title: t.title || bareUrl(t.url), detail: bareUrl(t.url), kind: 'Switch to tab',
    tabId: t.id, windowId: t.windowId, fill: bareUrl(t.url).replace(/\/$/, ''),
  }));
}

// Google services by the start of their name, "cal" for Calendar; a second word picks the account
function serviceSuggestions(text) {
  const [name, ...rest] = text.toLowerCase().split(/\s+/);
  if (name.length < 2) return [];
  const hosts = Object.keys(SERVICE_DEFS).filter(host => SERVICE_DEFS[host].label.toLowerCase().split(/\s+/).some(w => w.startsWith(name)));
  const list = accountsFor(rest.join(' '));
  return hosts.slice(0, 2).flatMap(host => list.map(a => ({
    icon: serviceIcon(host), title: SERVICE_DEFS[host].label, detail: displayName(a), kind: 'Service',
    url: accountServiceUrl(host, a.index), service: host, fill: text,
  }))).slice(0, 4);
}

// New files and more, in an account: "new doc", or just "sheet"; a word after it picks the account
const CREATE_ITEMS = [
  { words: ['document', 'doc', 'docs'], label: 'New document', host: 'docs.google.com', url: n => `https://docs.google.com/document/u/${n}/create` },
  { words: ['spreadsheet', 'sheet', 'sheets'], label: 'New spreadsheet', host: 'sheets.google.com', url: n => `https://docs.google.com/spreadsheets/u/${n}/create` },
  { words: ['presentation', 'slides', 'slide'], label: 'New presentation', host: 'slides.google.com', url: n => `https://docs.google.com/presentation/u/${n}/create` },
  { words: ['form', 'forms'], label: 'New form', host: 'forms.google.com', url: n => `https://docs.google.com/forms/u/${n}/create` },
  { words: ['meeting', 'meet', 'call'], label: 'New meeting', host: 'meet.google.com', url: n => `https://meet.google.com/new?authuser=${n}` },
  { words: ['event', 'calendar'], label: 'New event', host: 'calendar.google.com', url: n => `https://calendar.google.com/calendar/u/${n}/r/eventedit` },
  { words: ['email', 'mail', 'message', 'compose'], label: 'New email', host: 'mail.google.com', url: n => `https://mail.google.com/mail/u/${n}/#inbox?compose=new` },
];

function createSuggestions(text) {
  const named = /^(new|create)\s+/i.test(text);
  const [what = '', ...rest] = text.toLowerCase().replace(/^(new|create)\s+/, '').split(/\s+/);
  if (!what) return [];
  // After "new" the start of a word does; alone, it takes the whole word, so "cal" is still Calendar
  const items = CREATE_ITEMS.filter(item => item.words.some(w => (named ? w.startsWith(what) : w === what)));
  const list = accountsFor(rest.join(' '));
  return items.slice(0, 2).flatMap(item => list.map(a => ({
    icon: serviceIcon(item.host), title: item.label, detail: displayName(a), kind: 'Create',
    url: item.url(a.index), service: item.host, fill: text,
  }))).slice(0, 3);
}

// Google's suggestions, online, with Options → Search → Suggestions → Google suggestions and its
// permission: searches, which search Google, and sites. The previous request is cancelled.
const GOOGLE_SUGGEST = SUGGEST_SOURCES.find(s => s.id === 'google').origins;
let googleRequest = null;

async function googleSuggestions(text) {
  if (!await chrome.permissions.contains({ origins: GOOGLE_SUGGEST })) return [];
  googleRequest?.abort();
  googleRequest = new AbortController();
  try {
    const res = await fetch(`https://suggestqueries.google.com/complete/search?client=chrome&hl=${encodeURIComponent(navigator.language)}&q=${encodeURIComponent(text)}`, { signal: googleRequest.signal });
    const charset = res.headers.get('content-type')?.match(/charset=([\w-]+)/i)?.[1] ?? 'utf-8';
    const [, found = [], descriptions = [], , extra = {}] = JSON.parse(new TextDecoder(charset).decode(await res.arrayBuffer()));
    const types = extra['google:suggesttype'] ?? [];
    return found.map((s, i) => types[i] === 'NAVIGATION'
      ? { icon: bookmarkIcon(s), title: descriptions[i] || bareUrl(s), detail: bareUrl(s), kind: 'Google', url: s, fill: bareUrl(s).replace(/\/$/, '') }
      : { icon: suggestIcon('google', 16), title: s, detail: '', kind: 'Google', url: SEARCH_TARGETS.google.url(encodeURIComponent(s)), fill: s })
      .filter(s => s.fill.toLowerCase() !== text.toLowerCase())
      .slice(0, 4);
  } catch {
    return [];
  }
}

const SUGGESTERS = {
  calc: calcSuggestions, convert: convertSuggestions, time: timeSuggestions, currency: currencySuggestions,
  // A service by name ("drive work" opens Drive in that account), Gmail search words, a search in a service
  services: (text) => [...serviceSuggestions(text), ...gmailSuggestions(text), ...siteSearchSuggestions(text)],
  tabs: tabSuggestions, create: createSuggestions, chrome: chromeSuggestions, google: googleSuggestions,
};
const SITE_SOURCES = ['history', 'bookmarks', 'topSites'];

// Every suggestion for what's typed, in the order of Options → Search → Suggestions; a site found
// in several of history, bookmarks and most visited goes with the first of them there
async function lookupSuggestions(text) {
  const on = searchSuggest.filter(s => s.on).map(s => s.id);
  const [sites, ...others] = await Promise.all([
    lookupSites(text, new Set(on.filter(id => SITE_SOURCES.includes(id)))),
    ...on.filter(id => SUGGESTERS[id]).map(id => Promise.resolve(SUGGESTERS[id](text)).catch(() => [])),
  ]);
  const groups = Object.fromEntries(on.filter(id => SUGGESTERS[id]).map((id, i) => [id, others[i]]));
  const siteRank = (s) => Math.min(...[...s.sources].map(source => on.indexOf(source)).filter(i => i >= 0));
  const ranked = [
    ...Object.entries(groups).flatMap(([id, list]) => list.map(s => ({ ...s, rank: on.indexOf(id) }))),
    ...sites.map(s => ({ ...siteSuggestion(s), rank: siteRank(s) })),
  ];
  return ranked.sort((a, b) => a.rank - b.rank);
}

function renderSuggestions() {
  suggestEl.hidden = !suggestions.length;
  suggestEl.innerHTML = suggestions.map((s, i) => `
    <div class="suggestion" role="option" data-index="${i}" aria-selected="${i === suggestIndex}">
      ${s.icon}
      <span class="title">${esc(s.title)}</span>
      <span class="address">${esc(s.detail)}</span>
      <span class="kind">${esc(s.kind)}</span>
    </div>`).join('');
}

function closeSuggestions() {
  suggestions = [];
  suggestIndex = -1;
  completion = null;
  renderSuggestions();
}

// An open site, or a search, clears the field
function clearSearch() {
  qInput.value = '';
  typedText = '';
  closeSuggestions();
}

// An answer goes in the field, selected, and on the clipboard; a tab is switched to; the rest open
function runSuggestion(s, newTab) {
  if (s.copy !== undefined) {
    navigator.clipboard.writeText(s.copy).catch(() => {});
    closeSuggestions();
    qInput.value = typedText = s.copy;
    qInput.select();
  } else if (s.chromeUrl) {
    // window.open can't open Chrome's pages; Options → Dashboard → Open links still applies
    clearSearch();
    inPlaceTabId(newTab).then(tabId => (tabId ? chrome.tabs.update(tabId, { url: s.chromeUrl }) : chrome.tabs.create({ url: s.chromeUrl })));
    closePopup();
  } else if (s.tabId !== undefined) {
    chrome.tabs.update(s.tabId, { active: true });
    chrome.windows.update(s.windowId, { focused: true });
    clearSearch();
    closePopup();
  } else {
    openLink(s.url, s.service ?? serviceForUrl(s.url), newTab);
    clearSearch();
  }
}

qInput.addEventListener('input', async (e) => {
  typedText = qInput.value;
  completion = null;
  suggestIndex = -1;
  const text = typedText.trim();
  if (!searchSuggest.some(s => s.on) || !text) { closeSuggestions(); return; }
  const run = ++suggestRun;
  const found = await lookupSuggestions(text);
  if (run !== suggestRun || qInput.value !== typedText) return;
  suggestions = found.slice(0, SUGGEST_LIMIT);
  // Completed only while typing on at the end, not after deleting. Until a / is typed it completes
  // the site's address only, and its home page comes first, at the top of the list.
  let best = found.find(s => s.prefix);
  if (best && !typedText.includes('/')) {
    const home = `${new URL(best.url).origin}/`;
    best = found.find(s => s.url === home) ?? siteSuggestion({ url: home, title: new URL(home).hostname.replace(/^www\./, ''), prefix: true, sources: best.sources });
  }
  if (best) suggestions = [best, ...found.filter(s => s !== best)].slice(0, SUGGEST_LIMIT);
  if (best && e.inputType?.startsWith('insert') && qInput.selectionStart === qInput.value.length && !/\s/.test(typedText)) {
    const rest = bareUrl(best.url).slice(typedText.length).replace(/\/$/, '');
    if (rest) {
      completion = best;
      qInput.value = typedText + rest;
      qInput.setSelectionRange(typedText.length, qInput.value.length);
    }
  }
  renderSuggestions();
});

qInput.addEventListener('keydown', (e) => {
  if (e.isComposing) return;
  if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && suggestions.length) {
    e.preventDefault();
    const step = e.key === 'ArrowDown' ? 1 : -1;
    suggestIndex = (suggestIndex + 1 + step + suggestions.length + 1) % (suggestions.length + 1) - 1;
    completion = null;
    qInput.value = suggestIndex === -1 ? typedText : suggestions[suggestIndex].fill;
    renderSuggestions();
  } else if (e.key === 'Escape' && !suggestEl.hidden) {
    e.preventDefault();
    e.stopPropagation();
    qInput.value = typedText;
    closeSuggestions();
  } else if (e.key === 'Enter') {
    const picked = suggestIndex >= 0 ? suggestions[suggestIndex] : completion && qInput.selectionStart !== qInput.selectionEnd ? completion : null;
    if (!picked) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    runSuggestion(picked, e.ctrlKey || e.metaKey);
  }
});

// A click keeps the focus in the field; leaving the field closes the list and drops the completion,
// so a search button searches for what's typed
suggestEl.addEventListener('mousedown', e => e.preventDefault());
suggestEl.addEventListener('click', (e) => {
  const row = e.target.closest('.suggestion');
  if (row) runSuggestion(suggestions[row.dataset.index], e.ctrlKey || e.metaKey);
});
qInput.addEventListener('blur', () => {
  if (completion) qInput.value = typedText;
  closeSuggestions();
});

// Text that reads as a web address: with http(s)://, or one word with a dot and a top-level domain,
// or localhost, optionally with a port and path. Without a scheme it's https, but http for localhost.
function typedAddress(text) {
  if (/\s/.test(text)) return null;
  if (!/^https?:\/\//i.test(text) && !/^(localhost|[\w-]+(\.[\w-]+)*\.[a-z]{2,})(:\d+)?([/?#]\S*)?$/i.test(text)) return null;
  try {
    return new URL(/^https?:\/\//i.test(text) ? text : `${/^localhost\b/i.test(text) ? 'http' : 'https'}://${text}`).href;
  } catch {
    return null;
  }
}

// Enter on an address, like example.com, opens the site instead of searching for it; a search
// button still searches for it. Runs after the suggestions, which handle Enter on one picked.
qInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.isComposing) return;
  const url = typedAddress(qInput.value.trim());
  if (!url) return;
  e.preventDefault();
  openLink(url, serviceForUrl(url), e.ctrlKey || e.metaKey);
  clearSearch();
});

function runSearch(id) {
  const q = qInput.value.trim();
  const target = SEARCH_TARGETS[id];
  if (!q || !target) return;
  const url = target.url(encodeURIComponent(q), searchAccount[id] ?? 0);
  openLink(url, target.service);
  clearSearch();
}

// Enter with no search buttons searches Google; with the one control (no submit button), the search it shows
document.getElementById('search').addEventListener('submit', (e) => {
  e.preventDefault();
  runSearch(e.submitter?.value ?? (searchButtonsEl.querySelector('.split.single') ? searchTarget : 'google'));
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
  // The one search button's choice, made in the popup or another dashboard
  if (area === 'local' && changes.searchChoice && searchRemember) {
    applySearchChoice(changes.searchChoice.newValue);
    renderSearch();
  }
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
  if (changes.searchTypeToFocus) searchTypeToFocus = changes.searchTypeToFocus.newValue;
  if (changes.searchSuggest) searchSuggest = suggestSources(changes.searchSuggest.newValue);
  if (changes.searchLayout || changes.searchLabels || changes.searchRemember) {
    searchLayout = changes.searchLayout?.newValue ?? searchLayout;
    searchLabels = changes.searchLabels?.newValue ?? searchLabels;
    searchRemember = changes.searchRemember?.newValue ?? searchRemember;
    renderSearch();
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
