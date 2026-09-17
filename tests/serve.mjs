/* Статика для автотестов: тот же набор файлов, что уезжает на хостинг.
   Без зависимостей — чтобы CI не тянул ничего ради http.server. */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = normalize(join(fileURLToPath(import.meta.url), '..', '..'));
const PORT = Number(process.env.PORT || 4321);
const TYPES = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.svg':'image/svg+xml', '.json':'application/json; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.md':'text/markdown; charset=utf-8'
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  let p = decodeURIComponent(url.pathname);
  if(p.endsWith('/')) p += 'index.html';
  const file = normalize(join(ROOT, p));
  if(!file.startsWith(ROOT)){ res.writeHead(403).end('forbidden'); return; }   // никаких ../
  try {
    const body = await readFile(file);
    res.writeHead(200, {'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
                        'Cache-Control': 'no-store'});
    res.end(body);
  } catch(e){
    res.writeHead(404, {'Content-Type':'text/plain; charset=utf-8'}).end('404');
  }
}).listen(PORT, () => console.log('static on :' + PORT));
