// Icon choices for the toolbar (Options → General) and the dashboard (Options → Dashboard), shared by
// the background worker, Options and the dashboard. Drawn on a canvas in a 128×128 box: the worker can't load SVG files, and the date and time are drawn anyway.
// The worker can't see the toolbar's theme either, so icons with text or hands bring their own background.
// changes: what the icon shows that goes out of date, 'minute' or 'day'. No draw: the manifest's icon.

const ICON_COLOR = '#5f6368'; // as the header buttons in the light theme

const ACTION_ICONS = [
  { id: 'default', label: 'Default' },
  { id: 'day', label: 'Day', changes: 'day', draw(ctx, now) { drawTile(ctx, ICON_COLOR); drawText(ctx, String(now.getDate()), 64, 84, '#fff', 108); } },
  { id: 'weekday', label: 'Weekday', changes: 'day', draw(ctx, now) { drawTile(ctx, ICON_COLOR); drawText(ctx, weekdayShort(now), 64, 64, '#fff', 108); } },
  { id: 'date', label: 'Mini date', changes: 'day', draw: drawMiniDate },
  { id: 'clock', label: 'Clock', changes: 'minute', draw: drawClock },
  { id: 'launcher', label: 'Launcher', draw: drawLauncher },
  { id: 'panels', label: 'Panels', draw: drawPanels },
];

function drawActionIcon(ctx, icon, size, now) {
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
  drawTile(ctx, '#fff');
  ctx.fillStyle = ICON_COLOR;
  ctx.beginPath();
  ctx.roundRect(0, 0, 128, 50, [28, 28, 0, 0]);
  ctx.fill();
  ctx.strokeStyle = ICON_COLOR;
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.roundRect(4, 4, 120, 120, 24);
  ctx.stroke();
  drawText(ctx, shortName(now, 'month', 3), 25, 40, '#fff', 116);
  drawText(ctx, String(now.getDate()), 88, 72, ICON_COLOR, 108);
}

function drawClock(ctx, now) {
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = ICON_COLOR;
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
  ctx.fillStyle = ICON_COLOR;
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
  ctx.strokeStyle = ICON_COLOR;
  ctx.lineWidth = 12;
  for (const [x, y, w, h] of [[6, 6, 48, 64], [74, 6, 48, 32], [74, 58, 48, 64], [6, 90, 48, 32]]) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 8);
    ctx.stroke();
  }
}
