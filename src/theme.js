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

  // Inline colours written by teachers (pasted from Word, etc.) can be unreadable on the new
  // background. Flag the offenders so the stylesheet can swap in the theme text colour.
  function fixInlineContrast(theme) {
    document.querySelectorAll('.bc-fix').forEach((el) => el.classList.remove('bc-fix'));
    if (!theme || !settings.fixContrast || !document.body) return;

    const pageBg = hexToRgb(token('--bc-bg', '#ffffff'));
    const themeText = hexToRgb(token('--bc-text', '#000000'));
    const candidates = document.body.querySelectorAll('[style*="color"], font[color]');

    for (const el of [...candidates].slice(0, 4000)) {
      const fg = parseCssColor(getComputedStyle(el).color);
      if (!fg) continue;

      const layers = [];
      let skip = false;
      for (let n = el; n; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.backgroundImage !== 'none') { skip = true; break; }
        const bg = parseCssColor(cs.backgroundColor);
        if (!bg) { skip = true; break; }
        if (bg[3] > 0) layers.push(bg);
        if (bg[3] >= 1) break;
      }
      if (skip) continue;

      let base = pageBg;
      for (let i = layers.length - 1; i >= 0; i--) {
        const [r, g, b, a] = layers[i];
        base = [r * a + base[0] * (1 - a), g * a + base[1] * (1 - a), b * a + base[2] * (1 - a)];
      }
      const current = contrast(fg, base);
      if (current < 4.5 && contrast(themeText, base) > current) el.classList.add('bc-fix');
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
    if (document.readyState !== 'loading') fixInlineContrast(theme);
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
  document.addEventListener('DOMContentLoaded', () => fixInlineContrast(resolvedTheme()));
  window.addEventListener('load', () => fixInlineContrast(resolvedTheme()));
})();
