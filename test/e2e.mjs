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
  identifier: id, title, year, language,
  description: `<p>Ficha de <b>${title}</b>.</p>`,
  creator: 'Estudio Anónimo', downloads: 12345, runtime: '1:12:00',
});

const DOCS = [
  doc('peli-uno', 'Nosferatu', '1922', ['German', 'Silent']),
  doc('peli-dos', 'El Chico', '1921', 'Spanish'),
  doc('peli-tres', 'Night of the Living Dead', '1968', 'English'),
  doc('peli-cuatro', 'Metrópolis', '1927', ['German', 'Spanish']),
];

const METADATA = {
  metadata: {
    identifier: 'peli-dos', title: 'El Chico', year: '1921',
    creator: 'Charles Chaplin', language: ['Spanish', 'English'],
    description: 'Un vagabundo cría a un niño abandonado.',
    subject: ['comedia', 'cine mudo'], licenseurl: 'https://creativecommons.org/publicdomain/mark/1.0/',
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

const errors = [];
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'es-ES' });

page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

await page.route('**://archive.org/advancedsearch.php*', (route) => {
  const url = new URL(route.request().url());
  const q = url.searchParams.get('q') || '';
  const items = q.includes('zzzznada') ? [] : DOCS;
  route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ response: { numFound: items.length ? 137 : 0, docs: items } }) });
});
await page.route('**://archive.org/metadata/**', (route) =>
  route.fulfill({ status: 200, headers: CORS, body: JSON.stringify(METADATA) }));
await page.route('**://archive.org/download/**', (route) => {
  const url = route.request().url();
  if (url.endsWith('.srt')) return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/plain' }, body: SRT });
  return route.fulfill({ status: 200, headers: CORS, body: '' });
});
await page.route('**://archive.org/services/img/**', (route) => route.abort());

let failures = 0;
const step = (name, ok, extra = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  → ${extra}` : ''}`);
};

// 1. Portada
await page.goto(BASE, { waitUntil: 'networkidle' });
const rows = await page.locator('.row').count();
const cards = await page.locator('.card').count();
step('portada renderiza filas curadas', rows >= 5 && cards > 0, `${rows} filas / ${cards} tarjetas`);
step('badge sin anuncios', await page.locator('.badge', { hasText: 'Sin anuncios' }).count() > 0);

// 2. Buscador en tiempo real
await page.fill('#search', 'nosferatu');
await page.waitForSelector('.view__title:has-text("Resultados para")', { timeout: 5000 });
await page.waitForSelector('.grid .card');
step('búsqueda en tiempo real pinta resultados', (await page.locator('.grid .card').count()) === DOCS.length);
step('la URL refleja la búsqueda', page.url().includes('#/buscar?q=nosferatu'), page.url().split('#')[1]);
step('contador de resultados', (await page.locator('.view__count').innerText()).includes('137'));

// 3. Filtro de idioma
await page.selectOption('#filter-language', 'es');
await page.waitForTimeout(400);
step('filtro de idioma en la URL', page.url().includes('lang=es'), page.url().split('#')[1]);

// 4. Sin resultados
await page.fill('#search', 'zzzznada');
await page.waitForSelector('.state', { timeout: 5000 });
step('estado vacío', (await page.locator('.state__title').innerText()).includes('No encontramos'));

// 5. Ficha + reproductor
await page.goto(`${BASE}#/peli/peli-dos`, { waitUntil: 'networkidle' });
await page.waitForSelector('.player__video');
const versions = await page.locator('#player-version option').allInnerTexts();
step('selector de versión con doblajes', versions.length === 2, versions.join(' | '));
const qualities = await page.locator('#player-quality option').allInnerTexts();
step('selector de calidad por derivados', qualities.length === 2, qualities.join(' | '));
const subs = await page.locator('#player-subs option').allInnerTexts();
step('selector de subtítulos', subs.length === 3, subs.join(' | '));

// 6. Subtítulos convertidos a WebVTT (blob)
await page.selectOption('#player-subs', 'kid.spanish.srt');
await page.waitForTimeout(600);
const trackSrc = await page.locator('.player__video track').getAttribute('src').catch(() => null);
step('subtítulo SRT convertido a blob WebVTT', Boolean(trackSrc?.startsWith('blob:')), trackSrc?.slice(0, 24));

// 7. Favoritos persistentes
await page.click('.btn--fav');
await page.goto(`${BASE}#/favoritas`, { waitUntil: 'networkidle' });
step('favorita guardada', (await page.locator('.card').count()) === 1);

// 8. Idioma de interfaz
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.selectOption('#filter-ui', 'en');
await page.waitForTimeout(600);
step('interfaz en inglés', (await page.locator('#search').getAttribute('placeholder')).includes('Search'));
await page.selectOption('#filter-ui', 'es');
await page.waitForTimeout(600);

// 9. Error de red
await page.route('**://archive.org/advancedsearch.php*', (route) => route.fulfill({ status: 503, headers: CORS, body: '{}' }));
await page.fill('#search', 'error');
await page.waitForSelector('.state--error', { timeout: 5000 });
step('estado de error con reintento', (await page.locator('.state--error .btn').innerText()).includes('Reintentar'));

// 10. Navegación atrás
await page.unroute('**://archive.org/advancedsearch.php*');
await page.route('**://archive.org/advancedsearch.php*', (route) =>
  route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ response: { numFound: 4, docs: DOCS } }) }));
await page.goto(`${BASE}#/`, { waitUntil: 'networkidle' });
await page.fill('#search', 'kong');
await page.waitForSelector('.grid .card');
await page.goBack();
await page.waitForTimeout(700);
step('atrás vuelve a la portada', (await page.locator('.row').count()) >= 3, page.url().split('#')[1] || '/');

await page.goto(`${BASE}#/peli/peli-dos`, { waitUntil: 'networkidle' });
await page.waitForSelector('.player__video');
await page.screenshot({ path: 'detalle.png', fullPage: false });
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.screenshot({ path: 'portada.png', fullPage: false });

const realErrors = errors.filter((e) => !/Failed to load resource|net::ERR|MEDIA_ELEMENT|Empty src|no supported source|Access-Control/i.test(e));
console.log(`\nErrores de consola relevantes: ${realErrors.length}`);
for (const error of realErrors) console.log('  -', error);

await browser.close();

if (failures || realErrors.length) {
  console.error(`\n${failures} comprobaciones fallidas, ${realErrors.length} errores de consola.`);
  process.exit(1);
}
console.log('\nTodo en verde.');
