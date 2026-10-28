importScripts('services-data.js');
/* global SERVICE_DEFS, GMAIL_DEFAULTS, accountFromUrl, accountKey */

// Build the intercept lookup from the shared service definitions
const DEFAULT_SERVICES = Object.fromEntries(
  Object.entries(SERVICE_DEFS).map(([host, def]) => [
    host, { label: def.label, intercept: true, popup: false, skipIfUserSet: false },
  ])
);

let extensionEnabled = true;
let services = { ...DEFAULT_SERVICES };
let popupPlacement = 'center';
let popupSize = 'default';
let customSizes = {};      // host → { width, height }
let customPositions = {};  // host → { left, top }
let tileIndex = 0;

// Tabs/windows that just committed a navigation through accounts.google.com.
// The next Google-service navigation in that tab is the AccountChooser
// redirect-back — let it through without intercepting again.
const tabsFromAccountChooser = new Set();

// Last committed URL per tab, used to restore the tab when popup mode fires.
const tabLastUrl = new Map();

// Popup windows we opened in custom mode: windowId → hostname
const popupWindows = new Map();

// Tabs the dashboard opened on a URL that already names the account: tabId → expiry time.
// Until then, navigations in the tab (including the service's own redirects) skip interception.
const TRUSTED_TAB_MS = 15000;
const trustedTabs = new Map();

// URLs the dashboard is about to open in a new tab itself: url → expiry time. It uses window.open
// so Chrome can open the link in an installed web app (chrome.tabs.create bypasses that), which
// leaves no tab id to trust up front; the tab or app window the URL first lands in becomes trusted.
const trustedUrls = new Map();

// With tabId, navigate that tab (the dashboard opening a link in place)
function openWithAccount(url, tabId) {
  if (tabId) {
    trustedTabs.set(tabId, Date.now() + TRUSTED_TAB_MS);
    chrome.tabs.update(tabId, { url });
  } else {
    trustedUrls.set(new URL(url).href, Date.now() + TRUSTED_TAB_MS);
  }
}

// Toolbar icon (Options → General): the popup, or the same page in Chrome's side panel.
// The side panel only opens on click when the action has no popup.
function applyActionOpens(mode) {
  const sidePanel = mode === 'sidepanel';
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: sidePanel });
  chrome.action.setPopup({ popup: sidePanel ? '' : 'popup.html' });
}

function loadSettings() {
  chrome.storage.sync.get(
    { enabled: true, popupPlacement: 'center', popupSize: 'default', customSizes: {}, customPositions: {}, services: {}, actionOpens: 'popup' },
    (data) => {
      extensionEnabled = data.enabled;
      applyActionOpens(data.actionOpens);
      popupPlacement = data.popupPlacement;
      popupSize = data.popupSize;
      customSizes = data.customSizes || {};
      customPositions = data.customPositions || {};
      services = { ...DEFAULT_SERVICES };
      for (const [host, saved] of Object.entries(data.services)) {
        if (services[host]) services[host] = { ...services[host], ...saved };
      }
    }
  );
}

// ── Custom size/position persistence ───────────────────────────────────────

let _saveCustomDataTimer = null;
function scheduleSaveCustomData() {
  clearTimeout(_saveCustomDataTimer);
  _saveCustomDataTimer = setTimeout(() => {
    chrome.storage.sync.set({ customSizes, customPositions });
  }, 800);
}

chrome.windows.onBoundsChanged.addListener((win) => {
  if (!popupWindows.has(win.id)) return;
  const hostname = popupWindows.get(win.id);
  if (popupSize === 'custom') {
    customSizes[hostname] = { width: win.width, height: win.height };
  }
  if (popupPlacement === 'custom') {
    customPositions[hostname] = { left: win.left, top: win.top };
  }
  scheduleSaveCustomData();
});

// ── Popup helper ───────────────────────────────────────────────────────────

function createPopup(url, callback) {
  const hostname = new URL(url).hostname;

  // When the URL is an AccountChooser redirect, use the target service hostname
  // for per-service lookups (custom size/position, Chrome App matching).
  let serviceHostname = hostname;
  if (hostname === 'accounts.google.com') {
    try {
      const continueUrl = new URL(url).searchParams.get('continue');
      if (continueUrl) serviceHostname = new URL(continueUrl).hostname;
    } catch { /* keep hostname */ }
  }

  chrome.windows.getLastFocused({ populate: false }, (parent) => {
    const pw = (parent && !chrome.runtime.lastError) ? parent : { width: 1280, height: 800, left: 0, top: 0 };

    let width, height;
    if (popupSize === 'large') {
      width = Math.floor(pw.width * 0.75);
      height = Math.floor(pw.height * 0.75);
    } else if (popupSize === 'custom') {
      const saved = customSizes[serviceHostname];
      width = saved ? saved.width : 1024;
      height = saved ? saved.height : 768;
    } else if (popupSize === 'full') {
      width = pw.width;
      height = pw.height;
    } else {
      width = 1024;
      height = 768;
    }

    let left, top;
    if (popupPlacement === 'custom') {
      const saved = customPositions[serviceHostname];
      left = saved ? saved.left : pw.left + Math.floor((pw.width - width) / 2);
      top  = saved ? saved.top  : pw.top  + Math.floor((pw.height - height) / 2);
    } else if (popupPlacement === 'tiles') {
      const step = 30;
      const maxOffset = Math.max(0, Math.min(pw.width, pw.height) - 200);
      const offset = maxOffset > 0 ? (tileIndex * step) % maxOffset : 0;
      left = pw.left + offset;
      top = pw.top + offset;
      tileIndex++;
    } else { // center
      left = pw.left + Math.floor((pw.width - width) / 2);
      top = pw.top + Math.floor((pw.height - height) / 2);
    }

    function trackAndCallback(win) {
      if (win && (popupSize === 'custom' || popupPlacement === 'custom')) popupWindows.set(win.id, serviceHostname);
      if (callback) callback(win);
    }

    chrome.windows.create({ url, type: 'popup', width, height, left, top, focused: true }, trackAndCallback);
  });
}

loadSettings();
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'sync') loadSettings();
});

// ── Dashboard in new tabs (Options → General) ──────────────────────────────

// A manifest new-tab override can't be switched off at runtime, so swap Chrome's New Tab for
// the dashboard as it opens. The setting is read here because a waking worker may not have loaded it yet.
chrome.tabs.onCreated.addListener(async (tab) => {
  if ((tab.pendingUrl || tab.url) !== 'chrome://newtab/') return;
  const { dashboardNewTab } = await chrome.storage.sync.get({ dashboardNewTab: false });
  if (dashboardNewTab) chrome.tabs.update(tab.id, { url: chrome.runtime.getURL('dashboard.html?newtab') });
});

// ── Unread badge on the toolbar icon ───────────────────────────────────────

const UNREAD_ALARM = 'unread';
const MAX_ACCOUNTS = 10;

// Gmail's Atom feed for account slot n: { status, text } (text only when it loaded), or null.
// A slot whose session has lapsed answers 401 with a Basic-auth challenge: fetched from a page,
// Chrome asks for a username and password; from this worker, which has no page to ask on, the
// request just fails. So the dashboard reads feeds through here too.
// A feed still loading is shared with whoever asks for it meanwhile (the popup's frames ask at once).
const pendingFeeds = new Map(); // n → the fetch's promise

function fetchFeed(n) {
  if (pendingFeeds.has(n)) return pendingFeeds.get(n);
  const result = (async () => {
    try {
      const res = await fetch(`https://mail.google.com/mail/u/${n}/feed/atom`, { credentials: 'include', cache: 'no-store' });
      return { status: res.status, text: res.ok ? await res.text() : null };
    } catch {
      return null;
    } finally {
      pendingFeeds.delete(n);
    }
  })();
  pendingFeeds.set(n, result);
  return result;
}

// Unread count and the account's email for account slot n, or null
async function fetchInbox(n) {
  const text = (await fetchFeed(n))?.text;
  const count = text?.match(/<fullcount>(\d+)<\/fullcount>/);
  if (!count) return null;
  return { count: Number(count[1]), email: text.match(/<title>[^<]*?(\S+@[^\s<]+)/)?.[1] ?? null };
}

// Total across accounts, or one account's count (Options → Gmail → Toolbar icon count)
async function showUnread(unread) {
  const { toolbarBadge } = await chrome.storage.sync.get({ toolbarBadge: GMAIL_DEFAULTS.toolbarBadge });
  let counts = Object.entries(unread);
  if (toolbarBadge === 'off') counts = [];
  else if (toolbarBadge !== 'all') {
    const { accountsCache } = await chrome.storage.local.get('accountsCache');
    const account = accountsCache?.accounts?.find(a => accountKey(a) === toolbarBadge);
    counts = counts.filter(([index]) => Number(index) === account?.index);
  }
  const total = counts.reduce((sum, [, n]) => sum + n, 0);
  chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
  chrome.action.setBadgeTextColor?.({ color: '#ffffff' });
  chrome.action.setBadgeText({ text: total > 999 ? '999+' : total > 0 ? String(total) : '' });
}

// Total unread across the accounts the dashboard detected, or, before it has run,
// across Gmail slots /u/0/, /u/1/, … until one has no feed or repeats an account. Accounts
// switched off in Options aren't counted.
async function refreshUnread() {
  const { accountsCache } = await chrome.storage.local.get('accountsCache');
  const { hiddenAccounts } = await chrome.storage.sync.get({ hiddenAccounts: [] });
  const unread = {};
  if (accountsCache?.accounts?.length) {
    await Promise.all(accountsCache.accounts.filter(a => !hiddenAccounts.includes(accountKey(a))).map(async (a) => {
      const inbox = await fetchInbox(a.index);
      if (inbox) unread[a.index] = inbox.count;
    }));
  } else {
    const seen = new Set();
    for (let n = 0; n < MAX_ACCOUNTS; n++) {
      const inbox = await fetchInbox(n);
      if (!inbox?.email || seen.has(inbox.email)) break;
      seen.add(inbox.email);
      if (!hiddenAccounts.includes(accountKey({ index: n, email: inbox.email }))) unread[n] = inbox.count;
    }
  }
  showUnread(unread);
}

// Every Options → Gmail → Check mail every. create() restarts the timer, so only create the alarm
// when it's missing or its period changed.
async function scheduleUnread() {
  const { mailCheckMinutes } = await chrome.storage.sync.get({ mailCheckMinutes: GMAIL_DEFAULTS.mailCheckMinutes });
  const alarm = await chrome.alarms.get(UNREAD_ALARM);
  if (alarm?.periodInMinutes === mailCheckMinutes) return;
  chrome.alarms.create(UNREAD_ALARM, { delayInMinutes: alarm ? mailCheckMinutes : 0, periodInMinutes: mailCheckMinutes });
}
scheduleUnread();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (changes.mailCheckMinutes) scheduleUnread();
  if (changes.toolbarBadge || changes.hiddenAccounts) refreshUnread();
});
// While a dashboard or popup is open it checks mail itself and sends the counts (below), so the
// alarm skips a check that one did within the period (less a few seconds, as timers drift)
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== UNREAD_ALARM) return;
  const { unreadSentAt = 0 } = await chrome.storage.session.get('unreadSentAt');
  if (Date.now() - unreadSentAt < alarm.periodInMinutes * 60000 - 10000) return;
  refreshUnread();
});
chrome.runtime.onStartup.addListener(refreshUnread);

// ── What's new ─────────────────────────────────────────────────────────────

// Once after each update to a new version. Reloading an unpacked extension also reports
// 'update', but with the same version, so that's skipped.
chrome.runtime.onInstalled.addListener(({ reason, previousVersion }) => {
  if (reason === 'update' && previousVersion !== chrome.runtime.getManifest().version) {
    chrome.tabs.create({ url: 'whats-new.html' });
  }
});

// ── Activity stats (shown on the dashboard) ────────────────────────────────

function recordLaunch(host, account) {
  chrome.storage.local.get({ stats: { services: {}, accounts: {} } }, ({ stats }) => {
    stats.services[host] = (stats.services[host] || 0) + 1;
    if (account !== null) stats.accounts[account] = (stats.accounts[account] || 0) + 1;
    chrome.storage.local.set({ stats });
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'feed') {
    fetchFeed(msg.n).then(sendResponse);
    return true;
  }
  // The dashboard sends fresh unread counts after each refresh
  if (msg.type === 'unread') {
    showUnread(msg.unread);
    chrome.storage.session.set({ unreadSentAt: Date.now() });
  }
  if (msg.type === 'open') {
    openWithAccount(msg.url, msg.tabId);
    recordLaunch(msg.service, accountFromUrl(msg.url));
  }
  sendResponse();
});

// ── Navigation tracking ────────────────────────────────────────────────────

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  const { tabId, url } = details;

  let hostname;
  try { hostname = new URL(url).hostname; } catch { return; }

  if (hostname === 'accounts.google.com') {
    tabsFromAccountChooser.add(tabId);
  } else {
    tabLastUrl.set(tabId, url);
    if (!(hostname in services)) {
      tabsFromAccountChooser.delete(tabId);
    }
  }
});

// ── Intercept ──────────────────────────────────────────────────────────────

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return;
  if (!extensionEnabled) return;

  const { tabId, url } = details;

  let hostname;
  try { hostname = new URL(url).hostname; } catch { return; }

  const service = services[hostname];
  if (!service || !service.intercept) return;

  // Opened from the dashboard with a known account → let it through
  if (trustedUrls.get(url) > Date.now()) trustedTabs.set(tabId, Date.now() + TRUSTED_TAB_MS);
  trustedUrls.delete(url);
  if (trustedTabs.has(tabId)) {
    if (trustedTabs.get(tabId) > Date.now()) return;
    trustedTabs.delete(tabId);
  }

  // Coming back from AccountChooser → let it through once
  if (tabsFromAccountChooser.has(tabId)) {
    tabsFromAccountChooser.delete(tabId);
    recordLaunch(hostname, accountFromUrl(url));
    return;
  }

  // If URL already specifies a user account, skip chooser but still open popup
  if (service.skipIfUserSet) {
    const parsed = new URL(url);
    const hasAuthuser = parsed.searchParams.has('authuser');
    const hasUserPath = /\/u\/\d+\//.test(parsed.pathname);
    if (hasAuthuser || hasUserPath) {
      if (service.popup) {
        createPopup(url, (win) => {
          if (win && win.tabs && win.tabs[0]) tabsFromAccountChooser.add(win.tabs[0].id);
        });
        const prevUrl = tabLastUrl.get(tabId);
        const restorable = prevUrl && !prevUrl.startsWith('chrome://') && !prevUrl.startsWith('about:') && prevUrl !== url;
        if (restorable) {
          chrome.tabs.update(tabId, { url: prevUrl });
        } else {
          chrome.tabs.remove(tabId);
        }
      }
      return;
    }
  }

  const chooserUrl =
    'https://accounts.google.com/AccountChooser?continue=' +
    encodeURIComponent(url);

  if (service.popup) {
    createPopup(chooserUrl, null);

    const prevUrl = tabLastUrl.get(tabId);
    const restorable =
      prevUrl &&
      !prevUrl.startsWith('chrome://') &&
      !prevUrl.startsWith('about:') &&
      prevUrl !== url;

    if (restorable) {
      chrome.tabs.update(tabId, { url: prevUrl });
    } else {
      chrome.tabs.remove(tabId);
    }
  } else {
    chrome.tabs.update(tabId, { url: chooserUrl });
  }
});

// ── Cleanup ────────────────────────────────────────────────────────────────

chrome.tabs.onRemoved.addListener((tabId) => {
  tabsFromAccountChooser.delete(tabId);
  trustedTabs.delete(tabId);
  tabLastUrl.delete(tabId);
});

chrome.windows.onRemoved.addListener((windowId) => {
  popupWindows.delete(windowId);
});
