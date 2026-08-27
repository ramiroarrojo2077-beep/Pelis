#!/usr/bin/env node
/**
 * Genera `pelis.html`: la aplicación entera en un solo fichero, para abrirla
 * con doble clic sin servidor ni Node.
 *
 *   npm run build
 *
 * Junta los módulos en orden de dependencias, les quita los `import`/`export`
 * (que necesitarían un servidor para resolverse) e incrusta el CSS. El código
 * de `src/` sigue siendo el original: este fichero sólo lo empaqueta.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)));

/** Orden topológico: cada módulo va después de aquellos de los que depende. */
const MODULES = [
  'config.js',
  'i18n.js',
  'store.js',
  'media.js',
  'archive.js',
  'ui.js',
  'player.js',
  'app.js',
];

/** Quita las declaraciones de módulo, que no tienen sentido ya concatenado. */
function stripModuleSyntax(code, name) {
  const withoutImports = code.replace(/^import[\s\S]*?from\s+'[^']+';[ \t]*\n/gm, '');
  const withoutExports = withoutImports.replace(/^export\s+/gm, '');

  if (/^\s*(import|export)\s/m.test(withoutExports)) {
    throw new Error(`Quedó sintaxis de módulo sin tratar en ${name}`);
  }
  return `/* ---------- ${name} ---------- */\n\n${withoutExports.trim()}\n`;
}

const css = await readFile(join(ROOT, 'src/styles.css'), 'utf8');

const bundle = (
  await Promise.all(
    MODULES.map(async (name) => stripModuleSyntax(await readFile(join(ROOT, 'src/js', name), 'utf8'), name)),
  )
).join('\n');

// Un `</script>` dentro de una cadena cerraría la etiqueta antes de tiempo.
const safeBundle = bundle.replace(/<\/script/gi, '<\\/script');

const html = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Pelis · Cine de dominio público sin anuncios</title>
    <meta
      name="description"
      content="Buscá y mirá películas de dominio público y bibliotecas abiertas, sin anuncios ni rastreadores, con búsqueda en tiempo real, versiones en distintos idiomas y subtítulos."
    />
    <meta name="color-scheme" content="dark" />
    <meta name="theme-color" content="#0b0d12" />

    <!--
      Fichero generado por \`npm run build\`. No lo edites a mano: los cambios se
      hacen en index.html, src/styles.css y src/js/, y se regenera.

      Sigue sin anuncios: la política de seguridad no deja pedir nada a terceros,
      sólo a archive.org. Aquí el script y el estilo van dentro del propio
      documento, así que se permiten en línea; al ser un único fichero, no hay
      código ajeno que se pueda colar.
    -->
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none';
               script-src 'unsafe-inline';
               style-src 'unsafe-inline';
               img-src data: blob: https://archive.org https://*.archive.org;
               media-src blob: https://archive.org https://*.archive.org;
               connect-src https://archive.org https://*.archive.org;
               object-src 'none';
               frame-src 'none';
               form-action 'none'"
    />

    <link
      rel="icon"
      href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='5' fill='%23f2c14e'/%3E%3Cpath d='M9 6v12h6V6H9ZM4 7h2v2H4V7Zm0 4h2v2H4v-2Zm0 4h2v2H4v-2Zm14-8h2v2h-2V7Zm0 4h2v2h-2v-2Zm0 4h2v2h-2v-2Z' fill='%230b0d12'/%3E%3C/svg%3E"
    />

    <style>
${css.trim()}
    </style>
  </head>
  <body>
    <a class="skip" href="#app">Ir al contenido</a>

    <header id="header" class="header"></header>

    <main id="app" class="main" tabindex="-1">
      <noscript>
        <p class="state">
          Esta plataforma necesita JavaScript para buscar en la biblioteca de Internet Archive.
        </p>
      </noscript>
    </main>

    <footer class="footer">
      <p>
        Catálogo servido por
        <a href="https://archive.org" target="_blank" rel="noopener noreferrer">Internet Archive</a>.
        Obras de dominio público y bibliotecas abiertas. Sin anuncios, sin rastreadores, sin cookies
        de terceros.
      </p>
    </footer>

    <script>
${safeBundle}
    </script>
  </body>
</html>
`;

await writeFile(join(ROOT, 'pelis.html'), html);
const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(`  pelis.html generado (${kb} KB, ${MODULES.length} módulos incrustados)`);
