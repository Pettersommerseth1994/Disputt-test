// Builds the static site (GitHub Pages or any static host) into dist/. No dependencies, no bundler: it copies
// public/ and the shared engine, writes the deployment config, and adds a Content-Security-Policy to the pages.
//
//   node tools/pages/build.mjs [--out dist] [--base /Disputt/] [--mode p2p|server] [--server-url wss://host/ws]
//                              [--peer-host h] [--peer-port 443] [--peer-path /peerjs] [--peer-secure 1]
//                              [--ice-servers '<json array>'] [--timings '<json object>'] [--no-csp]
//                              [--payments-url https://pay.example.workers.dev --payments-key <base64> [--payments-methods vipps,applepay]
//                               [--free-rounds 2] [--terms-url https://…] [--privacy-url https://…]]
//                              [--payments-demo [--payments-methods vipps,applepay] [--free-rounds 2]]   (no payment server: see below)
//
// The same settings can come from the environment (handy in CI): DISPUTT_MODE, DISPUTT_SERVER_URL, DISPUTT_PEER_HOST,
// DISPUTT_PEER_PORT, DISPUTT_PEER_PATH, DISPUTT_PEER_SECURE, DISPUTT_ICE_SERVERS, and for payments (docs/BETALING.md)
// DISPUTT_PAYMENTS_URL, DISPUTT_PAYMENTS_KEY, DISPUTT_PAYMENTS_METHODS, DISPUTT_FREE_ROUNDS, DISPUTT_TERMS_URL, DISPUTT_PRIVACY_URL.
// Payments are off unless both the URL and the key are given.
// DISPUTT_PAYMENTS_DEMO (1) is the other way to switch them on, for a test copy and never for the real site: the page then has a pretend
// payment server and a pretend Stripe of its own (payments/demo/), so that payments and "Logg inn" can be tried without a Stripe account.
// It cannot be combined with a real payment server.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Parses `--key value` / `--flag` arguments; values fall back to the given environment variables. */
function options(argv, env) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) flags[key] = true;
    else flags[key] = argv[++i];
  }
  const pick = (flag, envName) => flags[flag] ?? (env[envName] ? env[envName] : undefined);
  return {
    out: flags.out ?? 'dist',
    base: flags.base ?? null,
    mode: pick('mode', 'DISPUTT_MODE') ?? 'p2p',
    serverUrl: pick('server-url', 'DISPUTT_SERVER_URL') ?? null,
    peerHost: pick('peer-host', 'DISPUTT_PEER_HOST'),
    peerPort: pick('peer-port', 'DISPUTT_PEER_PORT'),
    peerPath: pick('peer-path', 'DISPUTT_PEER_PATH'),
    peerSecure: pick('peer-secure', 'DISPUTT_PEER_SECURE'),
    iceServers: pick('ice-servers', 'DISPUTT_ICE_SERVERS'),
    timings: pick('timings', 'DISPUTT_TIMINGS'),
    paymentsUrl: pick('payments-url', 'DISPUTT_PAYMENTS_URL'),
    paymentsKey: pick('payments-key', 'DISPUTT_PAYMENTS_KEY'),
    paymentsMethods: pick('payments-methods', 'DISPUTT_PAYMENTS_METHODS'),
    paymentsDemo: pick('payments-demo', 'DISPUTT_PAYMENTS_DEMO'),
    freeRounds: pick('free-rounds', 'DISPUTT_FREE_ROUNDS'),
    termsUrl: pick('terms-url', 'DISPUTT_TERMS_URL'),
    privacyUrl: pick('privacy-url', 'DISPUTT_PRIVACY_URL'),
    csp: !flags['no-csp'],
  };
}

function copyDir(from, to, filter = () => true) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.name === '.DS_Store' || !filter(entry.name, from)) continue;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst, filter);
    else fs.copyFileSync(src, dst);
  }
}

// These values come from the command line or from repository variables and end up inside HTML attributes (the CSP
// <meta>, <base href>) and inside the CSP itself, where a quote or a semicolon would change what they mean.
const HOST = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*|\[[0-9A-Fa-f:.]+\])$/;
const URL_PATH = /^\/[A-Za-z0-9._~\-/]*$/;
function check(what, value, ok) {
  if (value !== undefined && value !== null && !ok(String(value))) {
    throw new Error(`${what} has characters that do not belong in it: ${JSON.stringify(value)}`);
  }
}
const escapeAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The payment demo is on for --payments-demo (no value) and for DISPUTT_PAYMENTS_DEMO=1/true/yes/on. */
const demoOn = (value) => value === true || ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());

export async function buildConfig(opts) {
  check('peer host (--peer-host / DISPUTT_PEER_HOST)', opts.peerHost, (v) => HOST.test(v));
  check('peer port (--peer-port / DISPUTT_PEER_PORT)', opts.peerPort, (v) => /^\d{1,5}$/.test(v) && Number(v) >= 1 && Number(v) <= 65535);
  check('peer path (--peer-path / DISPUTT_PEER_PATH)', opts.peerPath, (v) => URL_PATH.test(v));
  check('--base', opts.base, (v) => URL_PATH.test(v) && v.endsWith('/'));
  check('server URL (--server-url / DISPUTT_SERVER_URL)', opts.serverUrl, (v) => {
    try {
      const u = new URL(v);
      return ['ws:', 'wss:'].includes(u.protocol) && HOST.test(u.hostname); // (URL parsing alone lets a quote through in a host name)
    } catch {
      return false;
    }
  });
  // payments: the payment server's address goes into the CSP and the key is a public key, so both are checked like the rest
  const httpsUrl = (v, { path: pathOk = false } = {}) => {
    if (/["'`<>\;\s]/.test(v)) return false; // (nothing that means something in HTML, in the CSP or in a URL's own syntax)
    try {
      const u = new URL(v);
      const local = u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(u.hostname); // (the tests run a payment server on localhost)
      return (u.protocol === 'https:' || local) && HOST.test(u.hostname) && !u.username && !u.password && !u.search && !u.hash && (pathOk || u.pathname === '/');
    } catch {
      return false;
    }
  };
  check('payments URL (--payments-url / DISPUTT_PAYMENTS_URL)', opts.paymentsUrl, (v) => httpsUrl(v));
  check('payments key (--payments-key / DISPUTT_PAYMENTS_KEY)', opts.paymentsKey, (v) => /^[A-Za-z0-9+/]{80,200}={0,2}$/.test(v));
  check('payment methods (--payments-methods / DISPUTT_PAYMENTS_METHODS)', opts.paymentsMethods, (v) => /^(vipps|applepay)(,(vipps|applepay))*$/.test(v));
  check('free rounds (--free-rounds / DISPUTT_FREE_ROUNDS, 1 to 99: the first round is always free)', opts.freeRounds, (v) => /^[1-9]\d?$/.test(v));
  check('terms URL (--terms-url / DISPUTT_TERMS_URL)', opts.termsUrl, (v) => httpsUrl(v, { path: true }) && v.startsWith('https:'));
  check('privacy URL (--privacy-url / DISPUTT_PRIVACY_URL)', opts.privacyUrl, (v) => httpsUrl(v, { path: true }) && v.startsWith('https:'));
  check('payments demo (--payments-demo / DISPUTT_PAYMENTS_DEMO)', opts.paymentsDemo, (v) => /^(true|1|yes|on|false|0|no|off)$/i.test(v));
  const demo = demoOn(opts.paymentsDemo);
  if (demo && (opts.paymentsUrl || opts.paymentsKey)) throw new Error('The payments demo has a payment server of its own: it cannot be combined with --payments-url and --payments-key');
  if (Boolean(opts.paymentsUrl) !== Boolean(opts.paymentsKey)) throw new Error('Payments need both --payments-url and --payments-key (or neither)');
  const defaults = (await import(pathToFileURL(path.join(ROOT, 'public', 'config.js')).href)).default;
  const config = { ...defaults, mode: opts.mode === 'server' ? 'server' : 'p2p', serverUrl: opts.serverUrl || null, peer: { ...defaults.peer } };
  if (opts.peerHost) {
    config.peer = {
      host: opts.peerHost,
      port: Number(opts.peerPort || 443),
      path: opts.peerPath || '/peerjs',
      secure: !['0', 'false'].includes(String(opts.peerSecure ?? '1')),
    };
  }
  if (opts.iceServers) {
    const parsed = JSON.parse(opts.iceServers);
    if (!Array.isArray(parsed)) throw new Error('--ice-servers must be a JSON array');
    config.iceServers = parsed;
  }
  if (opts.timings) config.timings = JSON.parse(opts.timings);
  if ((opts.paymentsUrl && opts.paymentsKey) || demo) {
    config.payments = {
      // (a demo has no server and no key to give: the page makes its own, see payments/demo/demo.js)
      ...(demo ? { demo: true } : { apiUrl: new URL(opts.paymentsUrl).origin, publicKey: opts.paymentsKey }),
      methods: opts.paymentsMethods ? [...new Set(opts.paymentsMethods.split(','))] : ['applepay'],
      freeRounds: opts.freeRounds === undefined ? 2 : Number(opts.freeRounds),
      ...(opts.termsUrl ? { termsUrl: opts.termsUrl } : {}),
      ...(opts.privacyUrl ? { privacyUrl: opts.privacyUrl } : {}),
    };
  }
  // The host goes to Stripe and comes back, with the room kept in the tab and the guests told to wait: that is how the page hosts a game.
  // A Disputt server gives a host that leaves only a few minutes before somebody else takes over, so the two do not go together.
  if (config.payments && config.mode === 'server') throw new Error('Payments work with the peer-to-peer build (GitHub Pages), not with DISPUTT_SERVER_URL');
  // A remote server only makes sense in server mode; without one, a "server" build would have nobody to talk to.
  if (config.mode === 'server' && !config.serverUrl) throw new Error('Server mode on static hosting needs --server-url');
  return config;
}

/** The Content-Security-Policy for the built pages: only this site, plus whatever the config says we talk to. */
export function contentSecurityPolicy(config) {
  const connect = new Set(["'self'"]);
  if (config.mode === 'p2p') {
    if (config.peer.host) {
      const scheme = config.peer.secure ? 'wss' : 'ws';
      const http = config.peer.secure ? 'https' : 'http';
      const port = config.peer.port ? `:${config.peer.port}` : '';
      connect.add(`${scheme}://${config.peer.host}${port}`);
      connect.add(`${http}://${config.peer.host}${port}`);
    } else {
      connect.add('wss://0.peerjs.com');
      connect.add('https://0.peerjs.com');
    }
  } else if (config.serverUrl) {
    connect.add(new URL(config.serverUrl).origin.replace(/^http/, 'ws'));
  }
  if (config.payments?.apiUrl) connect.add(new URL(config.payments.apiUrl).origin);
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${[...connect].join(' ')}`,
    "manifest-src 'self'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ');
}

function withMeta(html, config, opts, extraHead = '') {
  const tags = [];
  if (opts.csp) tags.push(`<meta http-equiv="Content-Security-Policy" content="${escapeAttr(contentSecurityPolicy(config))}">`);
  tags.push('<meta name="referrer" content="no-referrer">');
  if (extraHead) tags.push(extraHead);
  return html.replace('<head>', `<head>\n  ${tags.join('\n  ')}`);
}

export async function build(argv = [], env = process.env) {
  const opts = options(argv, env);
  const out = path.resolve(ROOT, opts.out);
  const config = await buildConfig(opts);

  fs.rmSync(out, { recursive: true, force: true });
  copyDir(path.join(ROOT, 'public'), out);
  // the engine and roster are shared between the Node server and the browser (the p2p host runs the engine in the page)
  copyDir(path.join(ROOT, 'shared'), path.join(out, 'shared'), (name) => /\.m?js$/.test(name));
  if (config.payments?.demo) {
    // the real payment server and the pretend Stripe of the tests, run by the page itself (payments/demo/demo.js)
    const demo = path.join(out, 'demo');
    copyDir(path.join(ROOT, 'payments', 'demo'), demo);
    fs.copyFileSync(path.join(ROOT, 'payments', 'worker.js'), path.join(demo, 'worker.js'));
    fs.copyFileSync(path.join(ROOT, 'tools', 'qa', 'fakestripe.mjs'), path.join(demo, 'fakestripe.js'));
  }

  fs.writeFileSync(
    path.join(out, 'config.js'),
    `// Generated by tools/pages/build.mjs. Edit public/config.js (defaults) or the build settings, not this file.\nexport default ${JSON.stringify(config, null, 2)};\n`,
  );

  // every page gets the CSP; 404.html is the app shell with a <base>, so old /j/ABCD paths still render on static hosts
  const pages = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.html')) pages.push(p);
    }
  };
  walk(out);
  for (const page of pages) fs.writeFileSync(page, withMeta(fs.readFileSync(page, 'utf8'), config, opts));
  const index = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  fs.writeFileSync(path.join(out, '404.html'), opts.base ? index.replace('<head>', `<head>\n  <base href="${escapeAttr(opts.base)}">`) : index);
  fs.writeFileSync(path.join(out, '.nojekyll'), '');

  let files = 0;
  let bytes = 0;
  const count = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) count(p);
      else {
        files++;
        bytes += fs.statSync(p).size;
      }
    }
  };
  count(out);
  return { out, config, files, bytes, pages: pages.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await build(process.argv.slice(2));
  console.log(`Built ${result.files} files (${(result.bytes / 1024 / 1024).toFixed(1)} MB) -> ${path.relative(ROOT, result.out)}/`);
  console.log(`mode: ${result.config.mode}${result.config.serverUrl ? `, server: ${result.config.serverUrl}` : ''}${result.config.peer.host ? `, peer server: ${result.config.peer.host}` : result.config.mode === 'p2p' ? ', peer server: PeerJS cloud' : ''}`);
}
