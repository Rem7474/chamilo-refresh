(() => {
  'use strict';

  // Raw course content (documents, SCORM) is authored HTML, not Chamilo UI.
  if (window !== window.top && location.pathname.startsWith('/courses/')) return;

  const root = document.documentElement;
  const prefersDark = matchMedia('(prefers-color-scheme: dark)');
  const settings = { theme: BC_DEFAULTS.theme, accent: BC_DEFAULTS.accent, fixContrast: BC_DEFAULTS.fixContrast };

  const hexToRgb = (hex) => {
    let h = hex.trim().replace('#', '');
    if (h.length === 3) h = [...h].map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const rgbToHex = (rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  const luminance = ([r, g, b]) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const contrast = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const parseCssColor = (value) => {
    const m = /^rgba?\(([^)]+)\)$/.exec(value.trim());
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  };
  const token = (name, fallback) => getComputedStyle(root).getPropertyValue(name).trim() || fallback;

  const resolvedTheme = () => {
    if (settings.theme === 'off') return null;
    if (settings.theme === 'auto') return prefersDark.matches ? 'dark' : 'light';
    return settings.theme;
  };

  function applyAccent(theme) {
    const accent = hexToRgb(settings.accent);
    const surface = hexToRgb(token('--bc-surface-2', theme === 'dark' ? '#1e2230' : '#eef0f7'));
    const target = theme === 'dark' ? [255, 255, 255] : [0, 0, 0];
    let link = accent;
    for (let t = 0; contrast(link, surface) < 4.5 && t <= 1; t += 0.05) link = mix(accent, target, t);
    const onAccent = contrast(accent, [11, 13, 20]) >= contrast(accent, [255, 255, 255]) ? '#0b0d14' : '#ffffff';
    root.style.setProperty('--bc-accent', settings.accent);
    root.style.setProperty('--bc-link', rgbToHex(link));
    root.style.setProperty('--bc-on-accent', onAccent);
  }

  // Chamilo's own stylesheets paint white rows, toolbars and light-grey text that the dark theme
  // cannot reach with selectors alone. Measure the rendered result instead: near-white backgrounds
  // are flagged `.bc-bg`, and text that stays unreadable is flagged `.bc-fix`.
  const SKIP_TAGS = /^(SCRIPT|STYLE|NOSCRIPT|IMG|SVG|CANVAS|VIDEO|IFRAME|INPUT|BUTTON|SELECT|TEXTAREA|OPTION|HTML|BODY)$/;
  const OWN_UI = '.bc-hero, .bc-hero *';

  function fixContrast(theme) {
    document.querySelectorAll('.bc-fix, .bc-bg, .bc-ink, .bc-paper').forEach((el) => el.classList.remove('bc-fix', 'bc-bg', 'bc-ink', 'bc-paper'));
    if (!theme || !document.body) return;

    const pageBg = hexToRgb(token('--bc-bg', '#ffffff'));
    const themeText = hexToRgb(token('--bc-text', '#000000'));
    const all = [...document.body.querySelectorAll('*')].slice(0, 6000);

    if (theme === 'dark') {
      for (const el of all) {
        if (SKIP_TAGS.test(el.tagName) || el.matches(OWN_UI) || el.closest('.btn, .label, .badge, .navbar')) continue;
        const cs = getComputedStyle(el);
        if (cs.backgroundImage !== 'none') continue;
        const bg = parseCssColor(cs.backgroundColor);
        if (bg && bg[3] >= 0.9 && luminance(bg) > 0.55) el.classList.add('bc-bg');
      }
    }

    if (!settings.fixContrast) return;
    const effectiveBg = (el) => {
      const layers = [];
      for (let n = el; n; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.backgroundImage !== 'none') return null;
        const bg = parseCssColor(cs.backgroundColor);
        if (!bg) return null;
        if (bg[3] > 0) layers.push(bg);
        if (bg[3] >= 1) break;
      }
      let base = pageBg;
      for (let i = layers.length - 1; i >= 0; i--) {
        const [r, g, b, a] = layers[i];
        base = [r * a + base[0] * (1 - a), g * a + base[1] * (1 - a), b * a + base[2] * (1 - a)];
      }
      return base;
    };

    for (const el of all) {
      if (SKIP_TAGS.test(el.tagName) || el.matches(OWN_UI)) continue;
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const fg = parseCssColor(getComputedStyle(el).color);
      const base = fg && effectiveBg(el);
      if (!base) continue;
      const current = contrast(fg, base);
      if (current >= 4.5) continue;
      // Fonds colorés (évènements du calendrier…) : si le texte du thème ne suffit pas, on prend le meilleur de blanc ou noir.
      const options = [['bc-fix', themeText], ['bc-paper', [255, 255, 255]], ['bc-ink', [0, 0, 0]]]
        .map(([cls, rgb]) => [cls, contrast(rgb, base)]);
      const best = options[0][1] >= 4.5 ? options[0] : options.reduce((x, y) => (y[1] > x[1] ? y : x));
      if (best[1] > current) el.classList.add(best[0]);
    }
  }

  function apply() {
    const theme = resolvedTheme();
    if (theme) {
      root.dataset.bcTheme = theme;
      applyAccent(theme);
    } else {
      delete root.dataset.bcTheme;
      ['--bc-accent', '--bc-link', '--bc-on-accent'].forEach((p) => root.style.removeProperty(p));
    }
    if (document.readyState !== 'loading') fixContrast(theme);
  }

  function merge(partial) {
    for (const key of Object.keys(settings)) if (partial && partial[key] !== undefined) settings[key] = partial[key];
  }

  try { merge(JSON.parse(localStorage.getItem(BC_CACHE_KEY) || '{}')); } catch { /* storage blocked */ }
  apply();

  chrome.storage.sync.get(BC_DEFAULTS, (stored) => {
    merge(stored);
    try { localStorage.setItem(BC_CACHE_KEY, JSON.stringify(settings)); } catch { /* storage blocked */ }
    apply();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const [key, { newValue }] of Object.entries(changes)) merge({ [key]: newValue });
    try { localStorage.setItem(BC_CACHE_KEY, JSON.stringify(settings)); } catch { /* storage blocked */ }
    apply();
  });

  prefersDark.addEventListener('change', apply);
  document.addEventListener('DOMContentLoaded', () => fixContrast(resolvedTheme()));
  window.addEventListener('load', () => fixContrast(resolvedTheme()));
})();
