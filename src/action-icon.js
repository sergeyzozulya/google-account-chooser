// Icon choices for the toolbar (Options → General) and the dashboard (Options → Dashboard), shared by
// the background worker and the extension's pages. Drawn on a canvas in a 128×128 box: the worker
// can't load SVG files, and the date and time are drawn anyway.
// changes: what the icon shows that goes out of date, 'minute' or 'day'. No draw: the manifest's icon.

// In a page, whether it's in the dark theme; the worker has no matchMedia
const DARK_THEME = globalThis.matchMedia?.('(prefers-color-scheme: dark)');

// Ink as the header buttons (--text-low in the pages), on paper for text and faces
let iconInk, iconPaper;

const ACTION_ICONS = [
  { id: 'default', label: 'Default' },
  { id: 'day', label: 'Day', changes: 'day', draw(ctx, now) { drawTile(ctx, iconInk); drawText(ctx, String(now.getDate()), 64, 84, iconPaper, 108); } },
  { id: 'weekday', label: 'Weekday', changes: 'day', draw(ctx, now) { drawTile(ctx, iconInk); drawText(ctx, weekdayShort(now), 64, 64, iconPaper, 108); } },
  { id: 'date', label: 'Mini date', changes: 'day', draw: drawMiniDate },
  { id: 'clock', label: 'Clock', changes: 'minute', draw: drawClock },
  { id: 'launcher', label: 'Launcher', draw: drawLauncher },
  { id: 'panels', label: 'Panels', draw: drawPanels },
];

function drawActionIcon(ctx, icon, size, now, dark) {
  iconInk = dark ? '#9aa0a6' : '#5f6368';
  iconPaper = dark ? '#202124' : '#fff';
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.scale(size / 128, size / 128);
  icon.draw(ctx, now);
  ctx.restore();
}

// When an icon with this changes value next needs drawing again, in ms since the epoch
function nextIconChange(changes, now) {
  if (changes === 'minute') return now.getTime() - now.getTime() % 60000 + 60000;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
}

// First letters of the weekday or month in the browser's language, in capitals
const shortName = (now, part, length) => now.toLocaleDateString(undefined, { [part]: 'short' }).slice(0, length).toLocaleUpperCase();
const weekdayShort = (now) => shortName(now, 'weekday', 2);

function drawTile(ctx, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(0, 0, 128, 128, 28);
  ctx.fill();
}

// Centered on the ink of the text, as a middle baseline leaves digits off center. Font size and
// baseline snap to whole pixels of the canvas, or 16 px icons blur the text.
function drawText(ctx, text, y, fontSize, color, maxWidth) {
  const scale = ctx.getTransform().a;
  ctx.font = `700 ${Math.round(fontSize * scale) / scale}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = color;
  const { actualBoundingBoxAscent: up, actualBoundingBoxDescent: down } = ctx.measureText(text);
  ctx.fillText(text, 64, Math.round((y + (up - down) / 2) * scale) / scale, maxWidth);
}

const rimPoint = (turn, radius) => [
  64 + radius * Math.sin(turn * 2 * Math.PI),
  64 - radius * Math.cos(turn * 2 * Math.PI),
];

// A calendar page with a border: the month on a colored band over the day of the month
function drawMiniDate(ctx, now) {
  drawTile(ctx, iconPaper);
  ctx.fillStyle = iconInk;
  ctx.beginPath();
  ctx.roundRect(0, 0, 128, 50, [28, 28, 0, 0]);
  ctx.fill();
  ctx.strokeStyle = iconInk;
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.roundRect(4, 4, 120, 120, 24);
  ctx.stroke();
  drawText(ctx, shortName(now, 'month', 3), 25, 40, iconPaper, 116);
  drawText(ctx, String(now.getDate()), 88, 72, iconInk, 108);
}

function drawClock(ctx, now) {
  ctx.fillStyle = iconPaper;
  ctx.strokeStyle = iconInk;
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.arc(64, 64, 58, 0, 2 * Math.PI);
  ctx.fill();
  ctx.stroke();

  const minutes = now.getMinutes();
  const hand = (turn, length, width) => {
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(64, 64);
    ctx.lineTo(...rimPoint(turn, length));
    ctx.stroke();
  };
  hand((now.getHours() % 12 + minutes / 60) / 12, 28, 13);
  hand(minutes / 60, 42, 10);
}

// Nine dots, as on Google's apps button
function drawLauncher(ctx) {
  ctx.fillStyle = iconInk;
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      ctx.beginPath();
      ctx.arc(24 + col * 40, 24 + row * 40, 16, 0, 2 * Math.PI);
      ctx.fill();
    }
  }
}

// The outlined panels of the dashboard button in the Options header
function drawPanels(ctx) {
  ctx.strokeStyle = iconInk;
  ctx.lineWidth = 12;
  for (const [x, y, w, h] of [[6, 6, 48, 64], [74, 6, 48, 32], [74, 58, 48, 64], [6, 90, 48, 32]]) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 8);
    ctx.stroke();
  }
}

// The icon in the header of the dashboard and the popup (Options → Dashboard → Icon), also on the
// browser tab. The default leaves the tab to Chrome, which shows the extension's icon.
const pageIcon = { img: null, pixels: 0, id: 'default', timer: null };

function setPageIcon(img, pixels, id) {
  Object.assign(pageIcon, { img, pixels, id });
  renderPageIcon();
}

function renderPageIcon() {
  if (!pageIcon.img) return;
  clearTimeout(pageIcon.timer);
  document.querySelector('link[rel="icon"]')?.remove();
  const icon = ACTION_ICONS.find(i => i.id === pageIcon.id);
  if (!icon?.draw) {
    pageIcon.img.src = 'icons/icon.png';
    return;
  }
  const now = new Date();
  const dataUrl = (size) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    drawActionIcon(canvas.getContext('2d'), icon, size, now, DARK_THEME.matches);
    return canvas.toDataURL();
  };
  pageIcon.img.src = dataUrl(pageIcon.pixels);
  document.head.append(Object.assign(document.createElement('link'), { rel: 'icon', href: dataUrl(32) }));
  if (icon.changes) pageIcon.timer = setTimeout(renderPageIcon, nextIconChange(icon.changes, now) - now);
}

// The worker can't see the theme, so the extension's pages tell it, when they open and when it changes
if (DARK_THEME) {
  const onTheme = () => {
    chrome.storage.local.set({ darkTheme: DARK_THEME.matches });
    renderPageIcon();
  };
  onTheme();
  DARK_THEME.addEventListener('change', onTheme);
}
