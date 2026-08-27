/**
 * Reproductor. Usa el <video> nativo (sin librerías, sin anuncios) y añade
 * encima lo que el navegador no da: cambio de versión/doblaje, calidad,
 * subtítulos convertidos a WebVTT, velocidad, atajos y reanudación.
 */
import { loadSubtitleTrack } from './archive.js';
import { t } from './i18n.js';
import { formatBytes, formatClock } from './media.js';
import { getPrefs, saveProgress, setPref } from './store.js';
import { el, languageLabel, selectField } from './ui.js';

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
const SAVE_EVERY_MS = 5000;

function versionLabel(version, index) {
  if (version.language) return languageLabel(version.language);
  if (index === 0) return t('original');
  return version.title || `${t('version')} ${index + 1}`;
}

function subtitleLabel(track, index) {
  if (track.language) return languageLabel(track.language);
  return track.title || `${t('subtitles')} ${index + 1}`;
}

/**
 * @param {object} movie  Película ya resuelta por archive.getMovie()
 * @param {object} options
 * @returns {{element: HTMLElement, destroy: () => void}}
 */
export function createPlayer(movie, { startAt = 0, startVersionId = null } = {}) {
  const prefs = getPrefs();
  const versions = movie.versions;

  let versionIndex = Math.max(versions.findIndex((version) => version.id === startVersionId), 0);
  let sourceIndex = 0;
  let lastSaved = 0;
  let objectUrl = null;
  let subtitleRequest = null;

  const video = el('video', {
    class: 'player__video',
    controls: true,
    playsinline: true,
    preload: 'metadata',
    poster: movie.poster,
    tabindex: '0',
  });
  video.volume = Number.isFinite(prefs.volume) ? prefs.volume : 1;

  const note = el('p', { class: 'player__note', text: '' });

  /* ---------- fuentes ---------- */

  function currentVersion() {
    return versions[versionIndex];
  }

  function loadSource({ keepTime = true, autoplay = false } = {}) {
    const version = currentVersion();
    const source = version.sources[Math.min(sourceIndex, version.sources.length - 1)];
    const time = keepTime ? video.currentTime : 0;
    const wasPlaying = autoplay || (!video.paused && !video.ended);

    video.src = source.url;
    video.load();

    const target = keepTime ? time : startAt;
    if (target > 0) {
      const seek = () => {
        try {
          video.currentTime = target;
        } catch {
          /* algunas fuentes no admiten seek hasta tener metadatos */
        }
        video.removeEventListener('loadedmetadata', seek);
      };
      video.addEventListener('loadedmetadata', seek);
    }
    if (wasPlaying) video.play().catch(() => {});
  }

  /* ---------- subtítulos ---------- */

  function clearTracks() {
    for (const track of [...video.querySelectorAll('track')]) track.remove();
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  }

  async function applySubtitles(name) {
    subtitleRequest?.abort();
    clearTracks();
    note.textContent = '';
    setPref('subtitles', name || '');
    if (!name) return;

    const track = movie.subtitles.find((entry) => entry.name === name);
    if (!track) return;

    const controller = new AbortController();
    subtitleRequest = controller;
    try {
      objectUrl = await loadSubtitleTrack(track, { signal: controller.signal });
      const node = el('track', {
        kind: 'subtitles',
        src: objectUrl,
        srclang: track.language || 'und',
        label: subtitleLabel(track, 0),
        default: true,
      });
      node.addEventListener('load', () => {
        const textTrack = [...video.textTracks].at(-1);
        if (textTrack) textTrack.mode = 'showing';
      });
      video.append(node);
    } catch (error) {
      if (error.name !== 'AbortError') note.textContent = t('subtitleError');
    }
  }

  /* ---------- controles ---------- */

  const versionField =
    versions.length > 1
      ? selectField({
          id: 'player-version',
          label: t('version'),
          value: String(versionIndex),
          options: versions.map((version, index) => ({
            value: String(index),
            label: versionLabel(version, index),
          })),
          onchange: (value) => {
            versionIndex = Number(value);
            sourceIndex = 0;
            renderQuality();
            loadSource({ keepTime: true });
          },
        })
      : null;

  const qualitySlot = el('div', { class: 'player__control' });

  function renderQuality() {
    const version = currentVersion();
    qualitySlot.replaceChildren();
    if (version.sources.length < 2) return;
    qualitySlot.append(
      selectField({
        id: 'player-quality',
        label: t('quality'),
        value: String(sourceIndex),
        options: version.sources.map((source, index) => ({
          value: String(index),
          label: [source.label, formatBytes(source.size)].filter(Boolean).join(' · '),
        })),
        onchange: (value) => {
          sourceIndex = Number(value);
          loadSource({ keepTime: true });
        },
      }),
    );
  }

  const preferredSubtitle = movie.subtitles.some((track) => track.name === prefs.subtitles)
    ? prefs.subtitles
    : '';

  const subtitleField = movie.subtitles.length
    ? selectField({
        id: 'player-subs',
        label: t('subtitles'),
        value: preferredSubtitle,
        options: [
          { value: '', label: t('subtitlesOff') },
          ...movie.subtitles.map((track, index) => ({
            value: track.name,
            label: subtitleLabel(track, index),
          })),
        ],
        onchange: applySubtitles,
      })
    : null;

  const speedField = selectField({
    id: 'player-speed',
    label: t('speed'),
    value: '1',
    options: SPEEDS.map((speed) => ({ value: String(speed), label: `${speed}×` })),
    onchange: (value) => {
      video.playbackRate = Number(value);
    },
  });

  const controls = el(
    'div',
    { class: 'player__controls' },
    [versionField, qualitySlot, subtitleField, speedField].filter(Boolean),
  );

  /* ---------- persistencia y atajos ---------- */

  function persist() {
    saveProgress(movie, {
      time: video.currentTime,
      duration: Number.isFinite(video.duration) ? video.duration : null,
      versionId: currentVersion()?.id ?? null,
    });
  }

  const onTimeUpdate = () => {
    const now = Date.now();
    if (now - lastSaved < SAVE_EVERY_MS) return;
    lastSaved = now;
    persist();
  };

  const onVolumeChange = () => setPref('volume', video.volume);

  const onKeyDown = (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && /input|select|textarea/i.test(target.tagName)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    switch (event.key) {
      case ' ':
      case 'k':
        event.preventDefault();
        video.paused ? video.play().catch(() => {}) : video.pause();
        break;
      case 'ArrowRight':
        video.currentTime = Math.min(video.currentTime + 10, video.duration || Infinity);
        break;
      case 'ArrowLeft':
        video.currentTime = Math.max(video.currentTime - 10, 0);
        break;
      case 'f':
        if (document.fullscreenElement) document.exitFullscreen();
        else video.requestFullscreen?.().catch(() => {});
        break;
      case 'm':
        video.muted = !video.muted;
        break;
      case 'c': {
        const track = video.textTracks[0];
        if (track) track.mode = track.mode === 'showing' ? 'hidden' : 'showing';
        break;
      }
      default:
        return;
    }
  };

  video.addEventListener('timeupdate', onTimeUpdate);
  video.addEventListener('pause', persist);
  video.addEventListener('volumechange', onVolumeChange);
  video.addEventListener('error', () => {
    const version = currentVersion();
    // Si el formato preferido falla, probamos el siguiente derivado.
    if (sourceIndex < version.sources.length - 1) {
      sourceIndex += 1;
      renderQuality();
      loadSource({ keepTime: true });
    } else {
      note.textContent = t('noVideo');
    }
  });
  document.addEventListener('keydown', onKeyDown);
  window.addEventListener('beforeunload', persist);

  renderQuality();
  loadSource({ keepTime: false });
  if (preferredSubtitle) applySubtitles(preferredSubtitle);

  const resumeHint =
    startAt > 5
      ? el('p', { class: 'player__resume', text: `${t('resume')} ${formatClock(startAt)}` })
      : null;

  const element = el('div', { class: 'player' }, [
    el('div', { class: 'player__stage' }, [video]),
    resumeHint,
    controls,
    note,
    el('p', { class: 'player__hint', text: t('shortcuts') }),
  ]);

  return {
    element,
    destroy() {
      persist();
      subtitleRequest?.abort();
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('pause', persist);
      video.removeEventListener('volumechange', onVolumeChange);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('beforeunload', persist);
      video.pause();
      clearTracks();
      video.removeAttribute('src');
      video.load();
    },
  };
}
