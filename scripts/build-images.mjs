#!/usr/bin/env node
// Regenerates every image from media/icon.svg and the extension pages:
//   src/icons/icon{16,32,48}.png, src/icons/icon.png, media/icon.png
//   media/popup.png (popup views), media/options.png (Settings in columns), media/dashboard.png
//   media/screen1.png … screen3.png                    (store screenshots, 1280×800; also src/screens/ for What's new)
//   media/marque.png, media/small.png                (store promo tiles)
//
// Usage: node scripts/build-images.mjs
// Needs Google Chrome (override the path with CHROME=...) and network access for the promo fonts.

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp',
};

// ── Local server: repo files, extension pages with a chrome.* stub, in-memory captures ──

const captures = new Map(); // '/_capture/name.png' → PNG buffer

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  // Chrome's favicon cache for extension pages; screenshots get a neutral globe
  if (pathname.startsWith('/_favicon/')) {
    res.writeHead(200, { 'content-type': 'image/svg+xml' });
    res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#80868b" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>');
    return;
  }
  if (captures.has(pathname)) {
    res.writeHead(200, { 'content-type': TYPES[path.extname(pathname)] || 'image/png' });
    res.end(captures.get(pathname));
    return;
  }
  try {
    let body = await readFile(path.join(ROOT, decodeURIComponent(pathname)));
    if (pathname.startsWith('/src/') && pathname.endsWith('.html')) {
      body = body.toString().replace('<script', '<script src="/scripts/images/stub.js"></script><script');
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(pathname)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${server.address().port}`;

// ── Headless Chrome over the DevTools protocol ─────────────────────────────

const profile = await mkdtemp(path.join(tmpdir(), 'gac-images-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--hide-scrollbars', '--force-color-profile=srgb', '--no-first-run', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });

const wsUrl = await new Promise((resolve, reject) => {
  let log = '';
  chrome.stderr.on('data', (chunk) => {
    log += chunk;
    const m = log.match(/DevTools listening on (ws:\/\/\S+)/);
    if (m) resolve(m[1]);
  });
  chrome.on('error', reject);
  chrome.on('exit', () => reject(new Error(`Chrome exited before DevTools was ready:\n${log}`)));
});

const ws = new WebSocket(wsUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let nextId = 0;
const pending = new Map();
const listeners = [];
ws.addEventListener('message', ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.id) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result);
  } else {
    for (const l of listeners.filter(l => l.method === msg.method)) {
      listeners.splice(listeners.indexOf(l), 1);
      l.resolve(msg.params);
    }
  }
});

function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
}

const once = (method) => new Promise(resolve => listeners.push({ method, resolve }));

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const page = (method, params) => send(method, params, sessionId);
await page('Page.enable');
await page('Emulation.setFocusEmulationEnabled', { enabled: true });

async function evaluate(expression) {
  const { result, exceptionDetails } = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
  return result.value;
}

// Load a page and screenshot it. `region` is a JS expression evaluated in the page that
// returns { x, y, width, height } in CSS pixels; by default the viewport, or the whole
// document height with `fullHeight`. `settle` waits longer for pages that render asynchronously;
// `prepare` is a JS expression run before the screenshot (e.g. a click), followed by another wait.
async function capture(url, { width, height, scale = 1, transparent = false, fullHeight = false, region, settle = 300, prepare }) {
  await page('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
  await page('Emulation.setDefaultBackgroundColorOverride', transparent ? { color: { r: 0, g: 0, b: 0, a: 0 } } : {});
  const loaded = once('Page.loadEventFired');
  await page('Page.navigate', { url: BASE + url });
  await loaded;
  await evaluate(`document.fonts.ready.then(() => new Promise(r => setTimeout(r, ${settle})))`);
  if (prepare) await evaluate(`(${prepare}, new Promise(r => setTimeout(r, 1500)))`);

  const clip = region
    ? await evaluate(region)
    : { x: 0, y: 0, width, height: fullHeight ? await evaluate('document.documentElement.scrollHeight') : height };
  const { data } = await page('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: true, clip: { ...clip, scale: 1 },
  });
  return Buffer.from(data, 'base64');
}

// Settings page as `count` columns: split between its cards (never through one), keeping
// reading order. Among splits whose tallest column is within 10% of the shortest possible,
// take the most even one, so no column is left nearly empty. Cards taller than TEAR_OVER
// (the services table) show their top and bottom with a torn-paper gap in between.
// Returns columns as lists of { png, torn } segments; `torn` means a tear follows it.
// Options' tabs (General, Interface, Services) all showing, one after another, without the tab bar
const ALL_OPTION_TABS = `(document.querySelectorAll('.tab-panel').forEach(p => { p.hidden = false; }),
  document.querySelector('.tabs').hidden = true)`;

async function optionsColumns(count) {
  const width = 802, pad = 24, TEAR_OVER = 900, TEAR_HEAD = 560, TEAR_TAIL = 190, TEAR_GAP = 28;
  await capture('/src/options.html', { width, height: 900, prepare: ALL_OPTION_TABS });
  // Each block (the header, the subtitle and every card) with its table-row edges, so tears fall between rows
  const blocks = (await evaluate(`[...document.querySelectorAll('.page > :not(.tab-panel), .tab-panel > *')]
    .filter(el => el.offsetHeight && getComputedStyle(el).position !== 'fixed')
    .map(el => {
      const edges = (e) => { const r = e.getBoundingClientRect(); return [r.top + scrollY, r.bottom + scrollY]; };
      return [...edges(el), [...el.querySelectorAll('tbody tr')].map(edges)];
    })`))
    // Only tables can be torn (between rows); other tall cards show whole
    .map(([top, bottom, rows]) => ({ top, bottom, rows, torn: bottom - top > TEAR_OVER && rows.length > 0 }));
  const shown = (b) => (b.torn ? TEAR_HEAD + TEAR_TAIL + TEAR_GAP : b.bottom - b.top);

  // Brute-force the split points; the page has only a handful of blocks
  const splits = (from, left) => left === 1 ? [[]] : Array.from({ length: blocks.length - from - left + 1 }, (_, i) => from + i + 1)
    .flatMap(cut => splits(cut, left - 1).map(rest => [cut, ...rest]));
  const options = splits(0, count).map(cuts => {
    const groups = [0, ...cuts].map((start, i) => blocks.slice(start, cuts[i] ?? blocks.length));
    // Block heights plus the gaps between consecutive blocks
    const heights = groups.map(g => g.reduce((sum, b, k) => sum + shown(b) + (k ? b.top - g[k - 1].bottom : 0), 0));
    return { groups, tallest: Math.max(...heights), spread: Math.max(...heights) - Math.min(...heights) };
  });
  const shortest = Math.min(...options.map(o => o.tallest));
  const best = options.filter(o => o.tallest <= shortest * 1.1).sort((a, b) => a.spread - b.spread)[0];

  const shot = (top, bottom) => capture('/src/options.html', {
    width, height: 900, scale: 2, prepare: ALL_OPTION_TABS, region: `({ x: 0, y: ${top}, width: ${width}, height: ${bottom - top} })`,
  });
  const columns = [];
  for (const group of best.groups) {
    const segments = [];
    let start = Math.max(0, group[0].top - pad);
    for (const b of group) {
      if (!b.torn) continue;
      // Keep whole rows: end the top part after the last row that fits, resume at a row start
      const head = Math.max(...b.rows.map(([, bottom]) => bottom).filter(y => y <= b.top + TEAR_HEAD));
      const tail = Math.min(...b.rows.map(([top]) => top).filter(y => y >= b.bottom - TEAR_TAIL));
      segments.push({ png: await shot(start, head), torn: true });
      start = tail;
    }
    segments.push({ png: await shot(start, group.at(-1).bottom + pad), torn: false });
    columns.push(segments);
  }
  return columns;
}

async function output(file, png) {
  await writeFile(path.join(ROOT, file), png);
  console.log(`  ${file}`);
}

try {
  console.log('Icons');
  for (const [size, files] of [[16, ['src/icons/icon16.png']], [32, ['src/icons/icon32.png']], [48, ['src/icons/icon48.png']],
                               [128, ['src/icons/icon.png', 'media/icon.png']]]) {
    const png = await capture('/scripts/images/icon.html', { width: size, height: size, transparent: true });
    for (const file of files) await output(file, png);
  }

  console.log('UI screenshots');
  const popup = await capture('/src/popup.html', { width: 300, height: 600, scale: 2, fullHeight: true });
  const options = await capture('/src/options.html', { width: 802, height: 900, scale: 2, fullHeight: true });
  // The Services tab, opened by its button: a #services link right after options.html is a same-page
  // navigation, which fires no load event
  const services = await capture('/src/options.html', {
    width: 802, height: 900, scale: 2, prepare: `document.querySelector('[data-tab="services"]').click()`,
    region: `(() => { const r = document.querySelector('.services-card').getBoundingClientRect();
                      return { x: r.left, y: r.top + scrollY, width: r.width, height: Math.min(r.height, 480) }; })()`,
  });
  // Dashboard with the stub's fictional accounts, tabs and files (see scripts/images/stub.js)
  const dashboard = await capture('/src/dashboard.html', { width: 1280, height: 640, scale: 2, settle: 1500 });
  captures.set('/_capture/dashboard.png', dashboard);
  // Whole dashboard page; a short viewport so the page height is its content, not the window
  await output('media/dashboard.png', await capture('/src/dashboard.html', { width: 1280, height: 400, fullHeight: true, settle: 1500 }));
  captures.set('/_capture/popup.png', popup);
  captures.set('/_capture/options.png', options);
  captures.set('/_capture/services.png', services);
  // Popup views for media/popup.png, cropped at Chrome's 600px popup height
  const popupView = (view, width, prepare) => capture(`/src/popup.html?view=${view}`, {
    width, height: 600, scale: 2, settle: 1500, prepare,
    region: `({ x: 0, y: 0, width: ${width}, height: Math.min(Math.ceil(document.body.getBoundingClientRect().height), 600) })`,
  });
  captures.set('/_capture/popup-accounts.png', await popupView('accounts', 380));
  captures.set('/_capture/popup-account-launcher.png', await popupView('launcher', 380,
    `document.querySelector('.dashboard-frame').contentDocument.querySelectorAll('[data-launcher]')[1].click()`));
  captures.set('/_capture/popup-sections.png', await popupView('sections', 380));
  await output('media/popup.png', await capture('/scripts/images/popup-views.html', { width: 1660, height: 750, settle: 800 }));
  const columns = await optionsColumns(3);
  const layout = columns.map((segments, c) => segments.map((seg, k) => {
    const src = `/_capture/options-${c}-${k}.png`;
    captures.set(src, seg.png);
    return { src, torn: seg.torn };
  }));
  captures.set('/_capture/options-columns.json', Buffer.from(JSON.stringify(layout)));
  await output('media/options.png', await capture('/scripts/images/options-columns.html', { width: 2550, height: 100, fullHeight: true, settle: 1000 }));

  console.log('Store images');
  for (const [name, width, height] of [['screen1', 1280, 800], ['screen2', 1280, 800], ['screen3', 1280, 800], ['marque', 1400, 560], ['small', 440, 280]]) {
    const png = await capture(`/scripts/images/${name}.html`, { width, height });
    await output(`media/${name}.png`, png);
    if (name.startsWith('screen')) await output(`src/screens/${name}.png`, png);
  }
} finally {
  ws.close();
  chrome.kill();
  server.close();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
