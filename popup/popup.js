const ACCENTS = ['#7c8cff', '#38bdf8', '#34d399', '#f59e0b', '#f472b6', '#ef4444'];
const $ = (id) => document.getElementById(id);

const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

function paintAccent(accent) {
  document.documentElement.style.setProperty('--accent', accent);
  document.documentElement.style.setProperty('--on-accent', luminance(accent) > 0.35 ? '#0b0d14' : '#ffffff');
  document.querySelectorAll('#swatches button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.color === accent)));
  $('accent').value = accent;
}

function save(partial, needsReload = false) {
  chrome.storage.sync.set(partial, () => void chrome.runtime.lastError);
  if (needsReload) $('note').hidden = false;
}

// chrome.storage.sync limite les écritures (~120/min) : pendant le glissement du sélecteur on espace les écritures,
// et la valeur finale est toujours écrite au relâchement.
const ACCENT_WRITE_INTERVAL = 700;
let accentTimer = 0;
let accentLastWrite = 0;
let accentPending = null;

function flushAccent() {
  clearTimeout(accentTimer);
  accentTimer = 0;
  if (accentPending === null) return;
  const accent = accentPending;
  accentPending = null;
  accentLastWrite = Date.now();
  save({ accent });
}

function saveAccent(accent, final = false) {
  accentPending = accent;
  const wait = accentLastWrite + ACCENT_WRITE_INTERVAL - Date.now();
  if (final || wait <= 0) flushAccent();
  else if (!accentTimer) accentTimer = setTimeout(flushAccent, wait);
}

chrome.storage.sync.get(BC_DEFAULTS, (s) => {
  document.querySelector(`input[name="theme"][value="${s.theme}"]`).checked = true;
  $('fixContrast').checked = s.fixContrast;
  $('courseTools').checked = s.courseTools;

  for (const color of ACCENTS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.color = color;
    b.style.background = color;
    b.title = b.ariaLabel = color;
    b.addEventListener('click', () => { paintAccent(color); saveAccent(color, true); });
    $('swatches').append(b);
  }
  paintAccent(s.accent);

  $('theme').addEventListener('change', (e) => save({ theme: e.target.value }));
  $('accent').addEventListener('input', (e) => { paintAccent(e.target.value); saveAccent(e.target.value); });
  $('accent').addEventListener('change', (e) => saveAccent(e.target.value, true));
  window.addEventListener('pagehide', flushAccent);
  $('fixContrast').addEventListener('change', (e) => save({ fixContrast: e.target.checked }));
  $('courseTools').addEventListener('change', (e) => save({ courseTools: e.target.checked }, true));
});
