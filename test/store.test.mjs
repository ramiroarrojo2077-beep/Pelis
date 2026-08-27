import test from 'node:test';
import assert from 'node:assert/strict';

/** localStorage de mentira: el módulo lo usa desde el objeto global. */
class FakeStorage {
  #data = new Map();
  #failWrites = false;

  getItem(key) {
    return this.#data.has(key) ? this.#data.get(key) : null;
  }

  setItem(key, value) {
    if (this.#failWrites) throw new Error('QuotaExceededError');
    this.#data.set(key, String(value));
  }

  removeItem(key) {
    this.#data.delete(key);
  }

  failWrites(value) {
    this.#failWrites = value;
  }

  clear() {
    this.#data.clear();
  }
}

const storage = new FakeStorage();
globalThis.localStorage = storage;

const {
  clearProgress,
  getContinueWatching,
  getFavorites,
  getPrefs,
  getProgress,
  isFavorite,
  saveProgress,
  setPref,
  toggleFavorite,
} = await import('../src/js/store.js');

const movie = (id) => ({ id, title: `Peli ${id}`, year: '1950', poster: `/p/${id}`, languages: ['es'] });

test.beforeEach(() => {
  storage.clear();
  storage.failWrites(false);
});

test('favoritas: alternar añade y quita', () => {
  assert.equal(toggleFavorite(movie('a')), true);
  assert.equal(isFavorite('a'), true);
  assert.equal(getFavorites()[0].title, 'Peli a');
  assert.equal(toggleFavorite(movie('a')), false);
  assert.equal(isFavorite('a'), false);
  assert.deepEqual(getFavorites(), []);
});

test('favoritas: las últimas guardadas van primero', () => {
  toggleFavorite(movie('a'));
  toggleFavorite(movie('b'));
  assert.deepEqual(getFavorites().map((entry) => entry.id), ['b', 'a']);
});

test('progreso: se guarda con duración y se puede recuperar', () => {
  saveProgress(movie('a'), { time: 120, duration: 3600, versionId: 'v1' });
  const progress = getProgress('a');
  assert.equal(progress.time, 120);
  assert.equal(progress.versionId, 'v1');
});

test('progreso: los primeros segundos no cuentan', () => {
  saveProgress(movie('a'), { time: 2, duration: 3600 });
  assert.equal(getProgress('a'), null);
});

test('progreso: una película terminada sale de seguir viendo', () => {
  saveProgress(movie('a'), { time: 100, duration: 3600 });
  assert.ok(getProgress('a'));
  saveProgress(movie('a'), { time: 3550, duration: 3600 });
  assert.equal(getProgress('a'), null, 'por encima del 95% se considera vista');
});

test('progreso: la lista se recorta a 60 entradas, las más recientes', () => {
  for (let index = 0; index < 70; index += 1) {
    saveProgress(movie(`p${index}`), { time: 60, duration: 3600 });
  }
  const list = getContinueWatching();
  assert.equal(list.length, 60);
  assert.equal(list[0].id, 'p69', 'la más reciente encabeza');
  assert.equal(getProgress('p0'), null, 'las más viejas se descartan');
});

test('progreso: valores inválidos no rompen nada', () => {
  saveProgress(null, { time: 100, duration: 3600 });
  saveProgress(movie('a'), { time: Number.NaN, duration: 3600 });
  saveProgress(movie('b'), { time: 100, duration: null });
  assert.equal(getProgress('a'), null);
  assert.equal(getProgress('b').duration, null);
});

test('clearProgress quita sólo la película indicada', () => {
  saveProgress(movie('a'), { time: 100, duration: 3600 });
  saveProgress(movie('b'), { time: 100, duration: 3600 });
  clearProgress('a');
  assert.equal(getProgress('a'), null);
  assert.ok(getProgress('b'));
});

test('preferencias: se mezclan con las de por defecto', () => {
  assert.equal(getPrefs().sort, 'downloads desc');
  setPref('language', 'fr');
  assert.equal(getPrefs().language, 'fr');
  assert.equal(getPrefs().volume, 1, 'las demás no se pierden');
});

test('datos corruptos en localStorage no tumban la app', () => {
  storage.setItem('pelis:favorites', '{no es json');
  storage.setItem('pelis:progress', 'null');
  storage.setItem('pelis:prefs', '["array", "inesperado"]');
  assert.deepEqual(getFavorites(), []);
  assert.deepEqual(getContinueWatching(), []);
  assert.equal(getPrefs().sort, 'downloads desc');
});

test('sin permiso de escritura (modo privado) la app sigue viva', () => {
  storage.failWrites(true);
  assert.doesNotThrow(() => toggleFavorite(movie('a')));
  assert.doesNotThrow(() => saveProgress(movie('a'), { time: 100, duration: 3600 }));
  assert.doesNotThrow(() => setPref('volume', 0.5));
  assert.deepEqual(getFavorites(), []);
});
