// Lance Chromium avec l'extension chargée et vérifie le thème, la recherche et les favoris.
// Usage : node test/e2e.cjs   (playwright-core doit être résolvable, ex. NODE_PATH=<dossier>/node_modules)
const { chromium } = require('playwright-core');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EXT = path.resolve(__dirname, '..');
const OUT = process.env.BC_OUT || path.join(os.tmpdir(), 'bc-e2e');
const CHROME = process.env.CHROME_PATH || fs.readdirSync(path.join(os.homedir(), '.cache/ms-playwright'))
  .filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
const executablePath = process.env.CHROME_PATH || path.join(os.homedir(), '.cache/ms-playwright', CHROME, 'chrome-linux64/chrome');
const ORIGIN = 'https://chamilo.grenoble-inp.fr';
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
};

// Contraste WCAG de chaque élément portant du texte visible, mesuré dans la page.
const auditContrast = () => {
  const parse = (v) => { const m = /^rgba?\(([^)]+)\)$/.exec(v); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const [h, l] = [lum(a), lum(b)].sort((x, y) => y - x); return (h + 0.05) / (l + 0.05); };
  const bad = [];
  for (const el of document.body.querySelectorAll('*')) {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || !el.getClientRects().length) continue;
    const fg = parse(cs.color);
    let base = [255, 255, 255]; const layers = []; let skip = false;
    for (let n = el; n; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.backgroundImage !== 'none') { skip = true; break; }
      const bg = parse(s.backgroundColor);
      if (bg && bg[3] > 0) layers.push(bg);
      if (bg && bg[3] >= 1) break;
    }
    if (skip || !fg) continue;
    for (let i = layers.length - 1; i >= 0; i--) { const [r, g, b, a] = layers[i]; base = [r * a + base[0] * (1 - a), g * a + base[1] * (1 - a), b * a + base[2] * (1 - a)]; }
    const size = parseFloat(cs.fontSize);
    const need = size >= 24 || (size >= 18.66 && +cs.fontWeight >= 700) ? 3 : 4.5;
    const r = ratio(fg, base);
    if (r < need) bad.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${(el.className + '').split(' ')[0]} "${el.textContent.trim().slice(0, 30)}" ${r.toFixed(2)}`);
  }
  return bad;
};

(async () => {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'bc-prof-')), {
    executablePath,
    headless: false,
    viewport: { width: 1500, height: 900 },
    args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  const extId = require('crypto').createHash('sha256').update(EXT).digest('hex').slice(0, 32)
    .replace(/[0-9a-f]/g, (c) => 'abcdefghijklmnop'[parseInt(c, 16)]);
  const mock = fs.readFileSync(path.join(__dirname, 'mock-portal.html'), 'utf8');
  const searchPosts = [];
  const catalogAnswer = (r) => {
    const body = r.request().postData() || '';
    searchPosts.push(body);
    const term = decodeURIComponent((/search_term=([^&]*)/.exec(body) || [])[1] || '').toLowerCase();
    const closed = '<div id="plugin_search_course_list" class="list"><h5>1 Résultat(s)</h5><div class="plugin_search_course"><table class="plugin_search_course"><tr><td><b>ESISAR IN511 - Intelligence Artificielle</b></td><td><img alt="L’inscription n’est pas autorisée" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></td></tr></table></div></div>';
    const list = term === 'in511' ? closed : term === 'in513'
      ? '<div id="plugin_search_course_list" class="list"><h5>1 Résultat(s)</h5><div class="plugin_search_course"><table class="plugin_search_course"><tr><td><b><a href="/courses/IN513/index.php">ESISAR IN513 - Infrastructures pour la sécurité</a></b></td><td><img alt="L’inscription n’est pas autorisée" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></td></tr></table></div></div>'
      : '<div id="plugin_search_course_list" class="list"><h5>0 Résultat(s)</h5></div>';
    return r.fulfill({ contentType: 'text/html; charset=utf-8', body: `<html><body>${list}</body></html>` });
  };
  await ctx.route(`${ORIGIN}/user_portal.php*`, (r) => (r.request().method() === 'POST' ? catalogAnswer(r) : r.fulfill({ contentType: 'text/html; charset=utf-8', body: mock })));
  await ctx.route(`${ORIGIN}/courses/**`, (r) => r.fulfill({ contentType: 'text/html', body: '<h1>cours ouvert</h1>' }));

  const setSettings = async (v) => {
    const p = await ctx.newPage();
    await p.goto(`chrome-extension://${extId}/popup/popup.html`);
    await p.evaluate((val) => new Promise((res) => chrome.storage.sync.clear(() => chrome.storage.sync.set(val, res))), v);
    await p.close();
  };

  // ---------- Page de connexion publique (vraie) ----------
  const login = await ctx.newPage();
  await login.goto(`${ORIGIN}/`, { waitUntil: 'load' });
  for (const theme of ['dark', 'light']) {
    await setSettings({ theme });
    await login.reload({ waitUntil: 'load' });
    check(await login.evaluate(() => document.documentElement.dataset.bcTheme) === theme, `[connexion] thème ${theme} appliqué`);
    check(await login.locator('.bc-hero, .bc-card').count() === 0, `[connexion] aucune barre de cours ajoutée (${theme})`);
    await login.screenshot({ path: path.join(OUT, `login-${theme}.png`) });
    const bad = await login.evaluate(auditContrast);
    check(bad.length === 0, `[connexion] contraste >= WCAG AA (${theme})`, bad.slice(0, 5).join(' | '));
  }

  // ---------- Maquette « Documents » : fonds blancs et texte gris clair du site ----------
  const docs = fs.readFileSync(path.join(__dirname, 'mock-documents.html'), 'utf8');
  await ctx.route(`${ORIGIN}/main/document/document.php*`, (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: docs }));
  const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  await ctx.route(`${ORIGIN}/main/img/**`, (r) => r.fulfill({ contentType: 'image/gif', body: GIF }));
  await ctx.route(`${ORIGIN}/courses/X/**`, (r) => r.fulfill({ contentType: 'image/gif', body: GIF }));
  const docPage = await ctx.newPage();
  await setSettings({ theme: 'dark' });
  await docPage.goto(`${ORIGIN}/main/document/document.php`, { waitUntil: 'load' });
  await docPage.waitForSelector('.bc-tree');
  const tree = await docPage.evaluate(() => ({
    names: [...document.querySelectorAll('.bc-tree-link')].map((a) => a.textContent),
    current: document.querySelector('.bc-tree-current').textContent,
    href: [...document.querySelectorAll('.bc-tree-link')].find((a) => a.textContent === 'COURS').href,
    nativeVisible: getComputedStyle(document.querySelector('#selector')).display !== 'none',
    nested: !!document.querySelector('.bc-tree-root .bc-tree-list .bc-tree-list .bc-tree-link'),
    corrigesHidden: [...document.querySelectorAll('.bc-tree-link')].find((a) => a.textContent === 'Corrigés').closest('ul').hidden,
  }));
  check(tree.names.join('|') === 'Documents|COURS|SUPPORTS|TD|Corrigés', '[documents] arborescence construite depuis la liste des dossiers', tree.names.join('|'));
  check(tree.current === 'SUPPORTS', '[documents] dossier courant mis en évidence');
  check(/[?&]id=1198429/.test(tree.href) && /cidReq=ESISAR5AMMB501/.test(tree.href), '[documents] liens de l’arborescence conservent le cours et l’identifiant du dossier', tree.href);
  check(!tree.nativeVisible && tree.nested, '[documents] sélecteur natif masqué, dossiers imbriqués');
  check(await docPage.locator('.bc-tree-link:visible', { hasText: 'TD' }).count() === 1 && tree.corrigesHidden, '[documents] sous-dossiers du dossier courant visibles, niveaux plus profonds repliés');
  const tdToggle = docPage.locator('.bc-tree-toggle:not(.bc-tree-gap)').last();
  await tdToggle.click();
  check(await docPage.locator('.bc-tree-link:visible', { hasText: 'Corrigés' }).count() === 1, '[documents] une branche se déplie');
  await tdToggle.click();
  check(await docPage.locator('.bc-tree-link:visible', { hasText: 'Corrigés' }).count() === 0, '[documents] une branche se replie');
  const lightBgs = await docPage.evaluate(() => [...document.querySelectorAll('.actions, .data_table tr, .data_table td, .data_table th')]
    .filter((e) => { const m = getComputedStyle(e).backgroundColor.match(/\d+/g).map(Number); return (m[0] + m[1] + m[2]) / 3 > 140; })
    .map((e) => e.tagName + '.' + e.className));
  check(lightBgs.length === 0, '[documents] plus de fond clair (barre d’outils, lignes, en-tête)', lightBgs.join(','));
  const borders = await docPage.evaluate(() => {
    const light = (c) => { const m = c.match(/\d+/g).map(Number); return (m[0] + m[1] + m[2]) / 3 > 140; };
    const bar = getComputedStyle(document.querySelector('.actions'));
    const tbl = getComputedStyle(document.querySelector('table.data_table'));
    const td = getComputedStyle(document.querySelector('.data_table tbody tr:nth-child(2) td'));
    return { bar: [bar.borderTopColor, bar.borderTopLeftRadius], tbl: [tbl.borderTopColor, tbl.borderTopLeftRadius, tbl.borderCollapse], td: [td.borderTopColor, td.borderLeftWidth],
      light: light(bar.borderTopColor) || light(tbl.borderTopColor) || light(td.borderTopColor) };
  });
  check(!borders.light && parseFloat(borders.bar[1]) > 0 && parseFloat(borders.tbl[1]) > 0 && borders.tbl[2] === 'separate' && borders.td[1] === '0px', '[documents] bordures sobres : même couleur partout, coins arrondis, pas de quadrillage', JSON.stringify(borders));
  const badDocs = await docPage.evaluate(auditContrast);
  check(badDocs.length === 0, '[documents] contraste >= WCAG AA (sombre)', badDocs.slice(0, 6).join(' | '));
  const iconStyle = (id) => docPage.locator(id).evaluate((e) => { const c = getComputedStyle(e); return [c.width, c.backgroundColor, c.webkitMaskImage.slice(0, 20)]; });
  const pdf = await iconStyle('#ic-pdf');
  check(pdf[0] === '20px' && /^url\("data:image\/svg/.test(pdf[2]) && pdf[1] === 'rgb(229, 72, 77)', '[documents] icône PDF remplacée par une icône vectorielle rouge', JSON.stringify(pdf));
  check((await iconStyle('#ic-save'))[2].startsWith('url("data:image/svg'), '[documents] icône de téléchargement vectorielle');
  check((await iconStyle('#ic-content'))[2] === 'none', '[documents] images du contenu des cours laissées intactes');
  await docPage.screenshot({ path: path.join(OUT, 'documents-dark.png') });
  await setSettings({ theme: 'light' });
  await docPage.reload({ waitUntil: 'load' });
  check(await docPage.locator('.bc-bg').count() === 0, '[documents] thème clair : aucun fond réécrit');
  await docPage.close();

  // ---------- Maquette « Mes cours » ----------
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { check(false, 'erreur JS dans la page', e.message); });
  await page.goto(`${ORIGIN}/user_portal.php`, { waitUntil: 'load' });
  await setSettings({ theme: 'dark' });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.bc-hero');

  check(await page.locator('.bc-hero-input').evaluate((e) => document.activeElement === e), 'champ de recherche focus à l’arrivée');
  check(await page.locator('.bc-native-search:visible').count() === 0, 'recherche native masquée (remplacée par la grande barre)');
  check(await page.locator('#content-section select:visible').count() === 0, 'aucun sélecteur natif visible au-dessus des cours');
  const heroBox = await page.locator('.bc-hero').boundingBox();
  check(heroBox.y < 360 && heroBox.width > 900, 'barre de recherche large et en haut de page', JSON.stringify(heroBox));
  check(await page.locator('.bc-card').count() === 4, '4 cours détectés, dont un cours inaccessible sans lien');
  check(await page.locator('.bc-card.bc-closed').count() === 1, 'cours inaccessible repéré malgré l’absence de lien');
  await page.screenshot({ path: path.join(OUT, 'portal-dark.png') });

  const bad = await page.evaluate(auditContrast);
  check(bad.length === 0, '[maquette] contraste >= WCAG AA (sombre)', bad.slice(0, 6).join(' | '));
  check(await page.locator('#bad-inline').evaluate((e) => e.classList.contains('bc-fix')), 'texte inline illisible corrigé');
  check(!(await page.locator('#ok-inline').evaluate((e) => e.classList.contains('bc-fix'))), 'texte inline lisible laissé intact');

  await page.keyboard.press('Escape');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('/');
  check(await page.locator('.bc-hero-input').evaluate((e) => document.activeElement === e), 'raccourci / focalise la recherche');

  await page.keyboard.type('fpga');
  check(await page.locator('.bc-card:visible').count() === 1, 'filtrage en direct : "fpga" -> 1 cours');
  await page.keyboard.press('Control+A'); await page.keyboard.type('beroulle');
  check(await page.locator('.bc-card:visible').count() === 2, 'recherche par enseignant : "beroulle" -> 2 cours');
  await page.keyboard.press('Control+A'); await page.keyboard.type('semiconducteurs');
  check(await page.locator('.bc-card:visible.bc-closed').count() === 1, 'recherche : le cours inaccessible est trouvé');
  await page.keyboard.press('Control+A'); await page.keyboard.type('systemes integres');
  check(await page.locator('.bc-card:visible').count() === 1, 'recherche insensible aux accents');
  await page.screenshot({ path: path.join(OUT, 'portal-search.png') });
  await Promise.all([page.waitForURL('**/courses/EE410/**'), page.keyboard.press('Enter')]);
  check(true, 'Entrée ouvre le cours sélectionné');

  await page.goBack({ waitUntil: 'load' });
  await page.waitForSelector('.bc-hero');
  await page.keyboard.type('zzzz');
  await page.evaluate(() => { window.__noReload = true; });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('.bc-empty').hidden, null, { timeout: 5000 });
  check(/Aucun cours ne correspond/.test(await page.locator('.bc-empty').textContent()), 'aucun résultat ni local ni catalogue : un seul message');
  check(await page.locator('.bc-catalog:visible').count() === 0, 'aucun résultat : pas de panneau catalogue vide');
  check(await page.evaluate(() => window.__noReload === true), 'Entrée sans résultat : la page n’est pas rechargée');

  // cours hors de mes cours : résultats du catalogue via la recherche native
  await page.locator('.bc-hero-input').fill('');
  await page.keyboard.type('IN513');
  await page.waitForSelector('.bc-catalog a', { timeout: 5000 });
  check(await page.locator('.bc-card:visible').count() === 0, 'catalogue : aucun de mes cours ne correspond à IN513');
  check(await page.locator('.bc-empty:visible').count() === 0, 'catalogue : pas de message « aucun cours » quand le catalogue répond');
  check(/0 \/ 4 de vos cours · 1 dans le catalogue/.test(await page.locator('.bc-count').textContent()), 'catalogue : compteur unique local + catalogue');
  const outline = await page.locator('.bc-hero-input').evaluate((el) => { el.focus(); const c = getComputedStyle(el); return [c.outlineStyle, c.borderTopWidth, c.boxShadow]; });
  check(outline[0] === 'none' && outline[1] === '0px' && outline[2] === 'none', 'barre : aucun contour carré au focus', JSON.stringify(outline));
  const openText = await page.locator('.bc-catalog').textContent();
  check(/Accès libre/.test(openText) && !/pas autoris/.test(openText), 'catalogue : cours avec lien d’accès signalé accessible, pas « inscription non autorisée »');
  check(await page.locator('.bc-catalog').evaluate((el) => el.previousElementSibling && el.previousElementSibling.classList.contains('bc-card') || !!el.closest('.bc-card') === false), 'catalogue : résultats placés dans la liste des cours');
  await page.locator('.bc-hero-input').fill('IN511');
  await page.waitForFunction(() => /Inscription fermée/.test(document.querySelector('.bc-catalog')?.textContent || ''), null, { timeout: 5000 });
  check(await page.locator('.bc-catalog a').count() === 0, 'catalogue : cours sans lien d’accès signalé « Inscription fermée »');
  await page.locator('.bc-hero-input').fill('IN513');
  await page.waitForSelector('.bc-catalog a', { timeout: 5000 });
  check(await page.locator('.bc-native-search:visible').count() === 0, 'catalogue : bloc natif toujours masqué');
  check(searchPosts.some((b) => /search_course=1/.test(b) && /sec_token=tok123/.test(b) && /search_term=IN513/.test(b)), 'catalogue : requête identique au formulaire natif (POST, jeton inclus)');
  await page.screenshot({ path: path.join(OUT, 'portal-catalog.png') });
  await Promise.all([page.waitForURL('**/courses/IN513/**'), page.keyboard.press('Enter')]);
  check(true, 'catalogue : Entrée ouvre le premier résultat');
  await page.goBack({ waitUntil: 'load' });
  await page.waitForSelector('.bc-hero');

  // favoris : persistance + tri
  await page.locator('.bc-hero-input').fill(''); await page.locator('.bc-hero-input').dispatchEvent('input');
  await page.locator('.bc-card').nth(2).locator('.bc-star').click();
  const names = await page.locator('.bc-card h4').allTextContents();
  check(names[0].startsWith('ESISAR'), 'favori remonté en tête de liste', names[0]);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.bc-hero');
  check((await page.locator('.bc-card h4').first().textContent()).startsWith('ESISAR'), 'favori conservé après rechargement');
  await page.locator('.bc-chip').click();
  check(await page.locator('.bc-card:visible').count() === 1, 'filtre "Favoris" -> 1 cours');
  await page.screenshot({ path: path.join(OUT, 'portal-fav.png') });

  // thème clair + accent personnalisé
  await setSettings({ theme: 'light', accent: '#e11d48', favorites: ['ESISARPX505:0'] });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.bc-hero');
  check(await page.evaluate(() => document.documentElement.dataset.bcTheme) === 'light', 'thème clair appliqué');
  const badLight = await page.evaluate(auditContrast);
  check(badLight.length === 0, '[maquette] contraste >= WCAG AA (clair, accent rouge)', badLight.slice(0, 6).join(' | '));
  await page.screenshot({ path: path.join(OUT, 'portal-light.png') });

  // ---------- Maquette « accueil du cours » : outils sous forme de cartes ----------
  const courseHome = fs.readFileSync(path.join(__dirname, 'mock-course-home.html'), 'utf8');
  await ctx.route(`${ORIGIN}/courses/ESISAR5AMMB501/index.php*`, (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: courseHome }));
  for (const theme of ['dark', 'light']) {
    await setSettings({ theme });
    await page.goto(`${ORIGIN}/courses/ESISAR5AMMB501/index.php?id_session=0`, { waitUntil: 'load' });
    const cards = await page.evaluate(() => {
      const el = [...document.querySelectorAll('.course-tool')];
      const r = el.map((c) => c.getBoundingClientRect());
      const cs = getComputedStyle(el[0]);
      const icon = getComputedStyle(document.querySelector('img.tool-icon'));
      const link = document.querySelector('#istooldesc_3');
      const lr = getComputedStyle(link, '::after');
      const lb = link.getBoundingClientRect();
      return {
        n: el.length,
        perRow: r.filter((b) => Math.abs(b.top - r[0].top) < 2).length,
        sameHeight: new Set(r.map((b) => Math.round(b.height))).size === 1,
        radius: cs.borderTopLeftRadius, bg: cs.backgroundColor, icon: [icon.width, icon.webkitMaskImage.slice(0, 20)],
        emptyHidden: getComputedStyle(document.querySelector('#course_tools .col-md-12')).display === 'none',
        stretched: lr.position === 'absolute' && lr.content !== 'none',
        top: r[0].top, linkW: lb.width,
      };
    });
    check(cards.n === 5 && cards.perRow >= 3 && cards.sameHeight, `[accueil cours] outils en grille de cartes (${theme})`, JSON.stringify(cards));
    check(parseFloat(cards.radius) >= 12 && cards.emptyHidden && cards.stretched, `[accueil cours] cartes arrondies, colonne vide masquée, carte entière cliquable (${theme})`, JSON.stringify(cards));
    check(cards.icon[0] === '30px' && cards.icon[1].startsWith('url('), `[accueil cours] icône vectorielle agrandie (${theme})`, cards.icon.join(' '));
    const badCards = await page.evaluate(auditContrast);
    check(badCards.length === 0, `[accueil cours] contraste >= WCAG AA (${theme})`, badCards.slice(0, 6).join(' | '));
    await page.screenshot({ path: path.join(OUT, `course-home-${theme}.png`) });
  }
  const hit = await page.evaluate(() => { const b = document.querySelector('.course-tool').getBoundingClientRect(); const e = document.elementFromPoint(b.right - 10, b.bottom - 10); return e && e.id; });
  check(hit === 'istooldesc_3', '[accueil cours] un clic n’importe où sur la carte ouvre l’outil', String(hit));

  // ---------- « Mes cours » : icônes de la colonne latérale, vignette et enseignants ; Agenda ----------
  const agenda = fs.readFileSync(path.join(__dirname, 'mock-agenda.html'), 'utf8');
  await ctx.route(`${ORIGIN}/main/calendar/agenda_js.php*`, (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: agenda }));
  for (const theme of ['dark', 'light']) {
    await setSettings({ theme });
    await page.goto(`${ORIGIN}/user_portal.php`, { waitUntil: 'load' });
    await page.waitForSelector('.bc-hero');
    const portalIcons = await page.evaluate(() => Object.fromEntries(['#ic-inbox', '#ic-compose', '#ic-profile', '#ic-order', '#ic-history', '#ic-teacher', '#ic-board'].map((sel) => {
      const el = document.querySelector(sel); const cs = getComputedStyle(el);
      return [sel, { mask: (cs.webkitMaskImage || '').startsWith('url('), w: cs.width, bg: cs.backgroundColor }];
    })));
    check(Object.values(portalIcons).every((i) => i.mask), `[mes cours] anciennes icônes remplacées par des icônes vectorielles (${theme})`, JSON.stringify(portalIcons));
    check(portalIcons['#ic-board'].w === '48px' && portalIcons['#ic-teacher'].w === '16px', `[mes cours] vignette 48 px, icône enseignant 16 px (${theme})`, JSON.stringify(portalIcons));
    const badPortal = await page.evaluate(auditContrast);
    check(badPortal.length === 0, `[mes cours] contraste >= WCAG AA avec les nouvelles icônes (${theme})`, badPortal.slice(0, 6).join(' | '));
    await page.screenshot({ path: path.join(OUT, `portal-icons-${theme}.png`) });

    await page.goto(`${ORIGIN}/main/calendar/agenda_js.php?type=personal`, { waitUntil: 'load' });
    await page.waitForTimeout(800);
    const ag = await page.evaluate(() => {
      const icons = ['#ic-cal', '#ic-week', '#ic-newev', '#ic-imp'].map((sel) => { const cs = getComputedStyle(document.querySelector(sel)); return [(cs.webkitMaskImage || '').startsWith('url('), cs.width]; });
      const tb = getComputedStyle(document.querySelector('#toolbar-agenda'));
      const btn = getComputedStyle(document.querySelector('.fc-month-button'));
      const cell = getComputedStyle(document.querySelector('.fc-day.fc-widget-content'));
      const today = getComputedStyle(document.querySelector('.fc-day.fc-today'));
      return { icons, tb: tb.borderTopColor, btn: btn.backgroundColor, cell: cell.backgroundColor, today: today.backgroundColor };
    });
    check(ag.icons.every((i) => i[0] && i[1] === '22px'), `[agenda] icônes de la barre d’outils vectorielles (${theme})`, JSON.stringify(ag));
    const badAgenda = await page.evaluate(auditContrast);
    check(badAgenda.length === 0, `[agenda] contraste >= WCAG AA (${theme})`, badAgenda.slice(0, 6).join(' | '));
    if (theme === 'dark') check(!/rgb\(2[0-9]{2}, 2[0-9]{2}, 2[0-9]{2}\)/.test(ag.cell + ag.btn + ag.today), '[agenda] calendrier sans fond clair en thème sombre', JSON.stringify(ag));
    await page.screenshot({ path: path.join(OUT, `agenda-${theme}.png`) });
  }

  // page d'accueil (index.php) : même barre, mode catalogue seul
  const i0 = mock.lastIndexOf('<div class="col-md-9">');
  const i1 = mock.lastIndexOf('</div></section>');
  const home = mock.slice(0, i0) + '<div class="col-md-9"><h1>Outils et tutoriels</h1><p>Bienvenue sur la page d’accueil.</p></div>\n' + mock.slice(i1);
  await ctx.route(`${ORIGIN}/index.php*`, (r) => (r.request().method() === 'POST' ? catalogAnswer(r) : r.fulfill({ contentType: 'text/html; charset=utf-8', body: home })));
  await setSettings({ theme: 'dark' });
  await page.goto(`${ORIGIN}/index.php`, { waitUntil: 'load' });
  await page.waitForSelector('.bc-hero');
  check(await page.locator('.bc-hero-catalog').count() === 1 && await page.locator('.bc-card').count() === 0, 'accueil : barre en mode catalogue, sans cartes');
  check(await page.locator('.bc-native-search:visible').count() === 0, 'accueil : recherche native masquée');
  await page.keyboard.type('IN513');
  await page.waitForSelector('.bc-catalog a', { timeout: 5000 });
  check(true, 'accueil : résultats du catalogue affichés');
  await page.locator('.bc-hero-input').fill('');
  await page.keyboard.type('zzzz');
  await page.waitForFunction(() => !document.querySelector('.bc-empty').hidden, null, { timeout: 6000 });
  check(await page.locator('.bc-catalog:visible').count() === 0, 'accueil : message clair quand le catalogue ne renvoie rien');
  await page.locator('.bc-hero-input').fill('');
  await page.keyboard.type('IN513');
  await page.waitForSelector('.bc-catalog a', { timeout: 5000 });
  await page.screenshot({ path: path.join(OUT, 'home-catalog.png') });
  const badHome = await page.evaluate(auditContrast);
  check(badHome.length === 0, '[accueil] contraste >= WCAG AA', badHome.slice(0, 6).join(' | '));

  // ---------- Passe responsive : pas de défilement horizontal à 390 px, thèmes sombre et clair ----------
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [name, url] of [['portal', '/user_portal.php'], ['documents', '/main/document/document.php'], ['course-home', '/courses/ESISAR5AMMB501/index.php?id_session=0'], ['index', '/index.php']]) {
    for (const theme of ['dark', 'light']) {
      await setSettings({ theme });
      await page.goto(`${ORIGIN}${url}`, { waitUntil: 'load' });
      await page.waitForTimeout(400);
      const over = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      check(over.sw <= over.iw + 1, `[mobile] ${name} sans défilement horizontal (${theme})`, `${over.sw} > ${over.iw}`);
      if (name === 'portal') {
        const ph = await page.evaluate(() => { const i = document.querySelector('.bc-hero-input'); return { fits: i.scrollWidth <= i.clientWidth, ph: i.placeholder }; });
        check(ph.ph.length < 25, `[mobile] placeholder de la barre raccourci (${theme})`, ph.ph);
      }
      const badMobile = await page.evaluate(auditContrast);
      check(badMobile.length === 0, `[mobile] ${name} contraste >= WCAG AA (${theme})`, badMobile.slice(0, 4).join(' | '));
      await page.screenshot({ path: path.join(OUT, `mobile-${name}-${theme}.png`), fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1500, height: 900 });
  await setSettings({ theme: 'light' });
  await page.goto(`${ORIGIN}/main/document/document.php`, { waitUntil: 'load' });
  await page.waitForSelector('.bc-tree');
  const badDocLight = await page.evaluate(auditContrast);
  check(badDocLight.length === 0, '[documents] contraste >= WCAG AA (clair)', badDocLight.slice(0, 4).join(' | '));
  await page.screenshot({ path: path.join(OUT, 'documents-light.png') });

  // thème désactivé : plus aucun attribut
  await setSettings({ theme: 'off' });
  await page.reload({ waitUntil: 'load' });
  check(await page.evaluate(() => document.documentElement.dataset.bcTheme === undefined), 'thème "off" : page d’origine intacte');

  await ctx.close();
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est OK');
  console.log('Captures :', OUT);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
