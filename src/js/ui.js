/** Helpers de DOM y componentes reutilizables. */
import { t, pick } from './i18n.js';
import { languageByCode, formatDuration, plainText, yearOf, parseRuntime } from './media.js';
import { LANGUAGES } from './config.js';

/** Crea un elemento. `props` admite class, text, html, dataset y atributos. */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style') node.setAttribute('style', value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** Etiqueta legible de un idioma ("🇪🇸 Español"). */
export function languageLabel(code) {
  const lang = languageByCode(code);
  if (!lang) return t('unknownLanguage');
  return `${lang.flag} ${pick(lang.name)}`;
}

function languageChips(codes = []) {
  if (!codes.length) return null;
  return el(
    'ul',
    { class: 'chips', 'aria-label': t('languageOfFilm') },
    codes.slice(0, 3).map((code) => el('li', { class: 'chip', text: languageLabel(code) })),
  );
}

/** Tarjeta de película para las cuadrículas y carruseles. */
export function movieCard(item, { progress = null } = {}) {
  const year = yearOf(item);
  const runtime = parseRuntime(item.runtime);
  const meta = [year, runtime ? formatDuration(runtime) : ''].filter(Boolean).join(' · ');

  const poster = el('img', {
    class: 'card__img',
    src: item.poster,
    alt: '',
    loading: 'lazy',
    decoding: 'async',
    onerror: (event) => event.currentTarget.classList.add('is-broken'),
  });

  const ratio = progress?.duration ? Math.min(progress.time / progress.duration, 1) : 0;

  return el(
    'a',
    {
      class: 'card',
      href: `#/peli/${encodeURIComponent(item.id)}`,
      'aria-label': `${item.title}${year ? ` (${year})` : ''}`,
    },
    [
      el('div', { class: 'card__poster' }, [
        el('span', { class: 'card__fallback', text: item.title }),
        poster,
        el('span', { class: 'card__play', 'aria-hidden': 'true', html: playIcon() }),
        ratio > 0 &&
          el('span', { class: 'card__progress' }, [
            el('span', { class: 'card__progress-bar', style: `width:${(ratio * 100).toFixed(1)}%` }),
          ]),
      ]),
      el('div', { class: 'card__body' }, [
        el('h3', { class: 'card__title', text: item.title }),
        meta && el('p', { class: 'card__meta', text: meta }),
        languageChips(item.languages),
      ]),
    ],
  );
}

function playIcon() {
  return '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M8 5.14v13.72L19 12z"/></svg>';
}

/** Cuadrícula de tarjetas. */
export function grid(items, { progressMap = {} } = {}) {
  return el(
    'div',
    { class: 'grid' },
    items.map((item) => movieCard(item, { progress: progressMap[item.id] })),
  );
}

/** Carrusel horizontal con título. */
export function carousel({ title, items, progressMap = {}, action = null }) {
  const track = el(
    'div',
    { class: 'row__track' },
    items.map((item) => movieCard(item, { progress: progressMap[item.id] })),
  );

  const scrollBy = (direction) => {
    track.scrollBy({ left: direction * track.clientWidth * 0.9, behavior: 'smooth' });
  };

  return el('section', { class: 'row' }, [
    el('div', { class: 'row__head' }, [
      el('h2', { class: 'row__title', text: title }),
      action,
      el('div', { class: 'row__nav' }, [
        el('button', {
          class: 'icon-btn',
          type: 'button',
          'aria-label': '‹',
          text: '‹',
          onclick: () => scrollBy(-1),
        }),
        el('button', {
          class: 'icon-btn',
          type: 'button',
          'aria-label': '›',
          text: '›',
          onclick: () => scrollBy(1),
        }),
      ]),
    ]),
    track,
  ]);
}

/** Esqueletos de carga (evitan el salto de layout). */
export function skeletonRow(count = 6) {
  return el(
    'div',
    { class: 'row__track row__track--skeleton' },
    Array.from({ length: count }, () => el('div', { class: 'skeleton-card' })),
  );
}

export function skeletonGrid(count = 12) {
  return el(
    'div',
    { class: 'grid' },
    Array.from({ length: count }, () => el('div', { class: 'skeleton-card' })),
  );
}

/** Estado vacío. */
export function emptyState(title, hint) {
  return el('div', { class: 'state' }, [
    el('p', { class: 'state__title', text: title }),
    hint && el('p', { class: 'state__hint', text: hint }),
  ]);
}

/** Estado de error con botón de reintento. */
export function errorState(message, onRetry) {
  return el('div', { class: 'state state--error' }, [
    el('p', { class: 'state__title', text: t('error') }),
    message && el('p', { class: 'state__hint', text: message }),
    onRetry && el('button', { class: 'btn', type: 'button', text: t('retry'), onclick: onRetry }),
  ]);
}

/** <select> etiquetado. */
export function selectField({ id, label, options, value, onchange }) {
  const select = el(
    'select',
    { id, class: 'select', onchange: (event) => onchange(event.currentTarget.value) },
    options.map((option) =>
      el('option', { value: option.value, selected: option.value === value }, [option.label]),
    ),
  );
  return el('div', { class: 'field' }, [
    el('label', { class: 'field__label', for: id, text: label }),
    select,
  ]);
}

/** Opciones del filtro de idioma de la película. */
export function languageOptions() {
  return [
    { value: '', label: t('allLanguages') },
    ...LANGUAGES.map((lang) => ({ value: lang.code, label: `${lang.flag} ${pick(lang.name)}` })),
  ];
}

/** Resumen corto para la ficha. */
export function description(value, limit = 700) {
  const text = plainText(value, limit);
  return text ? el('p', { class: 'detail__desc', text }) : null;
}
