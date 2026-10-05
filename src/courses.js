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

  const COURSE_HEADING = 'h1, h2, h3, h4, h5, h6';
  const HEADING_KEY = (h) => `title:${normalize(h.textContent)}`;
  const isCourseHeading = (h) => /course/i.test(h.className) && h.textContent.trim() && !h.querySelector('a[href*="/courses/"]');

  // Cours sans lien d'accès (fermés / inaccessibles) : repérés par leur titre.
  function collectUnits() {
    const inContent = (el) => !el.closest(SKIP_LINKS) && !el.closest(NOT_A_COURSE_LIST);
    const links = [...document.querySelectorAll('#content-section a[href*="/courses/"]')]
      .filter((a) => KEY(a) && inContent(a));
    const headings = [...document.querySelectorAll(`#content-section :is(${COURSE_HEADING})`)]
      .filter((h) => isCourseHeading(h) && inContent(h));
    const byKey = new Map();
    const add = (key, el, inaccessible) => {
      if (!byKey.has(key)) byKey.set(key, { els: [], inaccessible });
      byKey.get(key).els.push(el);
    };
    links.forEach((a) => add(KEY(a), a, false));
    headings.forEach((h) => { if (!h.closest('a')) add(HEADING_KEY(h), h, true); });

    const keysIn = (el) => {
      const keys = new Set();
      el.querySelectorAll('a[href*="/courses/"]').forEach((x) => { if (KEY(x)) keys.add(KEY(x)); });
      el.querySelectorAll(COURSE_HEADING).forEach((h) => { if (headings.includes(h)) keys.add(HEADING_KEY(h)); });
      return keys;
    };
    const onlyThisCourse = (el, key) => {
      if (el.querySelector('input, select, form, textarea')) return false;
      return [...keysIn(el)].every((k) => k === key);
    };

    const units = [];
    for (const [key, { els: anchors, inaccessible }] of byKey) {
      let el = anchors[0];
      for (let depth = 0; depth < 6 && el.parentElement && !el.parentElement.matches(BOUNDARY); depth++) {
        if (!onlyThisCourse(el.parentElement, key)) break;
        el = el.parentElement;
      }
      while (el.parentElement && !el.parentElement.matches(BOUNDARY) && el.parentElement.children.length === 1) {
        el = el.parentElement;
      }
      const title = anchors.find((a) => a.textContent.trim()) || anchors[0];
      units.push({ key, el, title, inaccessible, text: normalize(el.textContent), index: units.length });
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
    const native = findNativeSearch();
    if (!units.length && !native) return;
    const catalogOnly = !units.length;

    let favorites = new Set(settings.favorites);
    let favoritesOnly = false;
    let activeIndex = -1;

    const nativeForm = native && native.form;
    const nativeBlock = native && (native.closest('.panel, .well') || nativeForm || native);
    if (native) nativeBlock.classList.add('bc-native-search');
    for (const w of units.length ? findNativeSelects(units) : []) {
      const wrapper = w.closest('.form-group, .panel, .well, form');
      const others = wrapper ? [...wrapper.querySelectorAll('input:not([type=hidden]), button, textarea, select')].filter((x) => !w.contains(x) && !x.closest(WIDGET)) : [1];
      (others.length ? w : wrapper).classList.add('bc-native-search');
      const sibling = w.nextElementSibling;
      if (sibling && sibling.matches(WIDGET)) sibling.classList.add('bc-native-search');
    }

    const hero = document.createElement('div');
    hero.className = catalogOnly ? 'bc-hero bc-hero-catalog' : 'bc-hero';
    hero.setAttribute('role', 'search');
    hero.innerHTML = `
      <div class="bc-hero-row">
        <span class="bc-hero-icon">${svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>')}</span>
        <input class="bc-hero-input" type="search" autocomplete="off" spellcheck="false"
               placeholder="${catalogOnly ? 'Rechercher un cours dans Chamilo…' : 'Rechercher un cours, un enseignant…'}"
               aria-label="Rechercher un cours">
        <kbd class="bc-hero-kbd" title="Appuyez sur / pour rechercher">/</kbd>
      </div>
      <div class="bc-hero-meta">
        <button type="button" class="bc-chip" aria-pressed="false">★ Favoris</button>
        <span class="bc-count" aria-live="polite"></span>
        <span class="bc-status" aria-live="polite"></span>
        <span class="bc-hint">${catalogOnly ? 'Entrée pour ouvrir le premier résultat · Échap pour effacer' : '↑ ↓ pour naviguer · Entrée pour ouvrir · Échap pour effacer'}</span>
      </div>`;
    const input = hero.querySelector('.bc-hero-input');
    const narrow = window.matchMedia('(max-width: 480px)');
    const fullPlaceholder = input.placeholder;
    const fitPlaceholder = () => { input.placeholder = narrow.matches ? 'Rechercher un cours…' : fullPlaceholder; };
    fitPlaceholder();
    narrow.addEventListener('change', fitPlaceholder);
    const chip = hero.querySelector('.bc-chip');
    const count = hero.querySelector('.bc-count');
    const status = hero.querySelector('.bc-status');

    const empty = document.createElement('p');
    empty.className = 'bc-empty';
    empty.hidden = true;

    const container = document.querySelector('#content-section > .container') || document.querySelector('#content-section');
    const lca = units.length ? commonAncestor(units.map((u) => u.el)) : null;
    const crumbs = container && container.querySelector(':scope > .breadcrumb');
    if (crumbs) crumbs.after(hero);
    else if (container) container.prepend(hero);
    else if (lca) lca.before(hero);
    else nativeBlock.before(hero);

    const catalog = document.createElement('section');
    catalog.className = 'bc-catalog';
    catalog.hidden = true;
    hero.after(empty);
    empty.after(catalog);

    for (const u of units) {
      u.el.classList.add('bc-card');
      if (u.inaccessible) u.el.classList.add('bc-closed');
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
      renderCatalog();
      setActive(terms.length ? 0 : -1);
    }

    function updateSummary() {
      const shown = visibleUnits().length;
      const term = input.value.trim();
      const extra = catalogRows.length;
      count.textContent = (shown === units.length ? `${units.length} cours` : `${shown} / ${units.length} de vos cours`)
        + (extra ? ` · ${extra} dans le catalogue` : '');
      const pending = Boolean(nativeForm) && term.length >= 2 && (inFlight || searchTerm !== term);
      const nothing = (catalogOnly ? term.length >= 2 : units.length > 0 || term.length > 0) && shown === 0 && !extra && !pending;
      empty.hidden = !nothing;
      if (!nothing) return;
      empty.textContent = favoritesOnly && !term
        ? 'Aucun favori pour le moment : cliquez sur ☆ à côté d’un cours.'
        : `Aucun cours ne correspond à « ${term} ».`;
    }

    // Recherche dans tout le catalogue : même requête que le formulaire natif, envoyée en arrière-plan (pas de rechargement).
    let searchSeq = 0;
    let searchTerm = '';
    let searching = Promise.resolve();
    let allCatalogRows = [];
    let catalogRows = [];
    let inFlight = false;
    const localCodes = () => new Set(visibleUnits().map((u) => u.key.split(':')[0].toLowerCase()));
    const rowCode = (r) => ((r.href.match(/\/courses\/([^/]+)\//) || [])[1] || '').toLowerCase();

    function setStatus(text) { status.textContent = text; }

    function parseResults(doc) {
      const list = doc.querySelector('#plugin_search_course_list');
      if (!list) return [];
      return [...list.querySelectorAll('tr')].map((tr) => {
        const link = tr.querySelector('a[href]');
        let href = '';
        try { href = link ? new URL(link.getAttribute('href'), location.href).href : ''; } catch { /* bad href */ }
        if (!/^https?:/.test(href)) href = '';
        const cells = [...tr.cells];
        const title = (link || cells[0] || tr).textContent.trim();
        const notes = [...tr.querySelectorAll('img')].map((i) => i.alt || i.title)
          .concat(cells.slice(1).map((c) => c.textContent.trim()))
          .filter(Boolean);
        return { title, href, notes: [...new Set(notes)] };
      }).filter((r) => r.title);
    }

    function renderCatalog() {
      const local = localCodes();
      catalogRows = allCatalogRows.filter((r) => !rowCode(r) || !local.has(rowCode(r)));
      catalog.hidden = !catalogRows.length;
      updateSummary();
      if (!catalogRows.length) { catalog.replaceChildren(); return; }
      const title = document.createElement('h3');
      title.className = 'bc-catalog-title';
      title.textContent = local.size ? 'Autres cours du catalogue Chamilo' : 'Dans le catalogue Chamilo';
      const ul = document.createElement('ul');
      ul.className = 'bc-results';
      for (const r of catalogRows) {
        const li = document.createElement('li');
        const name = document.createElement(r.href ? 'a' : 'span');
        name.className = 'bc-result-title';
        name.textContent = r.title;
        if (r.href) name.href = r.href;
        li.append(name);
        for (const note of r.notes) {
          const badge = document.createElement('span');
          badge.className = 'bc-badge-note';
          badge.textContent = note;
          li.append(badge);
        }
        ul.append(li);
      }
      catalog.replaceChildren(title, ul);
    }

    function clearCatalog() {
      searchSeq++;
      searchTerm = '';
      allCatalogRows = [];
      inFlight = false;
      renderCatalog();
      setStatus('');
    }

    function searchCatalog(term) {
      if (!nativeForm) return Promise.resolve();
      const seq = ++searchSeq;
      searchTerm = term;
      setStatus('Recherche dans le catalogue…');
      inFlight = true;
      updateSummary();
      searching = (async () => {
        let rows;
        try {
          const data = new URLSearchParams(new FormData(nativeForm));
          data.set(native.name, term);
          const url = new URL(nativeForm.getAttribute('action') || location.href, location.href);
          const init = { credentials: 'same-origin' };
          if ((nativeForm.method || 'get').toLowerCase() === 'post') { init.method = 'POST'; init.body = data; }
          else data.forEach((v, k) => url.searchParams.set(k, v));
          const res = await fetch(url, init);
          rows = parseResults(new DOMParser().parseFromString(await res.text(), 'text/html'));
        } catch (err) {
          if (seq === searchSeq) { inFlight = false; setStatus('Recherche dans le catalogue indisponible'); renderCatalog(); }
          return;
        }
        if (seq !== searchSeq) return;
        allCatalogRows = rows;
        inFlight = false;
        setStatus('');
        renderCatalog();
      })();
      return searching;
    }

    let searchTimer = 0;
    input.addEventListener('input', () => {
      clearTimeout(searchTimer);
      const term = input.value.trim();
      if (term.length >= 2 && nativeForm) searchTimer = setTimeout(() => searchCatalog(term), 300);
      else clearCatalog();
      refresh();
    });
    chip.addEventListener('click', () => {
      favoritesOnly = !favoritesOnly;
      chip.setAttribute('aria-pressed', String(favoritesOnly));
      refresh();
    });
    input.addEventListener('keydown', async (e) => {
      if (e.isComposing) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(activeIndex + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(activeIndex - 1); }
      else if (e.key === 'Escape') { input.value = ''; clearTimeout(searchTimer); clearCatalog(); refresh(); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const visible = visibleUnits();
        if (visible.length) {
          const t = visible[Math.max(activeIndex, 0)];
          if (!t.inaccessible) t.title.click();
          return;
        }
        const term = input.value.trim();
        if (!term || !nativeForm) return;
        clearTimeout(searchTimer);
        if (searchTerm !== term) searchCatalog(term);
        await searching;
        const first = catalogRows.find((r) => r.href);
        if (first && input.value.trim() === term) location.href = first.href;
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
