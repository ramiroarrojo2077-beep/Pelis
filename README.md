# Pelis

Plataforma web para **buscar y ver películas de dominio público** y de bibliotecas
abiertas, **sin anuncios**, con **buscador en tiempo real** y selección del
**idioma de la película** (doblajes y subtítulos).

Todo el catálogo viene de [Internet Archive](https://archive.org), limitado a
colecciones de obras libres de derechos. No hay backend propio, ni base de datos,
ni cuentas: es una aplicación estática que habla directamente con la API pública
de archive.org desde el navegador.

## Arrancar

```bash
npm start          # http://localhost:4173
```

Sirve con cualquier servidor estático (`python3 -m http.server`, Netlify, GitHub
Pages, nginx…). No hay build ni dependencias: es HTML, CSS y módulos ES nativos.

> Hace falta servirlo por HTTP: abrir `index.html` con `file://` bloquea los
> módulos ES por política de origen del navegador.

## Publicar

`.github/workflows/pages.yml` despliega en GitHub Pages en cada push a la rama
principal (o a mano desde la pestaña Actions). Pasa primero las pruebas, publica
sólo `index.html` y `src/`, y activa Pages en el repositorio la primera vez, así
que no hay que configurar nada a mano.

Las rutas son relativas y el enrutado va por hash, así que funciona igual en la
raíz de un dominio que bajo un subdirectorio como `usuario.github.io/Pelis/`.

## Qué hace

**Buscador en tiempo real.** Se busca mientras se escribe, con 220 ms de espera
entre pulsaciones, cancelación de la petición anterior (`AbortController`) y
caché en memoria de 5 minutos. La consulta combina título, autoría, temas y
descripción, y añade búsqueda por prefijo sobre la última palabra para que los
resultados aparezcan antes de terminar de escribir. Mientras llega la respuesta
se mantienen los resultados anteriores atenuados, en vez de vaciar la pantalla
en cada pulsación. La URL refleja siempre la búsqueda
(`#/buscar?q=…&lang=…&sort=…`), así que es compartible, el botón "atrás"
funciona, y al volver desde una ficha se recuperan las páginas ya cargadas y la
posición del scroll.

**Idiomas de la película.** Tres niveles:

- *Filtro de catálogo*: 12 idiomas (más cine mudo), normalizando los valores
  heterogéneos de Internet Archive — `Spanish`, `spa`, `es`, `castellano` son el
  mismo idioma.
- *Versión / doblaje*: los archivos del ítem se agrupan por máster (siguiendo la
  cadena `original` de los derivados). Si un ítem trae la copia en español y la
  inglesa, el reproductor ofrece un selector para cambiar entre ellas sin perder
  el minuto en el que ibas.
- *Subtítulos*: las pistas `.srt` se descargan y se convierten a WebVTT en el
  cliente (`<track>` no acepta SubRip), con el idioma deducido del nombre del
  archivo.

**Sin anuncios, de verdad.** No hay scripts de terceros, ni analítica, ni
cookies. Además, `index.html` declara una *Content-Security-Policy* que sólo
permite código y estilos propios y multimedia de `archive.org`: si algún día se
colara un tercero, el navegador lo bloquea.

**Reproductor.** `<video>` nativo (sin librerías) con selector de versión,
calidad, subtítulos y velocidad; atajos de teclado (espacio, ←/→ 10 s, `F`, `M`,
`C`); reanudación automática donde lo dejaste; y salto al siguiente derivado si
el formato preferido no se puede reproducir.

**Local y privado.** Favoritas, "seguir viendo" y preferencias viven en
`localStorage`. No salen del navegador, y si el almacenamiento falla (modo
privado, cuota llena) la aplicación sigue funcionando sin persistencia.

**Tolerante a los fallos de la biblioteca.** Un 5xx o un 429 de Internet Archive
se reintenta una vez antes de rendirse; un error al cargar más resultados no
borra los que ya se veían; si fallan todas las filas de la portada se muestra un
único aviso con reintento, no siete.

## Estructura

```
index.html          Documento y política de seguridad
server.js           Servidor estático de desarrollo (sin dependencias)
src/styles.css      Hoja de estilos única
src/js/
  config.js         Colecciones de dominio público, idiomas, filas de portada
  media.js          Lógica pura: idiomas, versiones, subtítulos, formatos
  archive.js        Cliente de la API de Internet Archive (caché + cancelación)
  store.js          Favoritas, progreso y preferencias en localStorage
  i18n.js           Textos de la interfaz (es / en)
  ui.js             Componentes de DOM (tarjeta, carrusel, estados)
  player.js         Reproductor y sus controles
  app.js            Enrutado y vistas
test/
  media.test.mjs    20 tests unitarios de la lógica pura
  e2e.mjs           Prueba de humo en Chromium con la API simulada
```

## Tests

```bash
npm test           # 36 unitarios, sin red
npm run test:e2e   # 29 comprobaciones en Chromium; requiere `npm i -D playwright` y `npm start`
```

Los unitarios cubren la lógica pura (normalización de idiomas, agrupación de
derivados en versiones, conversión SRT→WebVTT, construcción de la consulta) y la
capa de persistencia (favoritas, progreso, datos corruptos, almacenamiento sin
permiso de escritura).

El de extremo a extremo levanta Chromium, intercepta archive.org con datos de
ejemplo y comprueba portada, búsqueda en tiempo real, filtros, ficha, selectores
de versión/calidad/subtítulos —incluido que el navegador parsea de verdad las
líneas del subtítulo—, favoritas, seguir viendo, reintento ante un 5xx, estados
de error, caché y navegación con el historial. Incluye regresiones explícitas de
los fallos ya corregidos, cada una marcada como tal en el propio test.

## Sobre el catálogo

Sólo se consultan colecciones de Internet Archive con material de dominio público
o de libre distribución (`feature_films`, `film_noir`, `silent_films`,
`classic_cartoons`, `prelinger`, `SciFi_Horror`, …). La lista está en
`src/js/config.js` y es lo único que hay que tocar para ampliar o restringir el
catálogo.

Sobre la calidad del vídeo: las versiones se ordenan por compatibilidad del
códec antes que por resolución, porque los derivados "MPEG4" de Internet Archive
suelen ser MPEG-4 Parte 2 y muchos navegadores no los decodifican, mientras que
h.264 se reproduce siempre. Por eso un 480p puede aparecer por delante de un
720p; la etiqueta del selector indica el códec para que se entienda. Si la
fuente elegida falla, el reproductor baja sola al siguiente derivado.

Dos límites conocidos, propios de trabajar sobre metadatos comunitarios:

- El idioma de una pista se deduce del nombre del archivo cuando el ítem no lo
  declara. Es una heurística: acepta la coincidencia como palabra completa y sólo
  admite códigos cortos (`es`, `de`, `it`) al final del nombre, para no confundir
  el "it" de un título con italiano.
- Algunos ítems no tienen ningún derivado reproducible en navegador (sólo `.avi`
  o `.mpg`). En esos casos la ficha lo dice y enlaza a archive.org.
