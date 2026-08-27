/**
 * Arranque, enrutado y vistas.
 *
 * Rutas (hash, sin servidor):
 *   #/                       portada con filas curadas
 *   #/buscar?q=…&lang=…&sort=…   resultados en tiempo real
 *   #/peli/:identificador    ficha + reproductor
 *   #/favoritas              lista guardada
 */
import { HOME_ROWS, PAGE_SIZE, SEARCH_DEBOUNCE, SORT_OPTIONS } from './config.js';
import { detailsFor, getMovie, search } from './archive.js';
import { pick, setUILanguage, t, uiLanguage, UI_LANGUAGES } from './i18n.js';
import { formatBytes, plainText, toArray, yearOf } from './media.js';
import { createPlayer } from './player.js';
import {
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
  exhausted: false,
};

let searchController = null;
let detailController = null;
let debounceTimer = null;
let cleanupView = null;
let searchInput = null;

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
        state.term = '';
        searchInput.value = '';
        searchInput.focus();
        navigate('#/');
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
            runSearch({ reset: true, push: false });
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
            runSearch({ reset: true, push: false });
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

/* ------------------------------------------------------------------ */
/* Buscador en tiempo real                                             */
/* ------------------------------------------------------------------ */

function onType(value) {
  state.term = value;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    // La primera pulsación crea una entrada de historial; el resto la sustituye,
    // para que "atrás" vuelva a la portada y no letra por letra.
    const push = !location.hash.startsWith('#/buscar');
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

/** Ejecuta la búsqueda con el estado actual y pinta los resultados. */
async function runSearch({ reset = false, push = false, render = true } = {}) {
  if (!state.term && !state.language && reset) {
    navigate('#/');
    return;
  }

  const hash = searchHash();
  if (push) history.pushState({}, '', hash);
  else history.replaceState({}, '', hash);

  if (reset) {
    state.page = 1;
    state.items = [];
    state.exhausted = false;
  }

  searchController?.abort();
  searchController = new AbortController();
  state.loading = true;

  if (render && reset) renderSearchView({ loading: true });

  try {
    const result = await search({
      term: state.term,
      language: state.language,
      sort: state.sort,
      page: state.page,
      rows: PAGE_SIZE,
      signal: searchController.signal,
    });
    state.items = reset ? result.items : [...state.items, ...result.items];
    state.total = result.total;
    state.exhausted = result.items.length < PAGE_SIZE || state.items.length >= result.total;
    state.loading = false;
    if (render) renderSearchView();
  } catch (error) {
    if (error.name === 'AbortError') return;
    state.loading = false;
    if (render) {
      mount(errorState(error.message, () => runSearch({ reset: true })), { keepScroll: true });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Vistas                                                              */
/* ------------------------------------------------------------------ */

function mount(node, { keepScroll = false } = {}) {
  cleanupView?.();
  cleanupView = null;
  clear(app).append(node);
  if (!keepScroll) window.scrollTo({ top: 0 });
}

function renderSearchView({ loading = false } = {}) {
  const heading = state.term
    ? `${t('resultsFor')} “${state.term}”`
    : `${t('results')} · ${languageLabel(state.language)}`;

  const view = el('section', { class: 'view' }, [
    el('div', { class: 'view__head' }, [
      el('h1', { class: 'view__title', text: heading }),
      !loading && el('p', { class: 'view__count', text: t('resultCount', state.total) }),
    ]),
  ]);

  if (loading) {
    view.append(skeletonGrid());
    mount(view, { keepScroll: true });
    return;
  }

  if (!state.items.length) {
    view.append(emptyState(t('empty'), t('emptyHint')));
    mount(view, { keepScroll: true });
    return;
  }

  view.append(grid(state.items, { progressMap: getProgressMap() }));

  const more = state.exhausted
    ? null
    : el('button', {
        class: 'btn btn--more',
        type: 'button',
        text: t('loadMore'),
        onclick: () => {
          state.page += 1;
          runSearch();
        },
      });
  if (more) view.append(el('div', { class: 'view__more' }, [more]));

  mount(view, { keepScroll: true });

  // Scroll infinito. El botón sigue existiendo para quien navegue con teclado.
  if (more) {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && !state.loading && !state.exhausted) {
          state.page += 1;
          runSearch();
        }
      },
      { rootMargin: '600px' },
    );
    observer.observe(more);
    cleanupView = () => observer.disconnect();
  }
}

async function renderHome() {
  const view = el('section', { class: 'view' }, [
    el('div', { class: 'hero' }, [
      el('h1', { class: 'hero__title', text: t('tagline') }),
      el('p', { class: 'hero__text', text: t('footer') }),
      el('div', { class: 'badges' }, [
        el('span', { class: 'badge', text: `✔ ${t('noAds')}` }),
        el('span', { class: 'badge', text: `⚖ ${t('publicDomain')}` }),
        el('span', { class: 'badge', text: '🌍 ' + t('languageOfFilm') }),
      ]),
    ]),
  ]);

  const progressMap = getProgressMap();
  const continueList = getContinueWatching().slice(0, 12);
  if (continueList.length) {
    view.append(carousel({ title: t('continueWatching'), items: continueList, progressMap }));
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

  mount(view);

  // Las filas se cargan en paralelo y cada una se pinta en cuanto llega.
  const controller = new AbortController();
  cleanupView = () => controller.abort();

  await Promise.allSettled(
    slots.map(async ({ row, section }) => {
      try {
        const result = await search({
          query: row.query,
          sort: row.sort,
          rows: 18,
          signal: controller.signal,
        });
        if (!result.items.length) {
          section.remove();
          return;
        }
        section.replaceWith(
          carousel({ title: pick(row.title), items: result.items, progressMap }),
        );
      } catch (error) {
        if (error.name === 'AbortError') return;
        section.replaceWith(errorState(error.message, () => route()));
      }
    }),
  );
}

function renderFavorites() {
  const favorites = getFavorites();
  const view = el('section', { class: 'view' }, [
    el('div', { class: 'view__head' }, [el('h1', { class: 'view__title', text: t('favorites') })]),
  ]);
  view.append(
    favorites.length
      ? grid(favorites, { progressMap: getProgressMap() })
      : emptyState(t('noFavorites'), t('emptyHint')),
  );
  mount(view);
}

async function renderDetail(identifier) {
  mount(el('section', { class: 'view' }, [skeletonGrid(4)]));

  detailController?.abort();
  detailController = new AbortController();

  let movie;
  try {
    movie = await getMovie(identifier, { signal: detailController.signal });
  } catch (error) {
    if (error.name === 'AbortError') return;
    mount(errorState(error.message, () => renderDetail(identifier)));
    return;
  }

  const year = yearOf(movie);
  const progress = getProgress(identifier);
  const player = movie.versions.length
    ? createPlayer(movie, {
        startAt: progress?.time ?? 0,
        startVersionId: progress?.versionId ?? null,
      })
    : null;

  const languages = movie.languages.length ? movie.languages : [];
  const best = movie.versions[0]?.sources[0] ?? null;

  const favoriteButton = el('button', {
    class: `btn btn--fav${isFavorite(identifier) ? ' is-active' : ''}`,
    type: 'button',
    text: isFavorite(identifier) ? `★ ${t('removeFavorite')}` : `☆ ${t('addFavorite')}`,
    onclick: (event) => {
      const added = toggleFavorite(movie);
      const button = event.currentTarget;
      button.classList.toggle('is-active', added);
      button.textContent = added ? `★ ${t('removeFavorite')}` : `☆ ${t('addFavorite')}`;
    },
  });

  const facts = [
    [t('languageOfFilm'), languages.length ? languages.map(languageLabel).join(', ') : t('unknownLanguage')],
    ['Año', year],
    ['Dirección / autoría', movie.creator],
    [t('quality'), best ? [best.label, formatBytes(best.size)].filter(Boolean).join(' · ') : ''],
    [
      t('subtitles'),
      movie.subtitles.length
        ? movie.subtitles.map((track) => languageLabel(track.language)).join(', ')
        : t('subtitlesOff'),
    ],
  ].filter(([, value]) => value);

  const view = el('section', { class: 'view view--detail' }, [
    el('a', { class: 'back', href: '#/', text: `← ${t('back')}` }),
    el('div', { class: 'detail' }, [
      el('header', { class: 'detail__head' }, [
        el('h1', { class: 'detail__title', text: movie.title }),
        el('p', { class: 'detail__sub' }, [
          [year, movie.creator].filter(Boolean).join(' · '),
        ]),
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

  mount(view);
  cleanupView = () => {
    player?.destroy();
    detailController?.abort();
  };

  loadRelated(movie, view);
}

/** Fila "relacionadas" a partir del tema o la autoría de la película. */
async function loadRelated(movie, view) {
  const seed = plainText(toArray(movie.subjects)[0] ?? movie.creator ?? '', 60);
  if (!seed) return;
  try {
    const result = await search({ term: seed, rows: 12, sort: 'downloads desc' });
    const items = result.items.filter((item) => item.id !== movie.id).slice(0, 10);
    if (!items.length) return;
    view.append(
      carousel({
        title: `${t('results')}: ${seed}`,
        items,
        progressMap: getProgressMap(),
      }),
    );
  } catch {
    // Una fila de recomendaciones que falla no debe romper la ficha.
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
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, queryString = ''] = raw.split('?');
  const params = new URLSearchParams(queryString);

  if (path.startsWith('/peli/')) {
    renderDetail(decodeURIComponent(path.slice('/peli/'.length)));
    return;
  }

  if (path.startsWith('/favoritas')) {
    renderFavorites();
    return;
  }

  if (path.startsWith('/buscar')) {
    state.term = params.get('q') ?? '';
    state.language = params.get('lang') ?? state.language;
    state.sort = params.get('sort') ?? state.sort;
    syncControls();
    runSearch({ reset: true });
    return;
  }

  state.term = '';
  syncControls();
  renderHome();
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
  window.addEventListener('hashchange', route);

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
