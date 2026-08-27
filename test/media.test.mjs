import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSearchQuery,
  buildSubtitles,
  buildVersions,
  detectLanguageFromName,
  sanitizeTerm,
  formatBytes,
  formatClock,
  formatDuration,
  languagesOf,
  normalizeLanguage,
  parseRuntime,
  plainText,
  prettyName,
  rootOriginal,
  srtToVtt,
  yearOf,
} from '../src/js/media.js';

test('normalizeLanguage acepta nombres, códigos ISO y acentos', () => {
  assert.equal(normalizeLanguage('Spanish'), 'es');
  assert.equal(normalizeLanguage('spa'), 'es');
  assert.equal(normalizeLanguage('Español'), 'es');
  assert.equal(normalizeLanguage('castellano'), 'es');
  assert.equal(normalizeLanguage('English'), 'en');
  assert.equal(normalizeLanguage('No linguistic content'), 'silent');
  assert.equal(normalizeLanguage('klingon'), null);
  assert.equal(normalizeLanguage(''), null);
});

test('normalizeLanguage resuelve valores compuestos', () => {
  assert.equal(normalizeLanguage('eng; spa'), 'en');
  assert.equal(normalizeLanguage('unknown, French'), 'fr');
});

test('languagesOf recoge todos los idiomas del ítem', () => {
  assert.deepEqual(languagesOf({ language: ['English', 'Spanish'] }), ['en', 'es']);
  assert.deepEqual(languagesOf({ language: 'ita/fre' }), ['it', 'fr']);
  assert.deepEqual(languagesOf({}), []);
});

test('detectLanguageFromName usa palabras completas', () => {
  assert.equal(detectLanguageFromName('Metropolis.spanish.srt'), 'es');
  assert.equal(detectLanguageFromName('the_kid_1921_es.mp4'), 'es');
  assert.equal(detectLanguageFromName('nosferatu_de.mp4'), 'de');
  assert.equal(detectLanguageFromName('film-italiano.srt'), 'it');
  assert.equal(detectLanguageFromName('movie_es_512kb.mp4'), 'es');
  assert.equal(detectLanguageFromName('plan9.mp4'), null);
});

test('detectLanguageFromName no confunde palabras del título con códigos', () => {
  // "it" en medio del título no debe marcar la pista como italiana.
  assert.equal(detectLanguageFromName('is_it_a_dream_or_not_really.mp4'), null);
  assert.equal(detectLanguageFromName('the_end_of_the_road.mp4'), null);
});

test('rootOriginal sube por la cadena de derivados', () => {
  const files = [
    { name: 'master.avi' },
    { name: 'master.mp4', original: 'master.avi' },
    { name: 'master_512kb.mp4', original: 'master.mp4' },
  ];
  const byName = new Map(files.map((file) => [file.name, file]));
  assert.equal(rootOriginal(files[2], byName), 'master.avi');
  assert.equal(rootOriginal(files[0], byName), 'master.avi');
});

test('buildVersions agrupa derivados y detecta doblajes', () => {
  const files = [
    { name: 'peli_english.avi', format: 'Cinepack' },
    { name: 'peli_english.mp4', format: 'h.264', original: 'peli_english.avi', height: '480', size: '700000000' },
    { name: 'peli_english_512kb.mp4', format: '512Kb MPEG4', original: 'peli_english.mp4', height: '240', size: '200000000' },
    { name: 'peli_spanish.mp4', format: 'h.264', height: '480', size: '690000000' },
    { name: 'peli.png', format: 'PNG' },
    { name: 'peli.srt', format: 'SubRip' },
  ];

  const versions = buildVersions(files, { downloadBase: 'https://archive.org/download/peli' });
  assert.equal(versions.length, 2);

  const codes = versions.map((version) => version.language).sort();
  assert.deepEqual(codes, ['en', 'es']);

  const english = versions.find((version) => version.language === 'en');
  assert.equal(english.sources.length, 2, 'los dos derivados MP4 van juntos');
  assert.equal(english.sources[0].label, '480p', 'primero la mejor calidad');
  assert.equal(english.sources[1].label, '240p · MPEG4');
  assert.match(english.sources[0].url, /^https:\/\/archive\.org\/download\/peli\/peli_english\.mp4$/);
  assert.equal(english.sources[0].mime, 'video/mp4');
});

test('buildVersions hereda el idioma del ítem cuando sólo hay uno', () => {
  const files = [{ name: 'pelicula.mp4', format: 'h.264', height: 360 }];
  const [version] = buildVersions(files, { itemLanguages: ['fr'], downloadBase: '/d' });
  assert.equal(version.language, 'fr');
  assert.equal(version.detected, false);
});

test('buildVersions ignora archivos no reproducibles', () => {
  const files = [
    { name: 'peli.avi', format: 'Cinepack' },
    { name: 'peli.txt', format: 'Text' },
    { name: 'peli.gif', format: 'Animated GIF' },
  ];
  assert.deepEqual(buildVersions(files, { downloadBase: '/d' }), []);
});

test('buildSubtitles reconoce srt y vtt con idioma', () => {
  const tracks = buildSubtitles(
    [
      { name: 'peli.spanish.srt' },
      { name: 'peli.english.vtt' },
      { name: 'peli.mp4' },
    ],
    { downloadBase: '/d' },
  );
  assert.equal(tracks.length, 2);
  assert.deepEqual(
    tracks.map((track) => [track.language, track.format]),
    [
      ['es', 'srt'],
      ['en', 'vtt'],
    ],
  );
});

test('srtToVtt produce WebVTT válido', () => {
  const srt = '﻿1\r\n00:00:01,500 --> 00:00:04,000\r\nHola mundo\r\n\r\n2\r\n00:01:00,000 --> 00:01:02,250\r\nAdiós\r\n';
  const vtt = srtToVtt(srt);
  assert.match(vtt, /^WEBVTT\n\n/);
  assert.ok(vtt.includes('00:00:01.500 --> 00:00:04.000'));
  assert.ok(vtt.includes('00:01:00.000 --> 00:01:02.250'));
  assert.ok(!vtt.includes('﻿'));
  assert.ok(!vtt.includes('\r'));
});

test('srtToVtt respeta un WebVTT ya formado', () => {
  const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHola';
  assert.equal(srtToVtt(vtt), vtt);
});

test('parseRuntime entiende segundos y hh:mm:ss', () => {
  assert.equal(parseRuntime('3723'), 3723);
  assert.equal(parseRuntime('1:02:03'), 3723);
  assert.equal(parseRuntime('12:30'), 750);
  assert.equal(parseRuntime('90.6'), 91);
  assert.equal(parseRuntime(''), null);
  assert.equal(parseRuntime('n/a'), null);
});

test('formateadores', () => {
  assert.equal(formatDuration(3723), '1 h 2 min');
  assert.equal(formatDuration(750), '13 min');
  assert.equal(formatDuration(0), '');
  assert.equal(formatClock(3723), '1:02:03');
  assert.equal(formatClock(75), '1:15');
  assert.equal(formatClock(NaN), '0:00');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(0), '');
});

test('plainText limpia HTML y recorta', () => {
  assert.equal(plainText('<p>Una <b>peli</b> &amp; algo</p>'), 'Una peli & algo');
  assert.equal(plainText('palabra '.repeat(20), 20).endsWith('…'), true);
});

test('yearOf saca el año de year o date', () => {
  assert.equal(yearOf({ year: '1922' }), '1922');
  assert.equal(yearOf({ date: '1968-10-01T00:00:00Z' }), '1968');
  assert.equal(yearOf({}), '');
});

test('sanitizeTerm quita la sintaxis Lucene en vez de escaparla', () => {
  assert.equal(sanitizeTerm('king kong'), 'king kong');
  assert.equal(sanitizeTerm('a:b (c)'), 'a b c');
  assert.equal(sanitizeTerm('rock & roll: la peli'), 'rock roll la peli');
  // AND/OR/NOT en mayúscula son operadores; en minúscula son palabras.
  assert.equal(sanitizeTerm('cine AND terror'), 'cine and terror');
  assert.equal(sanitizeTerm('  varios   espacios  '), 'varios espacios');
});

test('regresión: un término con AND no rompe la consulta', () => {
  const query = buildSearchQuery({ term: 'cine AND terror' });
  // Antes salía title:("cine "AND" terror"), con comillas anidadas.
  assert.ok(!/"[^"]*"[A-Z]+"/.test(query), 'sin comillas anidadas');
  assert.equal((query.match(/"/g) ?? []).length % 2, 0, 'comillas balanceadas');
  assert.ok(query.includes('title:("cine and terror")'));
});

test('regresión: una sola letra no genera comodín', () => {
  assert.ok(!buildSearchQuery({ term: 'a' }).includes('a*'));
  assert.ok(buildSearchQuery({ term: 'ab' }).includes('ab*'));
});

test('buildSearchQuery siempre acota a películas de dominio público', () => {
  const query = buildSearchQuery({ term: 'nosferatu', language: 'es' });
  assert.ok(query.startsWith('mediatype:(movies)'));
  assert.ok(query.includes('collection:(feature_films'));
  assert.ok(query.includes('title:("nosferatu")'));
  assert.ok(query.includes('nosferatu*'), 'busca por prefijo mientras se escribe');
  assert.ok(query.includes('language:("Spanish"'));
});

test('buildSearchQuery sin término sigue siendo válido', () => {
  const query = buildSearchQuery({ language: 'ja' });
  assert.ok(!query.includes('title:'));
  assert.ok(query.includes('language:("Japanese"'));
});

test('prettyName limpia nombres de archivo', () => {
  assert.equal(prettyName('the_kid_1921.mp4'), 'the kid 1921');
});

test('regresión: `original` como array no rompe la agrupación', () => {
  const files = [
    { name: 'master.avi' },
    { name: 'master.mp4', format: 'h.264', original: ['master.avi'], height: 480 },
  ];
  const versions = buildVersions(files, { downloadBase: '/d' });
  assert.equal(versions.length, 1);
  assert.equal(versions[0].id, 'master.avi');
});

test('las fuentes ordenan por contenedor y luego por resolución', () => {
  const files = [
    { name: 'x.avi', format: 'Cinepack' },
    { name: 'x.mp4', format: 'h.264', original: 'x.avi', height: 480 },
    { name: 'x_hi.mp4', format: 'HiRes MPEG4', original: 'x.avi', height: 720 },
    { name: 'x.ogv', format: 'Ogg Video', original: 'x.avi', height: 1080 },
  ];
  const [version] = buildVersions(files, { downloadBase: '/d' });
  assert.deepEqual(
    version.sources.map((source) => source.label),
    ['480p', '720p · MPEG4', '1080p · Ogg'],
    'manda la compatibilidad del códec, y la etiqueta lo explica',
  );
});

test('rootOriginal corta las cadenas circulares', () => {
  const a = { name: 'a.mp4', original: 'b.mp4' };
  const b = { name: 'b.mp4', original: 'a.mp4' };
  const byName = new Map([
    ['a.mp4', a],
    ['b.mp4', b],
  ]);
  assert.equal(typeof rootOriginal(a, byName), 'string');
});
