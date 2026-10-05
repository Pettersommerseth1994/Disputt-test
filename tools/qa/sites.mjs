// The two ways Disputt can be served, for the browser tests:
//   startNodeSite() - the Node server (WebSocket mode), exactly what `npm start` runs.
//   startP2PSite()  - the *built* static site (tools/pages/build.mjs) plus a local PeerJS signalling server, so the
//                     whole peer-to-peer flow, the build output and its Content-Security-Policy are tested offline.
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../server/index.js';
import { createStaticHandler } from '../../server/static.js';
import { build } from '../pages/build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FAST = { roleMs: 2600, countdownMs: 2200 }; // (the role screen is where the phones hold their button to see the role)

export async function startNodeSite() {
  const app = createApp({ port: 0, host: '127.0.0.1', silent: true, tickMs: 50, hubOptions: { timings: FAST } });
  const port = await app.listen();
  return { mode: 'server', base: `http://127.0.0.1:${port}`, stop: () => app.close() };
}

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });

/**
 * `prefix` ('/Disputt/') serves the site below that path and nothing outside it, the way GitHub Pages does for a
 * project site, so mistakes like a link to "/assets/…" instead of "assets/…" show up in a browser test.
 */
export async function startP2PSite({ out = 'tmp/dist-p2p', prefix = '', payments = null, paymentsDemo = false } = {}) {
  const { PeerServer } = await import('peer');
  const peerPort = await freePort();
  const peerServer = PeerServer({ port: peerPort, path: '/peerjs', allow_discovery: false });
  const dist = path.resolve(ROOT, out);
  await build(['--out', dist, ...(prefix ? ['--base', prefix] : []), '--mode', 'p2p', '--peer-host', '127.0.0.1', '--peer-port', String(peerPort), '--peer-path', '/peerjs', '--peer-secure', '0', '--timings', JSON.stringify(FAST), ...(payments ? ['--payments-url', payments.url, '--payments-key', payments.key, '--payments-methods', payments.methods ?? 'vipps,applepay'] : []), ...(paymentsDemo ? ['--payments-demo', '--payments-methods', 'vipps,applepay'] : [])]);
  const statics = createStaticHandler({ publicDir: dist, sharedDir: path.join(dist, 'shared'), sharedExtensions: ['.mjs', '.js'] });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let pathname = url.pathname;
    if (prefix) {
      if (pathname === prefix.slice(0, -1)) {
        res.writeHead(301, { Location: `${prefix}${url.search}` });
        return res.end();
      }
      if (!pathname.startsWith(prefix)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('Not found (outside the project path)');
      }
      pathname = `/${pathname.slice(prefix.length)}`;
    }
    statics.serve(req, res, pathname);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    mode: 'p2p',
    base: `http://127.0.0.1:${server.address().port}${prefix.slice(0, -1)}`,
    peerPort,
    stop: async () => {
      server.closeAllConnections?.();
      server.close();
      peerServer.closeAllConnections?.();
      peerServer.close?.();
    },
  };
}
