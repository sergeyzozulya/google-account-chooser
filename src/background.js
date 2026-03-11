importScripts('services-data.js');
/* global SERVICE_DEFS */

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

function loadSettings() {
  chrome.storage.sync.get(
    { enabled: true, popupPlacement: 'center', popupSize: 'default', customSizes: {}, customPositions: {}, services: {} },
    (data) => {
      extensionEnabled = data.enabled;
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
chrome.storage.onChanged.addListener(loadSettings);

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

  // Coming back from AccountChooser → let it through once
  if (tabsFromAccountChooser.has(tabId)) {
    tabsFromAccountChooser.delete(tabId);
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
  tabLastUrl.delete(tabId);
});

chrome.windows.onRemoved.addListener((windowId) => {
  popupWindows.delete(windowId);
});
