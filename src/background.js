importScripts('services-data.js');
/* global SERVICE_DEFS, accountFromUrl */

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

// Open the tab blank first so it's marked trusted before its first real navigation starts.
// With tabId, navigate that tab instead (the new-tab dashboard opening a bookmark in place).
async function openWithAccount(url, tabId) {
  const id = tabId ?? (await chrome.tabs.create({ url: 'about:blank' })).id;
  trustedTabs.set(id, Date.now() + TRUSTED_TAB_MS);
  chrome.tabs.update(id, { url });
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
const UNREAD_PERIOD_MIN = 2;
const MAX_ACCOUNTS = 10;

// Gmail's Atom feed for account slot n: unread count and the account's email, or null
async function fetchInbox(n) {
  try {
    const res = await fetch(`https://mail.google.com/mail/u/${n}/feed/atom`, { credentials: 'include' });
    const text = await res.text();
    const count = text.match(/<fullcount>(\d+)<\/fullcount>/);
    if (!count) return null;
    return { count: Number(count[1]), email: text.match(/<title>[^<]*?(\S+@[^\s<]+)/)?.[1] ?? null };
  } catch {
    return null;
  }
}

function showUnread(unread) {
  const total = Object.values(unread).reduce((sum, n) => sum + n, 0);
  chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
  chrome.action.setBadgeTextColor?.({ color: '#ffffff' });
  chrome.action.setBadgeText({ text: total > 999 ? '999+' : total > 0 ? String(total) : '' });
}

// Total unread across the accounts the dashboard detected, or, before it has run,
// across Gmail slots /u/0/, /u/1/, … until one has no feed or repeats an account
async function refreshUnread() {
  const { accountsCache } = await chrome.storage.local.get('accountsCache');
  const unread = {};
  if (accountsCache?.accounts?.length) {
    await Promise.all(accountsCache.accounts.map(async (a) => {
      const inbox = await fetchInbox(a.index);
      if (inbox) unread[a.index] = inbox.count;
    }));
  } else {
    const seen = new Set();
    for (let n = 0; n < MAX_ACCOUNTS; n++) {
      const inbox = await fetchInbox(n);
      if (!inbox?.email || seen.has(inbox.email)) break;
      seen.add(inbox.email);
      unread[n] = inbox.count;
    }
  }
  showUnread(unread);
}

// create() restarts the timer, so only create the alarm when it's missing
chrome.alarms.get(UNREAD_ALARM, (alarm) => {
  if (!alarm) chrome.alarms.create(UNREAD_ALARM, { delayInMinutes: 0, periodInMinutes: UNREAD_PERIOD_MIN });
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UNREAD_ALARM) refreshUnread();
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
  // The dashboard sends fresh unread counts after each refresh
  if (msg.type === 'unread') showUnread(msg.unread);
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
