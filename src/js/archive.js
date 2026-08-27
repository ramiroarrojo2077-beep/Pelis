/**
 * Cliente de la API pública de Internet Archive.
 *
 * Sólo se habla con archive.org: ni analítica, ni publicidad, ni terceros.
 * Incluye caché en memoria y cancelación de peticiones para que el buscador
 * en tiempo real no lance decenas de consultas encadenadas.
 */
import { ARCHIVE, CACHE_TTL, PAGE_SIZE } from './config.js';
import { buildSearchQuery, buildSubtitles, buildVersions, languagesOf } from './media.js';

const cache = new Map();

function fromCache(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.time > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function intoCache(key, value) {
  cache.set(key, { time: Date.now(), value });
  // Cota simple para no crecer sin límite en sesiones largas.
  if (cache.size > 120) cache.delete(cache.keys().next().value);
  return value;
}

async function getJSON(url, { signal } = {}) {
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`Internet Archive respondió ${response.status}`);
  }
  return response.json();
}

const SEARCH_FIELDS = [
  'identifier',
  'title',
  'year',
  'date',
  'description',
  'creator',
  'language',
  'downloads',
  'avg_rating',
  'runtime',
  'item_size',
  'collection',
  'subject',
];

/** Póster del ítem (servicio de miniaturas de Internet Archive). */
export function posterFor(identifier) {
  return `${ARCHIVE.thumb}/${encodeURIComponent(identifier)}`;
}

/** Ficha pública del ítem en archive.org. */
export function detailsFor(identifier) {
  return `${ARCHIVE.details}/${encodeURIComponent(identifier)}`;
}

/**
 * Busca películas.
 * @returns {Promise<{total:number, page:number, items:Array}>}
 */
export async function search({
  term = '',
  language = '',
  sort = '',
  page = 1,
  rows = PAGE_SIZE,
  query = '',
  signal,
} = {}) {
  const q = query ? buildSearchQuery({ term, language, extra: query }) : buildSearchQuery({ term, language });
  const params = new URLSearchParams();
  params.set('q', q);
  for (const field of SEARCH_FIELDS) params.append('fl[]', field);
  if (sort) params.append('sort[]', sort);
  params.set('rows', String(rows));
  params.set('page', String(page));
  params.set('output', 'json');

  const url = `${ARCHIVE.search}?${params}`;
  const cached = fromCache(url);
  if (cached) return cached;

  const data = await getJSON(url, { signal });
  const docs = data?.response?.docs ?? [];
  const result = {
    total: Number(data?.response?.numFound ?? docs.length),
    page,
    items: docs.map(toItem),
  };
  return intoCache(url, result);
}

/** Normaliza un documento de búsqueda al modelo que usa la interfaz. */
function toItem(doc) {
  return {
    id: doc.identifier,
    title: Array.isArray(doc.title) ? doc.title[0] : doc.title || doc.identifier,
    creator: Array.isArray(doc.creator) ? doc.creator.join(', ') : doc.creator || '',
    description: doc.description,
    year: doc.year || doc.date,
    languages: languagesOf(doc),
    rawLanguages: doc.language,
    downloads: Number(doc.downloads) || 0,
    rating: Number(doc.avg_rating) || null,
    runtime: doc.runtime,
    size: Number(doc.item_size) || null,
    collections: doc.collection,
    poster: posterFor(doc.identifier),
  };
}

/**
 * Metadatos completos de una película, ya resueltos en versiones de vídeo
 * (una por doblaje/montaje) y pistas de subtítulos.
 */
export async function getMovie(identifier, { signal } = {}) {
  const url = `${ARCHIVE.metadata}/${encodeURIComponent(identifier)}`;
  const cached = fromCache(url);
  if (cached) return cached;

  const data = await getJSON(url, { signal });
  if (!data || !data.metadata) {
    throw new Error('No encontramos esta película en Internet Archive.');
  }

  const meta = data.metadata;
  const downloadBase = `${ARCHIVE.download}/${encodeURIComponent(identifier)}`;
  const itemLanguages = languagesOf(meta);
  const versions = buildVersions(data.files, { itemLanguages, downloadBase });
  const subtitles = buildSubtitles(data.files, { downloadBase });

  const movie = {
    id: identifier,
    title: Array.isArray(meta.title) ? meta.title[0] : meta.title || identifier,
    creator: Array.isArray(meta.creator) ? meta.creator.join(', ') : meta.creator || '',
    description: meta.description,
    year: meta.year || meta.date,
    languages: itemLanguages,
    rawLanguages: meta.language,
    licenseUrl: meta.licenseurl || '',
    rights: meta.rights || '',
    collections: meta.collection,
    subjects: meta.subject,
    poster: posterFor(identifier),
    versions,
    subtitles,
    detailsUrl: detailsFor(identifier),
  };
  return intoCache(url, movie);
}

/**
 * Descarga una pista de subtítulos y la devuelve como URL de blob WebVTT,
 * que es lo que admite <track> sin problemas de CORS.
 */
export async function loadSubtitleTrack(track, { signal } = {}) {
  const { srtToVtt } = await import('./media.js');
  const response = await fetch(track.url, { signal });
  if (!response.ok) throw new Error(`No se pudo cargar ${track.name}`);
  const text = await response.text();
  const vtt = track.format === 'vtt' && /^\s*WEBVTT/.test(text) ? text : srtToVtt(text);
  return URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
}
