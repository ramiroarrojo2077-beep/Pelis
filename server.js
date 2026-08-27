#!/usr/bin/env node
/**
 * Servidor estático sin dependencias.
 * Sirve la app y redirige cualquier ruta desconocida a index.html
 * (la navegación real es por hash, pero esto evita 404 al recargar).
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// `import.meta.dirname` sólo existe desde Node 20.11; así funciona también en 18.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

async function readIfFile(path) {
  try {
    const info = await stat(path);
    if (!info.isFile()) return null;
    return await readFile(path);
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const requested = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  const candidate = join(ROOT, requested);

  // Nunca servir fuera del directorio del proyecto.
  if (!candidate.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  let body = requested === '/' ? null : await readIfFile(candidate);
  let ext = extname(candidate);

  if (!body) {
    // Un fichero que se pide con extensión y no existe es un 404 de verdad;
    // devolver index.html ahí sólo esconde erratas en las rutas.
    if (ext && requested !== '/') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    body = await readIfFile(join(ROOT, 'index.html'));
    ext = '.html';
  }
  if (!body) {
    res.writeHead(404).end('Not found');
    return;
  }

  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
  });
  res.end(body);
});

server.listen(PORT, HOST, () => {
  console.log(`\n  Pelis  →  http://localhost:${PORT}\n`);
});
