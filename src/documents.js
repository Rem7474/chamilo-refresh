(() => {
  'use strict';

  if (window !== window.top) return;

  // Chamilo exposes the folder tree only as a flat <select>; depth is encoded by leading " — ".
  const select = document.querySelector('form#selector select[name="id"]');
  const form = select && select.form;
  if (!select || select.options.length < 2) return;

  chrome.storage.sync.get(BC_DEFAULTS, (settings) => {
    if (settings.theme === 'off') return;

    const nodes = [...select.options].map((o, i) => {
      const label = o.textContent.replace(/ /g, ' ');
      const depth = i === 0 ? 0 : Math.max(1, (label.match(/—/g) || []).length);
      return { value: o.value, depth, name: label.replace(/[—\s]+/, '').trim() || label.trim(), selected: o.selected, children: [] };
    });
    const stack = [];
    for (const n of nodes) {
      while (stack.length && stack[stack.length - 1].depth >= n.depth) stack.pop();
      n.parent = stack[stack.length - 1] || null;
      if (n.parent) n.parent.children.push(n);
      stack.push(n);
    }
    const current = nodes.find((n) => n.selected) || nodes[0];
    const open = new Set();
    for (let n = current; n; n = n.parent) open.add(n);

    const urlFor = (n) => {
      const u = new URL(form.getAttribute('action') || location.href, location.href);
      u.searchParams.set('id', n.value);
      return u.href;
    };

    const folderSvg = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';

    function build(n) {
      const li = document.createElement('li');
      li.className = 'bc-tree-item';
      const row = document.createElement('div');
      row.className = 'bc-tree-row';
      let list = null;
      if (n.children.length) {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'bc-tree-toggle';
        toggle.setAttribute('aria-label', `Déplier ${n.name}`);
        toggle.addEventListener('click', () => {
          const expanded = toggle.getAttribute('aria-expanded') !== 'true';
          toggle.setAttribute('aria-expanded', String(expanded));
          list.hidden = !expanded;
        });
        row.append(toggle);
        list = document.createElement('ul');
        list.className = 'bc-tree-list';
        n.children.forEach((c) => list.append(build(c)));
        const expanded = open.has(n);
        toggle.setAttribute('aria-expanded', String(expanded));
        list.hidden = !expanded;
      } else {
        const gap = document.createElement('span');
        gap.className = 'bc-tree-toggle bc-tree-gap';
        row.append(gap);
      }
      const link = document.createElement('a');
      link.className = 'bc-tree-link';
      link.href = urlFor(n);
      link.innerHTML = folderSvg;
      link.append(document.createTextNode(n.name));
      if (n === current) { link.classList.add('bc-tree-current'); link.setAttribute('aria-current', 'page'); }
      row.append(link);
      li.append(row);
      if (list) li.append(list);
      return li;
    }

    const aside = document.createElement('nav');
    aside.className = 'bc-tree';
    aside.setAttribute('aria-label', 'Arborescence des documents');
    const title = document.createElement('div');
    title.className = 'bc-tree-title';
    title.textContent = 'Dossiers';
    const root = document.createElement('ul');
    root.className = 'bc-tree-list bc-tree-root';
    nodes.filter((n) => !n.parent).forEach((n) => root.append(build(n)));
    aside.append(title, root);

    const start = document.querySelector('#toolbar-document') || form;
    const parent = start.parentElement;
    const layout = document.createElement('div');
    layout.className = 'bc-docs-layout';
    const main = document.createElement('div');
    main.className = 'bc-docs-main';
    start.before(layout);
    for (let n = start; n; ) { const next = n.nextSibling; main.append(n); n = next; }
    layout.append(aside, main);
    form.classList.add('bc-native-select');
    parent.classList.add('bc-docs-parent');
  });
})();
