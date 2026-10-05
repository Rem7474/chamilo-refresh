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
  await ctx.route(`${ORIGIN}/user_portal.php*`, (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: mock }));
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
  check(await page.locator('.bc-empty').isVisible(), 'message "aucun résultat"');

  // cours hors de mes cours : résultats du catalogue via la recherche native
  await page.locator('.bc-hero-input').fill('');
  await page.keyboard.type('IN513');
  await page.waitForSelector('.bc-catalog a', { timeout: 5000 });
  check(await page.locator('.bc-card:visible').count() === 0, 'catalogue : aucun de mes cours ne correspond à IN513');
  check((await page.locator('.bc-catalog').textContent()).includes('inscription'), 'catalogue : cours non inscrit affiché sous la barre');
  check(await page.locator('.bc-native-search:visible').count() === 0, 'catalogue : bloc natif toujours masqué');
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

  // page d'accueil (index.php) : même barre, mode catalogue seul
  const i0 = mock.lastIndexOf('<div class="col-md-9">');
  const i1 = mock.lastIndexOf('</div></section>');
  const home = mock.slice(0, i0) + '<div class="col-md-9"><h1>Outils et tutoriels</h1><p>Bienvenue sur la page d’accueil.</p></div>\n' + mock.slice(i1);
  await ctx.route(`${ORIGIN}/index.php*`, (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: home }));
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
  await page.waitForFunction(() => /Aucun résultat dans le catalogue/.test(document.querySelector('.bc-status').textContent), null, { timeout: 6000 });
  check(await page.locator('.bc-catalog:visible').count() === 0, 'accueil : message clair quand le catalogue ne renvoie rien');
  await page.locator('.bc-hero-input').fill('');
  await page.keyboard.type('IN513');
  await page.waitForSelector('.bc-catalog a', { timeout: 5000 });
  await page.screenshot({ path: path.join(OUT, 'home-catalog.png') });
  const badHome = await page.evaluate(auditContrast);
  check(badHome.length === 0, '[accueil] contraste >= WCAG AA', badHome.slice(0, 6).join(' | '));

  // thème désactivé : plus aucun attribut
  await setSettings({ theme: 'off' });
  await page.reload({ waitUntil: 'load' });
  check(await page.evaluate(() => document.documentElement.dataset.bcTheme === undefined), 'thème "off" : page d’origine intacte');

  await ctx.close();
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est OK');
  console.log('Captures :', OUT);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
