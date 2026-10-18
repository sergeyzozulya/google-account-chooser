// What's new: store screenshots as a slider, then CHANGELOG.md. Opened once after each update
// (background.js) and from the ? icon in the Options header.

document.getElementById('version').textContent = `Version ${chrome.runtime.getManifest().version}`;

// ── Slider ─────────────────────────────────────────────────────────────────

const slides = document.getElementById('slides');
const count = slides.children.length;
let current = 0;

document.getElementById('dots').innerHTML = Array.from({ length: count },
  (_, i) => `<button data-slide="${i}" title="${slides.children[i].alt}"></button>`).join('');

function show(i) {
  current = (i + count) % count;
  slides.style.transform = `translateX(-${current * 100}%)`;
  document.querySelectorAll('[data-slide]').forEach((dot, k) => dot.setAttribute('aria-current', k === current));
}

document.getElementById('prev').addEventListener('click', () => show(current - 1));
document.getElementById('next').addEventListener('click', () => show(current + 1));
document.getElementById('dots').addEventListener('click', (e) => {
  const dot = e.target.closest('[data-slide]');
  if (dot) show(Number(dot.dataset.slide));
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') show(current - 1);
  if (e.key === 'ArrowRight') show(current + 1);
});
show(0);

// ── Changelog (the subset of Markdown CHANGELOG.md uses) ───────────────────

const esc = (s) => s.replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const inline = (text) => esc(text)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

function renderMarkdown(md) {
  const html = [];
  let list = false;
  const closeList = () => { if (list) { html.push('</ul>'); list = false; } };
  for (const line of md.split('\n')) {
    if (line.startsWith('- ')) {
      if (!list) { html.push('<ul>'); list = true; }
      html.push(`<li>${inline(line.slice(2))}</li>`);
      continue;
    }
    closeList();
    if (line.startsWith('# ')) continue; // the page has its own title
    else if (line.startsWith('### ')) html.push(`<h3>${inline(line.slice(4))}</h3>`);
    else if (line.startsWith('## ')) html.push(`<h2>${inline(line.slice(3).replace(/^\[(.+?)\]/, '$1'))}</h2>`);
    else if (line.trim() === '---') html.push('<hr>');
    else if (line.trim()) html.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return html.join('\n');
}

fetch('CHANGELOG.md')
  .then(res => res.text())
  .then(md => { document.getElementById('changelog').innerHTML = renderMarkdown(md); });
