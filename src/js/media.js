/**
 * Utilidades puras sobre los metadatos de Internet Archive.
 * Este módulo no toca el DOM: se puede testear con `npm test`.
 */
import { LANGUAGES, VIDEO_FORMATS, PUBLIC_DOMAIN_COLLECTIONS } from './config.js';

const SUBTITLE_EXT = /\.(srt|vtt)$/i;
const VIDEO_EXT = /\.(mp4|m4v|webm|ogv|ogg)$/i;

/** Quita acentos y pasa a minúsculas para comparar de forma laxa. */
export function fold(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** Convierte cualquier valor de metadatos en array. */
export function toArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Traduce un valor del campo `language` de Internet Archive a nuestro código
 * interno ('Spanish', 'spa', 'castellano' → 'es'). Devuelve null si no lo
 * reconocemos, para no inventar idiomas.
 */
export function normalizeLanguage(raw) {
  const value = fold(raw);
  if (!value) return null;
  for (const lang of LANGUAGES) {
    if (lang.match.some((candidate) => fold(candidate) === value)) return lang.code;
  }
  // Valores compuestos tipo "English; Spanish" o "eng, spa".
  const parts = value.split(/[;,/|]+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length > 1) {
    for (const part of parts) {
      const code = normalizeLanguage(part);
      if (code) return code;
    }
  }
  return null;
}

/** Todos los idiomas reconocidos de un documento o metadato. */
export function languagesOf(source) {
  const codes = new Set();
  for (const value of toArray(source?.language)) {
    for (const part of String(value).split(/[;,/|]+/)) {
      const code = normalizeLanguage(part);
      if (code) codes.add(code);
    }
  }
  return [...codes];
}

/** Definición de idioma por código. */
export function languageByCode(code) {
  return LANGUAGES.find((lang) => lang.code === code) || null;
}

/**
 * Deduce el idioma a partir del nombre de un archivo
 * ("Metropolis.spanish.srt" → 'es'). El token tiene que ser una palabra
 * entera, y los códigos cortos ("es", "de", "it") sólo cuentan al final del
 * nombre: si no, "is_it_a_dream.mp4" pasaría por italiano.
 */
export function detectLanguageFromName(name) {
  const base = fold(name).replace(SUBTITLE_EXT, '').replace(VIDEO_EXT, '');
  const words = base.split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length) return null;

  let best = null;
  for (const lang of LANGUAGES) {
    for (const token of lang.tokens) {
      const folded = fold(token);
      const index = words.lastIndexOf(folded);
      if (index === -1) continue;
      if (folded.length <= 3 && index < words.length - 2) continue;
      // Los tokens largos y los que aparecen al final del nombre mandan.
      const score = folded.length * 10 + index;
      if (!best || score > best.score) best = { code: lang.code, score };
    }
  }
  return best?.code ?? null;
}

/** Formato reproducible al que corresponde un archivo, o null. */
export function videoFormatOf(file) {
  const format = String(file?.format ?? '');
  const name = String(file?.name ?? '');
  for (const candidate of VIDEO_FORMATS) {
    if (candidate.test.test(format)) return candidate;
  }
  const ext = name.match(VIDEO_EXT)?.[1]?.toLowerCase();
  if (!ext) return null;
  if (ext === 'mp4' || ext === 'm4v') return VIDEO_FORMATS[1];
  if (ext === 'webm') return VIDEO_FORMATS[2];
  return VIDEO_FORMATS[3];
}

/** Sube por la cadena `original` hasta el archivo maestro del que deriva. */
export function rootOriginal(file, byName, depth = 0) {
  const original = file?.original;
  if (!original || depth > 5) return file?.name ?? '';
  const parent = byName.get(original);
  if (!parent || parent === file) return original;
  return rootOriginal(parent, byName, depth + 1);
}

function qualityLabel(file) {
  const height = Number(file.height);
  if (Number.isFinite(height) && height > 0) return `${height}p`;
  const format = String(file.format ?? '');
  if (/512kb/i.test(format)) return '512 kb';
  if (/hires/i.test(format)) return 'HiRes';
  return format || 'Vídeo';
}

/**
 * Agrupa los archivos de un ítem en "versiones" reproducibles.
 * Cada versión corresponde a un máster distinto (habitualmente, un doblaje
 * o un montaje distinto) y contiene sus derivados ordenados por calidad.
 */
export function buildVersions(files, { itemLanguages = [], downloadBase = '' } = {}) {
  const list = toArray(files).filter((file) => file && file.name);
  const byName = new Map(list.map((file) => [file.name, file]));
  const groups = new Map();

  for (const file of list) {
    const format = videoFormatOf(file);
    if (!format) continue;
    if (/\.(thumbs?|gif|png|jpe?g)$/i.test(file.name)) continue;

    const key = rootOriginal(file, byName) || file.name;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ file, format });
  }

  const versions = [];
  for (const [key, entries] of groups) {
    const sources = entries
      .map(({ file, format }) => ({
        name: file.name,
        url: `${downloadBase}/${encodeURIComponent(file.name)}`,
        mime: format.mime,
        score: format.score + Math.min(Number(file.height) || 0, 2160) / 100,
        height: Number(file.height) || null,
        size: Number(file.size) || null,
        label: qualityLabel(file),
        length: parseRuntime(file.length),
      }))
      .sort((a, b) => b.score - a.score);

    if (!sources.length) continue;

    const detected = detectLanguageFromName(key);
    const language = detected ?? (itemLanguages.length === 1 ? itemLanguages[0] : null);
    versions.push({
      id: key,
      language,
      detected: Boolean(detected),
      title: prettyName(key),
      duration: sources.find((source) => source.length)?.length ?? null,
      sources,
    });
  }

  // Primero las versiones con idioma reconocido, luego por duración/calidad.
  return versions.sort((a, b) => {
    if (Boolean(b.detected) !== Boolean(a.detected)) return Number(b.detected) - Number(a.detected);
    return (b.sources[0].score ?? 0) - (a.sources[0].score ?? 0);
  });
}

/** Pistas de subtítulos disponibles en el ítem. */
export function buildSubtitles(files, { downloadBase = '' } = {}) {
  return toArray(files)
    .filter((file) => file?.name && SUBTITLE_EXT.test(file.name))
    .map((file) => ({
      name: file.name,
      url: `${downloadBase}/${encodeURIComponent(file.name)}`,
      format: file.name.toLowerCase().endsWith('.vtt') ? 'vtt' : 'srt',
      language: detectLanguageFromName(file.name),
      title: prettyName(file.name),
    }));
}

/** Nombre de archivo → etiqueta legible. */
export function prettyName(name) {
  return String(name)
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Convierte SubRip (.srt) a WebVTT, el único formato que entiende <track>.
 * Tolera BOM, saltos de línea Windows y tiempos con coma o punto.
 */
export function srtToVtt(input) {
  const body = String(input)
    .replace(/^\ufeff/, '')
    .replace(/\r\n?/g, '\n')
    .replace(
      /(\d{1,2}:\d{2}:\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2})[,.](\d{1,3})/g,
      (_match, start, startMs, end, endMs) =>
        `${start}.${startMs.padEnd(3, '0')} --> ${end}.${endMs.padEnd(3, '0')}`,
    )
    .trim();
  return /^WEBVTT/.test(body) ? body : `WEBVTT\n\n${body}`;
}

/** "1:02:03" o "3723" o "3723.5" → segundos. */
export function parseRuntime(value) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(text)) return Math.round(Number(text));
  const parts = text.split(':').map(Number);
  if (parts.some(Number.isNaN)) return null;
  return Math.round(parts.reduce((total, part) => total * 60 + part, 0));
}

/** Segundos → "1 h 23 min" / "12 min". */
export function formatDuration(seconds) {
  if (!seconds || seconds < 0) return '';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours && minutes) return `${hours} h ${minutes} min`;
  if (hours) return `${hours} h`;
  return `${Math.max(minutes, 1)} min`;
}

/** Segundos → "12:34" para el reproductor. */
export function formatClock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value) => String(value).padStart(2, '0');
  return hours ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

/** Bytes → "1,2 GB". */
export function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const scaled = value / 1024 ** index;
  return `${scaled.toFixed(scaled >= 100 || index === 0 ? 0 : 1)} ${units[index]}`;
}

/** Año de estreno a partir de `year` o `date`. */
export function yearOf(doc) {
  const raw = doc?.year ?? doc?.date ?? doc?.publicdate;
  const match = String(toArray(raw)[0] ?? '').match(/\d{4}/);
  return match ? match[0] : '';
}

/** Descripción sin HTML, recortada. */
export function plainText(value, limit = 0) {
  const text = toArray(value)
    .join(' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
  if (!limit || text.length <= limit) return text;
  return `${text.slice(0, limit).replace(/\s+\S*$/, '')}…`;
}

/** Escapa los caracteres especiales de Lucene en el texto del buscador. */
export function escapeQuery(term) {
  return String(term)
    .replace(/([+\-!(){}[\]^"~*?:\\/])/g, '\\$1')
    .replace(/\b(AND|OR|NOT)\b/g, '"$1"')
    .trim();
}

/**
 * Arma la consulta Lucene para la API de búsqueda.
 * Siempre restringe a películas dentro de las colecciones de dominio público.
 */
export function buildSearchQuery({ term = '', language = '', extra = '' } = {}) {
  const clauses = ['mediatype:(movies)'];
  clauses.push(`collection:(${PUBLIC_DOMAIN_COLLECTIONS.join(' OR ')})`);

  const clean = escapeQuery(term);
  if (clean) {
    const words = clean.split(/\s+/).filter(Boolean);
    const phrase = words.join(' ');
    const prefix = words.length ? `${words[words.length - 1]}*` : '';
    const fuzzy = words.slice(0, -1).concat(prefix).join(' ');
    clauses.push(
      `(title:("${phrase}") OR title:(${fuzzy}) OR creator:("${phrase}") ` +
        `OR subject:(${fuzzy}) OR description:("${phrase}"))`,
    );
  }

  const lang = languageByCode(language);
  if (lang) clauses.push(`language:(${lang.match.map((value) => `"${value}"`).join(' OR ')})`);

  if (extra) clauses.push(`(${extra})`);
  return clauses.join(' AND ');
}
