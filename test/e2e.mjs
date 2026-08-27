/**
 * Prueba de humo en un navegador real, con la API de Internet Archive
 * simulada (así no depende de la red ni del catálogo del día).
 *
 *   npm start                 # en otra terminal
 *   npm i -D playwright && npx playwright install chromium
 *   npm run test:e2e
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:4173';
const CORS = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };

const doc = (id, title, year, language) => ({
  identifier: id,
  title,
  year,
  language,
  description: `<p>Ficha de <b>${title}</b>.</p>`,
  creator: 'Estudio Anónimo',
  downloads: 12345,
  runtime: '1:12:00',
});

const DOCS = [
  doc('peli-uno', 'Nosferatu', '1922', ['German', 'Silent']),
  doc('peli-dos', 'El Chico', '1921', 'Spanish'),
  doc('peli-tres', 'Night of the Living Dead', '1968', 'English'),
  doc('peli-cuatro', 'Metrópolis', '1927', ['German', 'Spanish']),
];

const METADATA = {
  metadata: {
    identifier: 'peli-dos',
    title: 'El Chico',
    year: '1921',
    creator: 'Charles Chaplin',
    language: ['Spanish', 'English'],
    description: 'Un vagabundo cría a un niño abandonado.',
    subject: ['comedia', 'cine mudo'],
    licenseurl: 'https://creativecommons.org/publicdomain/mark/1.0/',
  },
  files: [
    { name: 'kid_spanish.avi', format: 'Cinepack' },
    { name: 'kid_spanish.mp4', format: 'h.264', original: 'kid_spanish.avi', height: '480', size: '700000000', length: '3600' },
    { name: 'kid_spanish_512kb.mp4', format: '512Kb MPEG4', original: 'kid_spanish.mp4', height: '240', size: '200000000' },
    { name: 'kid_english.mp4', format: 'h.264', height: '480', size: '690000000' },
    { name: 'kid.spanish.srt', format: 'SubRip' },
    { name: 'kid.english.srt', format: 'SubRip' },
  ],
};

const SRT = '1\n00:00:01,000 --> 00:00:03,000\nHola\n';

let failures = 0;
const step = (name, ok, extra = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  → ${extra}` : ''}`);
};

const errors = [];
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'es-ES' });

page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
});
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

/* --- API simulada, controlable desde cada prueba --- */
let searchDelay = 0;
let searchStatus = 200;
let searchDocs = DOCS;
let searchTotal = 137;

await page.route('**://archive.org/advancedsearch.php*', async (route) => {
  const q = new URL(route.request().url()).searchParams.get('q') || '';
  if (searchDelay) await new Promise((resolve) => setTimeout(resolve, searchDelay));
  if (searchStatus !== 200) {
    route.fulfill({ status: searchStatus, headers: CORS, body: '{}' });
    return;
  }
  const items = q.includes('zzzznada') ? [] : searchDocs;
  route.fulfill({
    status: 200,
    headers: CORS,
    body: JSON.stringify({ response: { numFound: items.length ? searchTotal : 0, docs: items } }),
  });
});
await page.route('**://archive.org/metadata/**', (route) =>
  route.fulfill({ status: 200, headers: CORS, body: JSON.stringify(METADATA) }),
);
await page.route('**://archive.org/download/**', (route) =>
  route.request().url().endsWith('.srt')
    ? route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/plain' }, body: SRT })
    : route.fulfill({ status: 200, headers: CORS, body: '' }),
);
await page.route('**://archive.org/services/img/**', (route) => route.abort());

/* ------------------------------- Portada ------------------------------- */

await page.goto(BASE, { waitUntil: 'networkidle' });
step(
  'portada renderiza filas curadas',
  (await page.locator('.row').count()) >= 5 && (await page.locator('.card').count()) > 0,
  `${await page.locator('.row').count()} filas`,
);
step('badge sin anuncios', (await page.locator('.badge', { hasText: 'Sin anuncios' }).count()) > 0);
step('título del documento en la portada', (await page.title()).startsWith('Pelis ·'), await page.title());

/* --------------------- Buscador en tiempo real ------------------------- */

await page.fill('#search', 'nosferatu');
await page.waitForSelector('.view__title:has-text("Resultados para")', { timeout: 5000 });
await page.waitForSelector('.grid .card');
step('búsqueda en tiempo real pinta resultados', (await page.locator('.grid .card').count()) === DOCS.length);
step('la URL refleja la búsqueda', page.url().includes('#/buscar?q=nosferatu'), page.url().split('#')[1]);
step('contador de resultados', (await page.locator('.view__count').innerText()).includes('137'));
step('título del documento en la búsqueda', (await page.title()).startsWith('nosferatu ·'), await page.title());

// Los resultados anteriores se mantienen atenuados en vez de desaparecer.
searchDelay = 900;
await page.fill('#search', 'metropolis');
await page.waitForSelector('.view.is-busy', { timeout: 4000 });
step(
  'la búsqueda no vacía la pantalla mientras carga',
  (await page.locator('.view.is-busy .grid .card').count()) > 0 &&
    (await page.locator('.view__count').innerText()).includes('Buscando'),
);
await page.waitForSelector('.view:not(.is-busy) .grid .card', { timeout: 5000 });
searchDelay = 0;

await page.selectOption('#filter-language', 'es');
await page.waitForTimeout(500);
step('filtro de idioma en la URL', page.url().includes('lang=es'), page.url().split('#')[1]);

await page.fill('#search', 'zzzznada');
await page.waitForSelector('.state', { timeout: 5000 });
step('estado vacío', (await page.locator('.state__title').innerText()).includes('No encontramos'));

/* ------------------ Regresión: render obsoleto (bug A) ----------------- */

await page.goto(`${BASE}#/`, { waitUntil: 'networkidle' });
searchDelay = 1200;
await page.fill('#search', 'algo');
await page.waitForTimeout(350); // la búsqueda está en vuelo
await page.evaluate(() => {
  location.hash = '#/peli/peli-dos';
});
await page.waitForTimeout(2200);
searchDelay = 0;
step(
  'regresión: la búsqueda en vuelo no pisa la ficha',
  (await page.locator('.detail__title').count()) === 1 &&
    (await page.locator('.view__title').count()) === 0,
  await page.locator('.detail__title, .view__title').first().innerText(),
);

/* ------------- Regresión: el enlace de salto no navega (bug C) --------- */

await page.evaluate(() => {
  location.hash = '#app';
});
await page.waitForTimeout(500);
step(
  'regresión: #app no cambia de vista',
  (await page.locator('.detail__title').count()) === 1,
  await page.locator('.detail__title, .hero__title').first().innerText(),
);

/* ---------------------------- Ficha ------------------------------------ */

await page.goto(`${BASE}#/peli/peli-dos`, { waitUntil: 'networkidle' });
await page.waitForSelector('.player__video');
const versions = await page.locator('#player-version option').allInnerTexts();
step('selector de versión con doblajes', versions.length === 2, versions.join(' | '));
const qualities = await page.locator('#player-quality option').allInnerTexts();
step('selector de calidad por derivados', qualities.length === 2, qualities.join(' | '));
const subs = await page.locator('#player-subs option').allInnerTexts();
step('selector de subtítulos', subs.length === 3, subs.join(' | '));
step('título del documento en la ficha', (await page.title()).startsWith('El Chico ·'), await page.title());

await page.selectOption('#player-subs', 'kid.spanish.srt');
await page.waitForTimeout(700);
const trackSrc = await page.locator('.player__video track').getAttribute('src').catch(() => null);
step('subtítulo SRT convertido a blob WebVTT', Boolean(trackSrc?.startsWith('blob:')), trackSrc?.slice(0, 24));

// Que el <track> exista no basta: hay que comprobar que el navegador lo parsea
// (esto valida de paso que la política de seguridad deja cargar el blob).
const pista = await page.evaluate(() => {
  const track = document.querySelector('.player__video')?.textTracks?.[0];
  return track ? { mode: track.mode, cues: track.cues?.length ?? 0, lang: track.language } : null;
});
step('el navegador parsea las líneas del subtítulo', pista?.cues > 0, JSON.stringify(pista));

await page.click('.btn--fav');
await page.goto(`${BASE}#/favoritas`, { waitUntil: 'networkidle' });
step('favorita guardada', (await page.locator('.card').count()) === 1);

/* --------------------- Seguir viendo: quitar --------------------------- */

await page.evaluate(() => {
  localStorage.setItem(
    'pelis:progress',
    JSON.stringify({
      'peli-tres': {
        id: 'peli-tres',
        title: 'Night of the Living Dead',
        time: 600,
        duration: 5400,
        updatedAt: Date.now(),
        languages: ['en'],
      },
    }),
  );
});
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('.row:has-text("Seguir viendo")');
step('fila de seguir viendo', (await page.locator('.row:has-text("Seguir viendo") .card').count()) === 1);
await page.locator('.card__remove').first().click();
await page.waitForTimeout(400);
step('se puede quitar de seguir viendo', (await page.locator('.row:has-text("Seguir viendo")').count()) === 0);

/* --------------------------- Idioma de interfaz ------------------------ */

await page.selectOption('#filter-ui', 'en');
await page.waitForTimeout(600);
step('interfaz en inglés', (await page.locator('#search').getAttribute('placeholder')).includes('Search'));
await page.selectOption('#filter-ui', 'es');
await page.waitForTimeout(600);

/* ------------------------- Errores y reintentos ------------------------ */

// Un 5xx transitorio se reintenta solo, sin que el usuario haga nada.
let intentos = 0;
await page.unroute('**://archive.org/advancedsearch.php*');
await page.route('**://archive.org/advancedsearch.php*', (route) => {
  intentos += 1;
  if (intentos === 1) {
    route.fulfill({ status: 503, headers: CORS, body: '{}' });
    return;
  }
  route.fulfill({
    status: 200,
    headers: CORS,
    body: JSON.stringify({ response: { numFound: 4, docs: DOCS } }),
  });
});
await page.goto(`${BASE}#/buscar?q=reintento`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.grid .card', { timeout: 6000 });
step('un 503 transitorio se reintenta solo', intentos >= 2, `${intentos} intentos`);

// Error permanente: aviso con botón de reintento.
await page.unroute('**://archive.org/advancedsearch.php*');
await page.route('**://archive.org/advancedsearch.php*', (route) =>
  route.fulfill({ status: 404, headers: CORS, body: '{}' }),
);
await page.goto(`${BASE}#/buscar?q=roto`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.state--error', { timeout: 6000 });
step('estado de error con reintento', (await page.locator('.state--error .btn').innerText()).includes('Reintentar'));

// Si fallan todas las filas de la portada, un único aviso.
// Hace falta recargar de verdad: navegar por hash conserva la caché en memoria
// y las filas se pintarían con los resultados buenos de antes.
await page.evaluate(() => {
  location.hash = '#/';
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
step(
  'la portada agrupa el fallo en un solo aviso',
  (await page.locator('.state--error').count()) === 1,
  `${await page.locator('.state--error').count()} avisos`,
);

/* ------------- Volver a los resultados desde una ficha ------------------ */

await page.unroute('**://archive.org/advancedsearch.php*');
await page.route('**://archive.org/advancedsearch.php*', (route) => {
  const url = new URL(route.request().url());
  const pagina = Number(url.searchParams.get('page') || 1);
  route.fulfill({
    status: 200,
    headers: CORS,
    body: JSON.stringify({
      response: {
        numFound: 200,
        docs: Array.from({ length: 24 }, (_, i) => doc(`p${pagina}-${i}`, `Peli ${pagina}-${i}`, '1950', 'English')),
      },
    }),
  });
});
await page.goto(`${BASE}#/`, { waitUntil: 'networkidle' });
await page.fill('#search', 'catalogo');
await page.waitForSelector('.grid .card');
await page.locator('.btn--more').click();
await page.waitForFunction(() => document.querySelectorAll('.grid .card').length > 24);
const cargadas = await page.locator('.grid .card').count();
await page.evaluate(() => window.scrollTo(0, 900));
await page.waitForTimeout(200);
await page.locator('.grid .card').nth(30).click();
await page.waitForSelector('.player__video, .state');
await page.goBack();
await page.waitForSelector('.grid .card');
await page.waitForTimeout(500);
const trasVolver = await page.locator('.grid .card').count();
const scroll = await page.evaluate(() => window.scrollY);
step('al volver se conservan las páginas cargadas', trasVolver === cargadas, `${cargadas} → ${trasVolver}`);
step('al volver se recupera la posición', scroll > 500, `scrollY ${scroll}`);

/* ------------------------------ Caché ---------------------------------- */

await page.unroute('**://archive.org/advancedsearch.php*');
let consultas = 0;
await page.route('**://archive.org/advancedsearch.php*', (route) => {
  consultas += 1;
  route.fulfill({
    status: 200,
    headers: CORS,
    body: JSON.stringify({ response: { numFound: 4, docs: DOCS } }),
  });
});
await page.evaluate(() => {
  location.hash = '#/';
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.row .card');
// La ficha lanza su propia consulta de recomendaciones, así que el listón se
// pone justo antes de volver a la portada.
await page.goto(`${BASE}#/peli/peli-dos`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
const antesDeVolver = consultas;
await page.evaluate(() => {
  location.hash = '#/';
});
await page.waitForTimeout(1000);
step(
  'la portada no repite consultas al volver',
  consultas === antesDeVolver,
  `${antesDeVolver} → ${consultas} consultas`,
);

/* ------------------------- Navegación con historial -------------------- */

await page.unroute('**://archive.org/advancedsearch.php*');
await page.route('**://archive.org/advancedsearch.php*', (route) =>
  route.fulfill({
    status: 200,
    headers: CORS,
    body: JSON.stringify({ response: { numFound: 4, docs: DOCS } }),
  }),
);
await page.goto(`${BASE}#/`, { waitUntil: 'networkidle' });
await page.fill('#search', 'kong');
await page.waitForSelector('.grid .card');
await page.goBack();
await page.waitForTimeout(800);
step('atrás vuelve a la portada', (await page.locator('.row').count()) >= 3, page.url().split('#')[1] || '/');

await page.goto(`${BASE}#/peli/peli-dos`, { waitUntil: 'networkidle' });
await page.waitForSelector('.player__video');
await page.screenshot({ path: 'detalle.png' });
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.screenshot({ path: 'portada.png' });

const realErrors = errors.filter(
  (error) => !/Failed to load resource|net::ERR|MEDIA_ELEMENT|Empty src|no supported source|Access-Control/i.test(error),
);
console.log(`\nErrores de consola relevantes: ${realErrors.length}`);
for (const error of realErrors) console.log('  -', error);

await browser.close();

if (failures || realErrors.length) {
  console.error(`\n${failures} comprobaciones fallidas, ${realErrors.length} errores de consola.`);
  process.exit(1);
}
console.log('\nTodo en verde.');
