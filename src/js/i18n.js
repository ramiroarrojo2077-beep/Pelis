/** Textos de la interfaz. El idioma se elige en la cabecera y se recuerda. */

export const UI_LANGUAGES = [
  { code: 'es', label: 'Español' },
  { code: 'en', label: 'English' },
];

const STRINGS = {
  es: {
    brand: 'Pelis',
    tagline: 'Cine de dominio público, sin anuncios',
    searchPlaceholder: 'Buscar películas, directores, temas…',
    searchLabel: 'Buscar películas',
    clear: 'Limpiar',
    allLanguages: 'Todos los idiomas',
    language: 'Idioma',
    sort: 'Orden',
    uiLanguage: 'Idioma de la interfaz',
    home: 'Inicio',
    favorites: 'Mis favoritas',
    continueWatching: 'Seguir viendo',
    noFavorites: 'Todavía no guardaste ninguna película.',
    results: 'Resultados',
    resultsFor: 'Resultados para',
    resultCount: (n) => `${n.toLocaleString('es')} películas`,
    loading: 'Cargando…',
    loadMore: 'Cargar más',
    empty: 'No encontramos nada con esa búsqueda.',
    emptyHint: 'Probá con otro título, un director o quitá el filtro de idioma.',
    error: 'No pudimos conectar con la biblioteca.',
    retry: 'Reintentar',
    back: 'Volver',
    resume: 'Seguir desde',
    version: 'Versión / idioma',
    quality: 'Calidad',
    subtitles: 'Subtítulos',
    subtitlesOff: 'Desactivados',
    speed: 'Velocidad',
    addFavorite: 'Guardar',
    removeFavorite: 'Guardada',
    download: 'Descargar',
    source: 'Ficha en Internet Archive',
    noVideo: 'Esta ficha no tiene ningún vídeo reproducible en el navegador.',
    noAds: 'Sin anuncios',
    publicDomain: 'Dominio público',
    unknownLanguage: 'Idioma sin identificar',
    original: 'Versión original',
    subtitleError: 'No se pudieron cargar los subtítulos.',
    shortcuts: 'Atajos: espacio play/pausa · ←/→ 10 s · F pantalla completa · M silencio · C subtítulos',
    footer: 'Contenido de Internet Archive. Sin rastreadores, sin cookies de terceros, sin publicidad.',
    languageOfFilm: 'Idioma de la película',
    year: 'Año',
    duration: 'Duración',
    director: 'Dirección / autoría',
    collections: 'Colecciones',
    removeFromList: 'Quitar de seguir viendo',
    searching: 'Buscando…',
    loadMoreError: 'No pudimos cargar más resultados.',
    documentTitle: 'Pelis · Cine de dominio público sin anuncios',
  },
  en: {
    brand: 'Pelis',
    tagline: 'Public domain cinema, ad-free',
    searchPlaceholder: 'Search films, directors, topics…',
    searchLabel: 'Search films',
    clear: 'Clear',
    allLanguages: 'All languages',
    language: 'Language',
    sort: 'Sort',
    uiLanguage: 'Interface language',
    home: 'Home',
    favorites: 'My list',
    continueWatching: 'Keep watching',
    noFavorites: 'You have not saved any film yet.',
    results: 'Results',
    resultsFor: 'Results for',
    resultCount: (n) => `${n.toLocaleString('en')} films`,
    loading: 'Loading…',
    loadMore: 'Load more',
    empty: 'Nothing matched that search.',
    emptyHint: 'Try another title, a director, or drop the language filter.',
    error: 'We could not reach the library.',
    retry: 'Retry',
    back: 'Back',
    resume: 'Resume from',
    version: 'Version / language',
    quality: 'Quality',
    subtitles: 'Subtitles',
    subtitlesOff: 'Off',
    speed: 'Speed',
    addFavorite: 'Save',
    removeFavorite: 'Saved',
    download: 'Download',
    source: 'View on Internet Archive',
    noVideo: 'This record has no browser-playable video.',
    noAds: 'Ad-free',
    publicDomain: 'Public domain',
    unknownLanguage: 'Unidentified language',
    original: 'Original version',
    subtitleError: 'Subtitles could not be loaded.',
    shortcuts: 'Shortcuts: space play/pause · ←/→ 10s · F fullscreen · M mute · C subtitles',
    footer: 'Content from Internet Archive. No trackers, no third-party cookies, no ads.',
    languageOfFilm: 'Film language',
    year: 'Year',
    duration: 'Length',
    director: 'Director / author',
    collections: 'Collections',
    removeFromList: 'Remove from keep watching',
    searching: 'Searching…',
    loadMoreError: 'We could not load more results.',
    documentTitle: 'Pelis · Ad-free public domain cinema',
  },
};

let current = 'es';

export function setUILanguage(code) {
  current = STRINGS[code] ? code : 'es';
  document.documentElement.lang = current;
  return current;
}

export function uiLanguage() {
  return current;
}

/** Texto traducido. Acepta funciones para plurales/interpolación. */
export function t(key, ...args) {
  const value = STRINGS[current]?.[key] ?? STRINGS.es[key] ?? key;
  return typeof value === 'function' ? value(...args) : value;
}

/** Elige el campo localizado de un objeto {es, en}. */
export function pick(entry) {
  if (!entry) return '';
  return entry[current] ?? entry.es ?? Object.values(entry)[0] ?? '';
}
