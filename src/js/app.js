/**
 * Arranque, enrutado y vistas.
 *
 * Rutas (hash, sin servidor):
 *   #/                           portada con filas curadas
 *   #/buscar?q=…&lang=…&sort=…   resultados en tiempo real
 *   #/peli/:identificador        ficha + reproductor
 *   #/favoritas                  lista guardada
 */
import { HOME_ROWS, PAGE_SIZE, SEARCH_DEBOUNCE, SORT_OPTIONS } from './config.js';
import { detailsFor, getMovie, search } from './archive.js';
import { pick, setUILanguage, t, uiLanguage, UI_LANGUAGES } from './i18n.js';
import { formatBytes, formatDuration, plainText, toArray, yearOf } from './media.js';
import { createPlayer } from './player.js';
import {
  clearProgress,
  getContinueWatching,
  getFavorites,
  getPrefs,
  getProgress,
  getProgressMap,
  isFavorite,
  setPref,
  toggleFavorite,
} from './store.js';
import {
  carousel,
  clear,
  description,
  el,
  emptyState,
  errorState,
  grid,
  languageLabel,
  languageOptions,
  selectField,
  skeletonGrid,
  skeletonRow,
} from './ui.js';

/** Internet Archive deja de paginar alrededor de los 10 000 resultados. */
const DEEP_PAGING_LIMIT = 10000;

const app = document.getElementById('app');
const header = document.getElementById('header');

const state = {
  term: '',
  language: '',
  sort: 'downloads desc',
  page: 1,
  items: [],
  total: 0,
  loading: false,
  stale: false,
  exhausted: false,
};

let searchController = null;
let detailController = null;
let debounceTimer = null;
let cleanupView = null;
let searchInput = null;
let cameFromNavigation = false;
let searchScroll = 0;

/**
 * Testigo de la vista actual.
 *
 * Todas las vistas cargan datos de forma asíncrona, así que una respuesta puede
 * llegar cuando el usuario ya se fue a otra pantalla. Cada render pide un
 * testigo antes de empezar y comprueba que siga siendo el vigente antes de
 * pintar; si no, se descarta en silencio.
 */
let viewToken = 0;
const beginView = () => ++viewToken;
const isCurrent = (token) => token === viewToken;

/* ------------------------------------------------------------------ */
/* Cabecera                                                            */
/* ------------------------------------------------------------------ */

function renderHeader() {
  clear(header);

  searchInput = el('input', {
    id: 'search',
    class: 'search__input',
    type: 'search',
    placeholder: t('searchPlaceholder'),
    'aria-label': t('searchLabel'),
    autocomplete: 'off',
    spellcheck: 'false',
    value: state.term,
    oninput: (event) => onType(event.currentTarget.value),
  });

  const searchBox = el('div', { class: 'search' }, [
    el('span', { class: 'search__icon', 'aria-hidden': 'true', html: searchIcon() }),
    searchInput,
    el('button', {
      class: 'search__clear',
      type: 'button',
      'aria-label': t('clear'),
      text: '×',
      onclick: () => {
        clearTimeout(debounceTimer);
        state.term = '';
        searchInput.value = '';
        searchInput.focus();
        applyFilters();
      },
    }),
  ]);

  header.append(
    el('div', { class: 'header__inner' }, [
      el('a', { class: 'brand', href: '#/', 'aria-label': t('brand') }, [
        el('span', { class: 'brand__mark', 'aria-hidden': 'true', html: logoIcon() }),
        el('span', { class: 'brand__text' }, [
          el('strong', { text: t('brand') }),
          el('small', { text: t('tagline') }),
        ]),
      ]),
      searchBox,
      el('div', { class: 'header__tools' }, [
        selectField({
          id: 'filter-language',
          label: t('languageOfFilm'),
          value: state.language,
          options: languageOptions(),
          onchange: (value) => {
            state.language = value;
            setPref('language', value);
            applyFilters();
          },
        }),
        selectField({
          id: 'filter-sort',
          label: t('sort'),
          value: state.sort,
          options: SORT_OPTIONS.map((option) => ({
            value: option.value,
            label: pick(option.label),
          })),
          onchange: (value) => {
            state.sort = value;
            setPref('sort', value);
            applyFilters();
          },
        }),
        selectField({
          id: 'filter-ui',
          label: t('uiLanguage'),
          value: uiLanguage(),
          options: UI_LANGUAGES.map((lang) => ({ value: lang.code, label: lang.label })),
          onchange: (value) => {
            setUILanguage(value);
            setPref('ui', value);
            renderHeader();
            route();
          },
        }),
        el('a', { class: 'btn btn--ghost', href: '#/favoritas', text: `★ ${t('favorites')}` }),
      ]),
    ]),
  );
}

function searchIcon() {
  return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
}

function logoIcon() {
  return '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm1 3v2h2V7H5Zm12 0v2h2V7h-2ZM5 11v2h2v-2H5Zm12 0v2h2v-2h-2ZM5 15v2h2v-2H5Zm12 0v2h2v-2h-2ZM9 7v10h6V7H9Z"/></svg>';
}

/** ¿Estamos en una pantalla de resultados? */
function isSearching() {
  return location.hash.startsWith('#/buscar');
}

/** ¿Estamos en la portada? */
function isHome() {
  return !location.hash || location.hash === '#' || location.hash === '#/';
}

/**
 * Reacciona a un cambio de filtros. Si hay una búsqueda en marcha (o los nuevos
 * filtros la hacen posible) se relanza; en la portada se repinta, porque el
 * orden también afecta a sus filas; y en la ficha o en favoritas el ajuste sólo
 * se guarda, que sacar al usuario de donde está sería peor.
 */
function applyFilters() {
  if (isSearching() || state.term || state.language) {
    runSearch({ reset: true, push: false });
    return;
  }
  if (isHome()) renderHome(beginView());
}

/* ------------------------------------------------------------------ */
/* Buscador en tiempo real                                             */
/* ------------------------------------------------------------------ */

function onType(value) {
  state.term = value;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    // La primera pulsación crea una entrada de historial; el resto la sustituye,
    // para que "atrás" vuelva a la portada y no letra por letra.
    const push = !isSearching();
    runSearch({ reset: true, push });
  }, SEARCH_DEBOUNCE);
}

function searchHash() {
  const params = new URLSearchParams();
  if (state.term) params.set('q', state.term);
  if (state.language) params.set('lang', state.language);
  if (state.sort) params.set('sort', state.sort);
  return `#/buscar${params.toString() ? `?${params}` : ''}`;
}

/**
 * Ejecuta la búsqueda con el estado actual y pinta los resultados.
 * Sin `reset` carga la página siguiente y la añade a la lista.
 */
async function runSearch({ reset = false, push = false } = {}) {
  if (reset && !state.term && !state.language) {
    navigate('#/');
    return;
  }

  const hash = searchHash();
  if (push) history.pushState({}, '', hash);
  else history.replaceState({}, '', hash);

  // La página sólo avanza si la petición sale bien: así un error de red no deja
  // un hueco de 24 películas al reintentar.
  const page = reset ? 1 : state.page + 1;
  const token = beginView();

  searchController?.abort();
  searchController = new AbortController();
  state.loading = true;
  if (reset) state.stale = true;
  renderSearchView();

  try {
    const result = await search({
      term: state.term,
      language: state.language,
      sort: state.sort,
      page,
      rows: PAGE_SIZE,
      signal: searchController.signal,
    });
    if (!isCurrent(token)) return;

    state.page = page;
    state.items = reset ? result.items : [...state.items, ...result.items];
    state.total = result.total;
    state.stale = false;
    state.loading = false;
    // Internet Archive no deja paginar sin fin: pasada esa profundidad, el
    // buscador devuelve error en vez de resultados.
    state.exhausted =
      result.items.length < PAGE_SIZE ||
      state.items.length >= result.total ||
      page * PAGE_SIZE >= DEEP_PAGING_LIMIT;
    renderSearchView();
  } catch (error) {
    if (error.name === 'AbortError' || !isCurrent(token)) return;
    state.loading = false;
    if (reset) {
      state.items = [];
      state.stale = false;
      mount(errorState(error.message, () => runSearch({ reset: true })), { keepScroll: true });
    } else {
      // En "cargar más" no tiramos lo que ya se veía: sólo avisamos.
      renderSearchView({ loadMoreError: error.message });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Vistas                                                              */
/* ------------------------------------------------------------------ */

function mount(node, { keepScroll = false, focus = false } = {}) {
  cleanupView?.();
  cleanupView = null;
  clear(app).append(node);
  if (!keepScroll) window.scrollTo({ top: 0 });
  // Tras una navegación real movemos el foco al contenido, para que quien use
  // lector de pantalla o teclado no se quede en la cabecera.
  if (focus) app.focus({ preventScroll: true });
}

function setTitle(text) {
  document.title = text ? `${text} · ${t('brand')}` : t('documentTitle');
}

function renderSearchView({ loadMoreError = '' } = {}) {
  const heading = state.term
    ? `${t('resultsFor')} “${state.term}”`
    : `${t('results')} · ${languageLabel(state.language)}`;
  setTitle(state.term || languageLabel(state.language));

  const busy = state.loading && state.stale;
  const view = el('section', { class: `view${busy ? ' is-busy' : ''}` }, [
    el('div', { class: 'view__head' }, [
      el('h1', { class: 'view__title', text: heading }),
      el('p', {
        class: 'view__count',
        'aria-live': 'polite',
        text: busy ? t('searching') : t('resultCount', state.total),
      }),
    ]),
  ]);

  // Mientras llega la nueva búsqueda se mantienen los resultados anteriores
  // atenuados: es menos brusco que vaciar la pantalla en cada pulsación.
  if (!state.items.length) {
    view.append(busy ? skeletonGrid() : emptyState(t('empty'), t('emptyHint')));
    mount(view, { keepScroll: true });
    return;
  }

  view.append(grid(state.items, { progressMap: getProgressMap() }));

  if (loadMoreError) {
    view.append(
      el('div', { class: 'view__more' }, [
        el('p', { class: 'state__hint', text: loadMoreError }),
        el('button', { class: 'btn', type: 'button', text: t('retry'), onclick: () => runSearch() }),
      ]),
    );
    mount(view, { keepScroll: true });
    return;
  }

  const more =
    state.exhausted || busy
      ? null
      : el('button', {
          class: 'btn btn--more',
          type: 'button',
          text: state.loading ? t('loading') : t('loadMore'),
          disabled: state.loading,
          onclick: () => runSearch(),
        });
  if (more) view.append(el('div', { class: 'view__more' }, [more]));

  mount(view, { keepScroll: true });

  // Scroll infinito. El botón sigue existiendo para quien navegue con teclado.
  if (more && !state.loading) {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && !state.loading && !state.exhausted) {
          runSearch();
        }
      },
      { rootMargin: '600px' },
    );
    observer.observe(more);
    cleanupView = () => observer.disconnect();
  }
}

async function renderHome(token) {
  setTitle('');

  const view = el('section', { class: 'view' }, [
    el('div', { class: 'hero' }, [
      el('h1', { class: 'hero__title', text: t('tagline') }),
      el('p', { class: 'hero__text', text: t('footer') }),
      el('div', { class: 'badges' }, [
        el('span', { class: 'badge', text: `✔ ${t('noAds')}` }),
        el('span', { class: 'badge', text: `⚖ ${t('publicDomain')}` }),
        el('span', { class: 'badge', text: `🌍 ${t('languageOfFilm')}` }),
      ]),
    ]),
  ]);

  const progressMap = getProgressMap();
  const continueList = getContinueWatching().slice(0, 12);
  if (continueList.length) {
    view.append(
      carousel({
        title: t('continueWatching'),
        items: continueList,
        progressMap,
        onRemove: (item) => {
          clearProgress(item.id);
          renderHome(beginView());
        },
      }),
    );
  }

  const favorites = getFavorites().slice(0, 12);
  if (favorites.length) {
    view.append(
      carousel({
        title: t('favorites'),
        items: favorites,
        progressMap,
        action: el('a', { class: 'row__link', href: '#/favoritas', text: '→' }),
      }),
    );
  }

  const slots = HOME_ROWS.map((row) => {
    const section = el('section', { class: 'row' }, [
      el('div', { class: 'row__head' }, [el('h2', { class: 'row__title', text: pick(row.title) })]),
      skeletonRow(),
    ]);
    view.append(section);
    return { row, section };
  });

  mount(view, { focus: cameFromNavigation });

  const controller = new AbortController();
  cleanupView = () => controller.abort();

  // Las filas se cargan en paralelo y cada una se pinta en cuanto llega.
  let failures = 0;
  let lastError = '';
  await Promise.allSettled(
    slots.map(async ({ row, section }) => {
      try {
        const result = await search({
          query: row.query,
          sort: state.sort || row.sort,
          rows: 18,
          signal: controller.signal,
        });
        if (!isCurrent(token)) return;
        if (!result.items.length) {
          section.remove();
          return;
        }
        section.replaceWith(carousel({ title: pick(row.title), items: result.items, progressMap }));
      } catch (error) {
        if (error.name === 'AbortError' || !isCurrent(token)) return;
        failures += 1;
        lastError = error.message;
        section.remove();
      }
    }),
  );

  // Si falla todo, un único aviso con reintento en vez de siete cajas de error.
  if (isCurrent(token) && failures === slots.length && slots.length) {
    view.append(errorState(lastError, () => renderHome(beginView())));
  }
}

function renderFavorites() {
  const favorites = getFavorites();
  setTitle(t('favorites'));

  const view = el('section', { class: 'view' }, [
    el('div', { class: 'view__head' }, [el('h1', { class: 'view__title', text: t('favorites') })]),
  ]);
  view.append(
    favorites.length
      ? grid(favorites, { progressMap: getProgressMap() })
      : emptyState(t('noFavorites'), t('emptyHint')),
  );
  mount(view, { focus: cameFromNavigation });
}

function detailSkeleton() {
  return el('section', { class: 'view view--detail' }, [
    el('div', { class: 'detail' }, [
      el('div', { class: 'skeleton-line skeleton-line--title' }),
      el('div', { class: 'skeleton-line skeleton-line--sub' }),
      el('div', { class: 'skeleton-stage' }),
    ]),
  ]);
}

async function renderDetail(identifier, token) {
  mount(detailSkeleton());

  detailController?.abort();
  detailController = new AbortController();
  const controller = detailController;

  let movie;
  try {
    movie = await getMovie(identifier, { signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError' || !isCurrent(token)) return;
    mount(errorState(error.message, () => renderDetail(identifier, beginView())));
    return;
  }
  if (!isCurrent(token)) return;

  setTitle(movie.title);

  const year = yearOf(movie);
  const progress = getProgress(identifier);
  const player = movie.versions.length
    ? createPlayer(movie, {
        startAt: progress?.time ?? 0,
        startVersionId: progress?.versionId ?? null,
      })
    : null;

  const languages = movie.languages;
  const best = movie.versions[0]?.sources[0] ?? null;

  const favoriteButton = el('button', {
    class: `btn btn--fav${isFavorite(identifier) ? ' is-active' : ''}`,
    type: 'button',
    text: isFavorite(identifier) ? `★ ${t('removeFavorite')}` : `☆ ${t('addFavorite')}`,
    onclick: (event) => {
      const added = toggleFavorite(movie);
      const button = event.currentTarget;
      button.classList.toggle('is-active', added);
      button.setAttribute('aria-pressed', String(added));
      button.textContent = added ? `★ ${t('removeFavorite')}` : `☆ ${t('addFavorite')}`;
    },
    'aria-pressed': String(isFavorite(identifier)),
  });

  const facts = [
    [
      t('languageOfFilm'),
      languages.length ? languages.map(languageLabel).join(', ') : t('unknownLanguage'),
    ],
    [t('year'), year],
    [t('director'), movie.creator],
    [t('duration'), formatDuration(movie.versions[0]?.duration)],
    [t('quality'), best ? [best.label, formatBytes(best.size)].filter(Boolean).join(' · ') : ''],
    [
      t('subtitles'),
      movie.subtitles.length
        ? [...new Set(movie.subtitles.map((track) => languageLabel(track.language)))].join(', ')
        : t('subtitlesOff'),
    ],
    [
      t('collections'),
      toArray(movie.collections)
        .slice(0, 4)
        .map((name) => String(name).replace(/_/g, ' '))
        .join(', '),
    ],
  ].filter(([, value]) => value);

  const view = el('section', { class: 'view view--detail' }, [
    el('a', { class: 'back', href: '#/', text: `← ${t('back')}` }),
    el('div', { class: 'detail' }, [
      el('header', { class: 'detail__head' }, [
        el('h1', { class: 'detail__title', text: movie.title }),
        el('p', { class: 'detail__sub', text: [year, movie.creator].filter(Boolean).join(' · ') }),
        el('div', { class: 'badges' }, [
          el('span', { class: 'badge', text: `✔ ${t('noAds')}` }),
          el('span', { class: 'badge', text: `⚖ ${t('publicDomain')}` }),
          ...languages.map((code) => el('span', { class: 'badge', text: languageLabel(code) })),
        ]),
      ]),
      player ? player.element : emptyState(t('noVideo')),
      el('div', { class: 'detail__actions' }, [
        favoriteButton,
        best &&
          el('a', {
            class: 'btn btn--ghost',
            href: best.url,
            download: '',
            rel: 'noopener',
            text: `↓ ${t('download')}`,
          }),
        el('a', {
          class: 'btn btn--ghost',
          href: detailsFor(identifier),
          target: '_blank',
          rel: 'noopener noreferrer',
          text: t('source'),
        }),
      ]),
      description(movie.description),
      el(
        'dl',
        { class: 'facts' },
        facts.flatMap(([label, value]) => [
          el('dt', { text: label }),
          el('dd', { text: String(value) }),
        ]),
      ),
    ]),
  ]);

  mount(view, { focus: cameFromNavigation });
  cleanupView = () => {
    player?.destroy();
    controller.abort();
  };

  loadRelated(movie, view, token, controller.signal);
}

/** Fila "relacionadas" a partir del tema o la autoría de la película. */
async function loadRelated(movie, view, token, signal) {
  const seed = plainText(toArray(movie.subjects)[0] ?? movie.creator ?? '', 60);
  if (!seed) return;
  try {
    const result = await search({ term: seed, rows: 12, sort: 'downloads desc', signal });
    if (!isCurrent(token) || !view.isConnected) return;
    const items = result.items.filter((item) => item.id !== movie.id).slice(0, 10);
    if (!items.length) return;
    view.append(
      carousel({ title: `${t('results')}: ${seed}`, items, progressMap: getProgressMap() }),
    );
  } catch {
    // Una fila de recomendaciones que falle no debe estropear la ficha.
  }
}

/* ------------------------------------------------------------------ */
/* Enrutado                                                            */
/* ------------------------------------------------------------------ */

function navigate(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

/** Mantiene los controles de la cabecera en sintonía con el estado. */
function syncControls() {
  if (searchInput) searchInput.value = state.term;
  const language = document.getElementById('filter-language');
  if (language) language.value = state.language;
  const sort = document.getElementById('filter-sort');
  if (sort) sort.value = state.sort;
}

function route() {
  const raw = location.hash.replace(/^#/, '');

  // Anclas ajenas al router (por ejemplo el enlace "Ir al contenido", que apunta
  // a #app) no deben provocar una navegación.
  if (raw && !raw.startsWith('/')) return;

  const [path, queryString = ''] = (raw || '/').split('?');
  const params = new URLSearchParams(queryString);
  const token = beginView();

  if (path.startsWith('/peli/')) {
    const identifier = decodeURIComponent(path.slice('/peli/'.length));
    if (identifier) {
      renderDetail(identifier, token);
      return;
    }
  }

  if (path.startsWith('/favoritas')) {
    renderFavorites();
    return;
  }

  if (path.startsWith('/buscar')) {
    const term = params.get('q') ?? '';
    const language = params.get('lang') ?? state.language;
    const sort = params.get('sort') ?? state.sort;

    // Volver de una ficha a los mismos resultados no debe reiniciar la
    // búsqueda: se recupera la lista tal como estaba, con todas las páginas
    // que se habían cargado, y el scroll donde se dejó.
    const sameQuery = term === state.term && language === state.language && sort === state.sort;
    if (sameQuery && state.items.length && !state.loading) {
      syncControls();
      renderSearchView();
      window.scrollTo({ top: searchScroll });
      return;
    }

    state.term = term;
    state.language = language;
    state.sort = sort;
    syncControls();
    state.items = [];
    runSearch({ reset: true });
    return;
  }

  state.term = '';
  syncControls();
  renderHome(token);
}

/* ------------------------------------------------------------------ */
/* Arranque                                                            */
/* ------------------------------------------------------------------ */

function boot() {
  const prefs = getPrefs();
  const browser = (navigator.language || 'es').slice(0, 2);
  setUILanguage(prefs.ui || (UI_LANGUAGES.some((lang) => lang.code === browser) ? browser : 'es'));
  state.language = prefs.language ?? '';
  state.sort = prefs.sort ?? 'downloads desc';

  renderHeader();
  route();

  window.addEventListener('hashchange', () => {
    cameFromNavigation = true;
    route();
    cameFromNavigation = false;
  });

  // Se recuerda la posición dentro de los resultados para restaurarla al volver.
  window.addEventListener(
    'scroll',
    () => {
      if (isSearching()) searchScroll = window.scrollY;
    },
    { passive: true },
  );

  // "/" enfoca el buscador, como en cualquier catálogo decente.
  document.addEventListener('keydown', (event) => {
    if (event.key !== '/' || event.metaKey || event.ctrlKey) return;
    const target = event.target;
    if (target instanceof HTMLElement && /input|select|textarea/i.test(target.tagName)) return;
    event.preventDefault();
    searchInput?.focus();
    searchInput?.select();
  });
}

boot();
