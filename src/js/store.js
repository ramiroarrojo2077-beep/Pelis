/**
 * Estado persistente en el navegador: favoritas, progreso de reproducción y
 * preferencias. Todo vive en localStorage del propio dominio; nada sale de acá.
 */

const KEYS = {
  favorites: 'pelis:favorites',
  progress: 'pelis:progress',
  prefs: 'pelis:prefs',
};

const MAX_PROGRESS_ENTRIES = 60;

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Modo privado o cuota llena: la app sigue funcionando sin persistencia.
  }
}

/* ---------- Preferencias ---------- */

const defaultPrefs = { ui: null, language: '', sort: 'downloads desc', volume: 1, subtitles: '' };

export function getPrefs() {
  return { ...defaultPrefs, ...read(KEYS.prefs, {}) };
}

export function setPref(key, value) {
  const prefs = getPrefs();
  prefs[key] = value;
  write(KEYS.prefs, prefs);
  return prefs;
}

/* ---------- Favoritas ---------- */

export function getFavorites() {
  const list = read(KEYS.favorites, []);
  return Array.isArray(list) ? list : [];
}

export function isFavorite(id) {
  return getFavorites().some((entry) => entry.id === id);
}

export function toggleFavorite(movie) {
  const list = getFavorites();
  const index = list.findIndex((entry) => entry.id === movie.id);
  if (index >= 0) {
    list.splice(index, 1);
  } else {
    list.unshift({
      id: movie.id,
      title: movie.title,
      year: movie.year,
      poster: movie.poster,
      languages: movie.languages ?? [],
      savedAt: Date.now(),
    });
  }
  write(KEYS.favorites, list.slice(0, 200));
  return index < 0;
}

/* ---------- Progreso ---------- */

export function getProgressMap() {
  const map = read(KEYS.progress, {});
  return map && typeof map === 'object' ? map : {};
}

export function getProgress(id) {
  return getProgressMap()[id] ?? null;
}

export function saveProgress(movie, { time, duration, versionId }) {
  if (!movie?.id || !Number.isFinite(time) || time < 5) return;
  const map = getProgressMap();
  const ratio = duration ? time / duration : 0;

  // Si terminó (>95%), lo sacamos de "seguir viendo".
  if (ratio > 0.95) {
    delete map[movie.id];
  } else {
    map[movie.id] = {
      id: movie.id,
      title: movie.title,
      year: movie.year,
      poster: movie.poster,
      languages: movie.languages ?? [],
      time,
      duration: duration || null,
      versionId: versionId || null,
      updatedAt: Date.now(),
    };
  }

  const entries = Object.values(map)
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, MAX_PROGRESS_ENTRIES);
  write(KEYS.progress, Object.fromEntries(entries.map((entry) => [entry.id, entry])));
}

export function getContinueWatching() {
  return Object.values(getProgressMap()).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

export function clearProgress(id) {
  const map = getProgressMap();
  delete map[id];
  write(KEYS.progress, map);
}
