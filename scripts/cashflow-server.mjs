import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { getDemo, postAssessment } from '../lib/cashflow-api.mjs';

/** Optional local runner; Next.js uses the route files directly. */
export function createCashflowServer() {
  return createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    try {
      const url = new URL(req.url, 'http://localhost');
      let response;
      if (url.pathname === '/api/cashflow/demo') {
        response = req.method === 'GET' ? getDemo() : Response.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Use GET.' } }, { status: 405, headers: { Allow: 'GET' } });
      } else if (url.pathname === '/api/cashflow/assess') {
        response = req.method === 'POST'
          ? await postAssessment(new Request(url, { method: 'POST', headers: req.headers, body: Readable.toWeb(req), duplex: 'half' }))
          : Response.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST.' } }, { status: 405, headers: { Allow: 'POST' } });
      } else {
        response = Response.json({ error: { code: 'NOT_FOUND', message: 'Use GET /api/cashflow/demo or POST /api/cashflow/assess.' } }, { status: 404 });
      }
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
    } catch {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Unable to process this request.' } }));
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3001);
  const server = createCashflowServer();
  server.listen(port, '127.0.0.1', () => console.log(`Tabled demo backend: http://127.0.0.1:${port}/api/cashflow/demo`));
}
