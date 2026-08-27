/**
 * Configuración del catálogo.
 *
 * Todo el contenido proviene de colecciones de dominio público / bibliotecas
 * abiertas de Internet Archive. No se consulta ninguna otra red, no hay
 * scripts de terceros y por lo tanto no hay anuncios ni rastreadores.
 */

export const ARCHIVE = {
  search: 'https://archive.org/advancedsearch.php',
  metadata: 'https://archive.org/metadata',
  download: 'https://archive.org/download',
  thumb: 'https://archive.org/services/img',
  details: 'https://archive.org/details',
};

/** Colecciones de Internet Archive con material libre de derechos. */
export const PUBLIC_DOMAIN_COLLECTIONS = [
  'feature_films',
  'publicmovies212',
  'public_domain_movies',
  'classic_cartoons',
  'animationandcartoons',
  'film_noir',
  'silent_films',
  'silenthanshu',
  'SciFi_Horror',
  'short_films',
  'prelinger',
  'moviesandfilms',
  'universal_library',
  'more_animation',
  'vintage_cartoons',
];

/** Resultados por página en búsquedas y filas del inicio. */
export const PAGE_SIZE = 24;

/** Duración de la caché en memoria de las respuestas de la API (ms). */
export const CACHE_TTL = 5 * 60 * 1000;

/** Milisegundos de espera antes de disparar la búsqueda en tiempo real. */
export const SEARCH_DEBOUNCE = 220;

/**
 * Idiomas de película soportados.
 * `match` son los valores que Internet Archive usa en el campo `language`
 * (mezcla ISO 639-1/2 y nombres completos, en inglés y en el idioma nativo).
 * `tokens` son fragmentos que aparecen en nombres de archivos de vídeo y
 * subtítulos, y se usan para etiquetar pistas.
 */
export const LANGUAGES = [
  {
    code: 'es', flag: '🇪🇸', name: { es: 'Español', en: 'Spanish' },
    match: ['Spanish', 'spa', 'es', 'español', 'espanol', 'castellano'],
    tokens: ['spanish', 'espanol', 'español', 'castellano', 'spa', 'esp', 'es', 'latino'],
  },
  {
    code: 'en', flag: '🇬🇧', name: { es: 'Inglés', en: 'English' },
    match: ['English', 'eng', 'en'],
    tokens: ['english', 'eng', 'en', 'ingles'],
  },
  {
    code: 'fr', flag: '🇫🇷', name: { es: 'Francés', en: 'French' },
    match: ['French', 'fre', 'fra', 'fr', 'français', 'francais'],
    tokens: ['french', 'francais', 'français', 'fre', 'fra', 'fr'],
  },
  {
    code: 'it', flag: '🇮🇹', name: { es: 'Italiano', en: 'Italian' },
    match: ['Italian', 'ita', 'it', 'italiano'],
    tokens: ['italian', 'italiano', 'ita', 'it'],
  },
  {
    code: 'de', flag: '🇩🇪', name: { es: 'Alemán', en: 'German' },
    match: ['German', 'ger', 'deu', 'de', 'deutsch'],
    tokens: ['german', 'deutsch', 'ger', 'deu', 'de'],
  },
  {
    code: 'pt', flag: '🇵🇹', name: { es: 'Portugués', en: 'Portuguese' },
    match: ['Portuguese', 'por', 'pt', 'português', 'portugues'],
    tokens: ['portuguese', 'portugues', 'português', 'por', 'pt', 'br'],
  },
  {
    code: 'ru', flag: '🇷🇺', name: { es: 'Ruso', en: 'Russian' },
    match: ['Russian', 'rus', 'ru'],
    tokens: ['russian', 'rus', 'ru'],
  },
  {
    code: 'ja', flag: '🇯🇵', name: { es: 'Japonés', en: 'Japanese' },
    match: ['Japanese', 'jpn', 'ja', 'jp'],
    tokens: ['japanese', 'jpn', 'jp', 'ja'],
  },
  {
    code: 'zh', flag: '🇨🇳', name: { es: 'Chino', en: 'Chinese' },
    match: ['Chinese', 'chi', 'zho', 'zh', 'mandarin'],
    tokens: ['chinese', 'mandarin', 'chi', 'zho', 'zh'],
  },
  {
    code: 'hi', flag: '🇮🇳', name: { es: 'Hindi', en: 'Hindi' },
    match: ['Hindi', 'hin', 'hi'],
    tokens: ['hindi', 'hin'],
  },
  {
    code: 'ar', flag: '🇸🇦', name: { es: 'Árabe', en: 'Arabic' },
    match: ['Arabic', 'ara', 'ar'],
    tokens: ['arabic', 'ara'],
  },
  {
    code: 'silent', flag: '🎞️', name: { es: 'Cine mudo', en: 'Silent' },
    match: ['Silent', 'No linguistic content', 'zxx'],
    tokens: ['silent', 'mudo', 'zxx'],
  },
];

/** Filas curadas de la portada. Cada una es una consulta a la API. */
export const HOME_ROWS = [
  {
    id: 'destacadas',
    title: { es: 'Destacadas del dominio público', en: 'Public domain highlights' },
    query: 'collection:(feature_films)',
    sort: 'downloads desc',
  },
  {
    id: 'espanol',
    title: { es: 'En español', en: 'In Spanish' },
    query: 'language:(Spanish OR spa OR español)',
    sort: 'downloads desc',
  },
  {
    id: 'noir',
    title: { es: 'Cine negro', en: 'Film noir' },
    query: 'collection:(film_noir)',
    sort: 'downloads desc',
  },
  {
    id: 'scifi',
    title: { es: 'Ciencia ficción y terror', en: 'Sci-fi & horror' },
    query: 'collection:(SciFi_Horror)',
    sort: 'downloads desc',
  },
  {
    id: 'animacion',
    title: { es: 'Animación clásica', en: 'Classic animation' },
    query: 'collection:(classic_cartoons OR animationandcartoons OR vintage_cartoons)',
    sort: 'downloads desc',
  },
  {
    id: 'mudo',
    title: { es: 'Cine mudo', en: 'Silent cinema' },
    query: 'collection:(silent_films OR silenthanshu)',
    sort: 'downloads desc',
  },
  {
    id: 'cortos',
    title: { es: 'Cortometrajes', en: 'Short films' },
    query: 'collection:(short_films OR prelinger)',
    sort: 'downloads desc',
  },
];

/** Opciones de ordenación disponibles en la búsqueda. */
export const SORT_OPTIONS = [
  { id: 'relevance', value: '', label: { es: 'Relevancia', en: 'Relevance' } },
  { id: 'popular', value: 'downloads desc', label: { es: 'Más vistas', en: 'Most watched' } },
  { id: 'rating', value: 'avg_rating desc', label: { es: 'Mejor valoradas', en: 'Top rated' } },
  { id: 'newest', value: 'date desc', label: { es: 'Más recientes', en: 'Newest' } },
  { id: 'oldest', value: 'date asc', label: { es: 'Más antiguas', en: 'Oldest' } },
  { id: 'title', value: 'titleSorter asc', label: { es: 'Título (A-Z)', en: 'Title (A-Z)' } },
];

/** Formatos de vídeo reproducibles en navegador, de mejor a peor. */
export const VIDEO_FORMATS = [
  { test: /^h\.264( ia)?$/i, ext: 'mp4', mime: 'video/mp4', score: 100 },
  { test: /mpeg4|mp4/i, ext: 'mp4', mime: 'video/mp4', score: 90 },
  { test: /webm/i, ext: 'webm', mime: 'video/webm', score: 70 },
  { test: /ogg video|ogv|theora/i, ext: 'ogv', mime: 'video/ogg', score: 40 },
];
