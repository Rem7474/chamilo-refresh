(() => {
  'use strict';

  const path = location.pathname;
  if (!/^\/(?:index\.php|user_portal\.php)?$/.test(path)) return;

  const COURSE_HREF = /\/courses\/([^/?#]+)\/index\.php/i;
  const BOUNDARY = 'body, .wrap, #content-section, .container, main, section';
  const SKIP_LINKS = '.navbar, .breadcrumb, .menu-column, .nav';
  const NOT_A_COURSE_LIST = '#homepage-home, [class*="welcome-home"], #login_block';
  const KEY = (a) => {
    const m = COURSE_HREF.exec(a.getAttribute('href') || '');
    if (!m) return null;
    let session = '0';
    try { session = new URL(a.href, location.href).searchParams.get('id_session') || '0'; } catch { /* bad href */ }
    return `${m[1]}:${session}`;
  };
  const normalize = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

  function collectUnits() {
    const links = [...document.querySelectorAll('#content-section a[href*="/courses/"]')]
      .filter((a) => KEY(a) && !a.closest(SKIP_LINKS) && !a.closest(NOT_A_COURSE_LIST));
    const byKey = new Map();
    for (const a of links) {
      if (!byKey.has(KEY(a))) byKey.set(KEY(a), []);
      byKey.get(KEY(a)).push(a);
    }

    const onlyThisCourse = (el, key) => {
      if (el.querySelector('input, select, form, textarea')) return false;
      return [...el.querySelectorAll('a[href*="/courses/"]')].every((x) => !KEY(x) || KEY(x) === key);
    };

    const units = [];
    for (const [key, anchors] of byKey) {
      let el = anchors[0];
      for (let depth = 0; depth < 6 && el.parentElement && !el.parentElement.matches(BOUNDARY); depth++) {
        if (!onlyThisCourse(el.parentElement, key)) break;
        el = el.parentElement;
      }
      while (el.parentElement && !el.parentElement.matches(BOUNDARY) && el.parentElement.children.length === 1) {
        el = el.parentElement;
      }
      const title = anchors.find((a) => a.textContent.trim()) || anchors[0];
      units.push({ key, el, title, text: normalize(el.textContent), index: units.length });
    }
    return units.filter((u, i) => units.findIndex((v) => v.el === u.el) === i);
  }

  function commonAncestor(els) {
    let node = els[0].parentElement;
    while (node && !els.every((e) => node.contains(e))) node = node.parentElement;
    return node;
  }

  function findNativeSearch() {
    const inputs = document.querySelectorAll(
      '#content-section input[type="text"], #content-section input[type="search"], #content-section input:not([type])'
    );
    return [...inputs].find((i) => /recherch|search/i.test(`${i.placeholder} ${i.name} ${i.id}`));
  }

  const WIDGET = 'select, .select2-container, .chosen-container, .bootstrap-select';
  const SIDEBAR = '.menu-column, aside, .sidebar, .navbar, .breadcrumb';

  // Sélecteurs de recherche natifs (select, select2, chosen) situés dans la colonne principale, avant la première carte.
  function findNativeSelects(units) {
    const first = units.map((u) => u.el).sort((a, b) => (a.compareDocumentPosition(b) & 4 ? -1 : 1))[0];
    const widgets = [...document.querySelectorAll(`#content-section ${WIDGET.split(', ').join(', #content-section ')}`)]
      .filter((w) => !w.closest(SIDEBAR) && !units.some((u) => u.el.contains(w)))
      .filter((w) => !w.parentElement.closest(WIDGET))
      .filter((w) => w.tagName !== 'SELECT' || !w.nextElementSibling || !w.nextElementSibling.matches(WIDGET))
      .filter((w) => first.compareDocumentPosition(w) & 2);
    const looksLikeSearch = (w) => /recherch|search|cours|course/i.test(
      `${w.id} ${w.className} ${w.getAttribute('name') || ''} ${w.getAttribute('data-placeholder') || ''}`);
    const chosen = widgets.filter(looksLikeSearch);
    return chosen.length ? chosen : widgets;
  }

  const svg = (d) =>
    `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">${d}</svg>`;

  function init(settings) {
    if (!settings.courseTools || document.querySelector('#formLogin')) return;
    const units = collectUnits();
    if (!units.length) return;

    let favorites = new Set(settings.favorites);
    let favoritesOnly = false;
    let activeIndex = -1;

    const native = findNativeSearch();
    const nativeForm = native && native.form;
    if (native) (native.closest('.panel, .well') || nativeForm || native).classList.add('bc-native-search');
    for (const w of findNativeSelects(units)) {
      const wrapper = w.closest('.form-group, .panel, .well, form');
      const others = wrapper ? [...wrapper.querySelectorAll('input:not([type=hidden]), button, textarea, select')].filter((x) => !w.contains(x) && !x.closest(WIDGET)) : [1];
      (others.length ? w : wrapper).classList.add('bc-native-search');
      const sibling = w.nextElementSibling;
      if (sibling && sibling.matches(WIDGET)) sibling.classList.add('bc-native-search');
    }

    const hero = document.createElement('div');
    hero.className = 'bc-hero';
    hero.setAttribute('role', 'search');
    hero.innerHTML = `
      <div class="bc-hero-row">
        <span class="bc-hero-icon">${svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>')}</span>
        <input class="bc-hero-input" type="search" autocomplete="off" spellcheck="false"
               placeholder="Rechercher un cours, un enseignant…" aria-label="Rechercher parmi mes cours">
        <kbd class="bc-hero-kbd" title="Appuyez sur / pour rechercher">/</kbd>
      </div>
      <div class="bc-hero-meta">
        <button type="button" class="bc-chip" aria-pressed="false">★ Favoris</button>
        <span class="bc-count" aria-live="polite"></span>
        <span class="bc-hint">↑ ↓ pour naviguer · Entrée pour ouvrir · Échap pour effacer</span>
      </div>`;
    const input = hero.querySelector('.bc-hero-input');
    const chip = hero.querySelector('.bc-chip');
    const count = hero.querySelector('.bc-count');

    const empty = document.createElement('p');
    empty.className = 'bc-empty';
    empty.hidden = true;

    const container = document.querySelector('#content-section > .container') || document.querySelector('#content-section');
    const lca = commonAncestor(units.map((u) => u.el));
    const crumbs = container && container.querySelector(':scope > .breadcrumb');
    if (crumbs) crumbs.after(hero);
    else if (container) container.prepend(hero);
    else lca.before(hero);
    lca.before(empty);

    for (const u of units) {
      u.el.classList.add('bc-card');
      const star = document.createElement('button');
      star.type = 'button';
      star.className = 'bc-star';
      star.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        favorites.has(u.key) ? favorites.delete(u.key) : favorites.add(u.key);
        chrome.storage.sync.set({ favorites: [...favorites] });
        refresh();
      });
      u.star = star;
      const heading = u.title.closest('h1, h2, h3, h4, h5');
      if (heading) heading.append(star);
      else u.title.after(star);
    }

    function visibleUnits() {
      return units.filter((u) => !u.el.classList.contains('bc-hidden'));
    }

    function setActive(i) {
      const visible = visibleUnits();
      units.forEach((u) => u.el.classList.remove('bc-active'));
      activeIndex = visible.length ? Math.max(0, Math.min(i, visible.length - 1)) : -1;
      if (activeIndex >= 0) {
        visible[activeIndex].el.classList.add('bc-active');
        visible[activeIndex].el.scrollIntoView({ block: 'nearest' });
      }
    }

    function sortFavoritesFirst() {
      const parents = new Set(units.map((u) => u.el.parentElement));
      if (parents.size !== 1) return;
      const parent = [...parents][0];
      const end = document.createComment('');
      units[units.length - 1].el.after(end);
      const ordered = [...units].sort((a, b) => (favorites.has(b.key) - favorites.has(a.key)) || a.index - b.index);
      ordered.forEach((u) => parent.insertBefore(u.el, end));
      end.remove();
    }

    function refresh() {
      const terms = normalize(input.value).split(' ').filter(Boolean);
      for (const u of units) {
        const fav = favorites.has(u.key);
        const match = terms.every((t) => u.text.includes(t)) && (!favoritesOnly || fav);
        u.el.classList.toggle('bc-hidden', !match);
        u.el.classList.toggle('bc-fav', fav);
        u.star.textContent = fav ? '★' : '☆';
        u.star.setAttribute('aria-pressed', String(fav));
        u.star.title = u.star.ariaLabel = fav ? 'Retirer des favoris' : 'Ajouter aux favoris';
      }
      sortFavoritesFirst();
      const shown = visibleUnits().length;
      count.textContent = shown === units.length ? `${units.length} cours` : `${shown} / ${units.length} cours`;
      empty.hidden = shown > 0;
      empty.textContent = favoritesOnly && !terms.length
        ? 'Aucun favori pour le moment : cliquez sur ☆ à côté d’un cours.'
        : `Aucun de vos cours ne correspond à « ${input.value.trim()} ».${nativeForm ? ' Entrée lance la recherche Chamilo.' : ''}`;
      setActive(terms.length ? 0 : -1);
    }

    function mirrorToNative() {
      if (!native) return;
      native.value = input.value;
      native.dispatchEvent(new Event('input', { bubbles: true }));
      native.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    }

    input.addEventListener('input', () => { refresh(); mirrorToNative(); });
    chip.addEventListener('click', () => {
      favoritesOnly = !favoritesOnly;
      chip.setAttribute('aria-pressed', String(favoritesOnly));
      refresh();
    });
    input.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(activeIndex + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(activeIndex - 1); }
      else if (e.key === 'Escape') { input.value = ''; refresh(); mirrorToNative(); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const visible = visibleUnits();
        if (visible.length) visible[Math.max(activeIndex, 0)].title.click();
        else if (nativeForm && input.value.trim()) { mirrorToNative(); nativeForm.requestSubmit ? nativeForm.requestSubmit() : nativeForm.submit(); }
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
      e.preventDefault();
      input.focus();
      input.select();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes.favorites) {
        favorites = new Set(changes.favorites.newValue || []);
        refresh();
      }
    });

    refresh();
    if (!location.hash && !document.activeElement.matches('input, textarea, select')) input.focus({ preventScroll: true });
  }

  chrome.storage.sync.get(BC_DEFAULTS, init);
})();
