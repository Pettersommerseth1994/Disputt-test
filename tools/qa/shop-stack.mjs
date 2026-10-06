// The whole payment chain on this machine, for the browser tests of the Shopify edition: the real payment server
// (payments/worker-shopify.js) with a pretend database, in front of a pretend Shopify with a checkout page, a "thank you" page and the
// shop's front page (the real shopify/forside.liquid), all behind one local HTTP server.
//
//   const stack = await startShopStack();                 // { apiUrl, publicKey, shop, orders, … }
//   const site = await startP2PSite({ payments: { url: stack.apiUrl, key: stack.publicKey, provider: 'shopify' } });
//   stack.setSite(`${site.base}/`);                       // the payment server needs to know where the game lives
//
// What the test sees: the game asks `${apiUrl}/shop`, and the host's tab opens `${apiUrl}/cart/<variant>:1?attributes[kode]=…`, which
// becomes a pretend checkout page with a "Betal" button; "Betal" makes an order, tells the payment server about it with a signed webhook
// (the way Shopify does, and again if the payment server does not answer), and shows the "thank you" page.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import worker from '../../payments/worker-shopify.js';
import { createFakeD1 } from './fakedb.mjs';
import { PRICES, SECRET, VARIANTS, dispute, order, refund, webhookRequest } from './fakeshopify.mjs';
import { renderLiquid } from './miniliquid.mjs';

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const FRONT = readFileSync(new URL('../../shopify/forside.liquid', import.meta.url), 'utf8');
const PLAN_OF = Object.fromEntries(Object.entries(VARIANTS).map(([plan, id]) => [id, plan]));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function startShopStack() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const b64 = (buf) => Buffer.from(buf).toString('base64');
  const privateKey = b64(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const publicKey = b64(await crypto.subtle.exportKey('spki', pair.publicKey));

  let origin = '';
  const db = createFakeD1();
  const env = {
    DB: db,
    SHOPIFY_WEBHOOK_SECRET: SECRET,
    JWT_PRIVATE_KEY: privateKey,
    SITE_URL: 'http://127.0.0.1:1/', // set by setSite(): the game's own address, which is only known once the site is up
    SHOP_URL: '', // this server, once it is up
    VARIANT_EVENING: VARIANTS.evening,
    VARIANT_YEAR: VARIANTS.year,
    VARIANT_LIFETIME: VARIANTS.lifetime,
    ACCEPT_TEST_ORDERS: 'false',
  };
  const carts = new Map(); // checkout id -> { plan, attributes: [{ name, value }] }
  const orders = []; // what the pretend shop has taken, in order (the REST orders that webhooks carry)
  const failures = new Map(); // path -> how many of the next calls should fail (a payment server that is down)
  const calls = []; // every path that was asked of the pretend shop, so that a test can see what the page did and did not do
  let holding = false; // webhooks wait (a payment that Shopify has taken, and has not told anybody about yet)
  const held = [];
  let nextCart = 1;

  /** What Shopify does: calls the webhook, and calls it again a little later if it is not answered with a yes. */
  async function deliver(topic, payload, attempts = 6) {
    if (holding) return void held.push([topic, payload]);
    for (let i = 0; i < attempts; i++) {
      const remaining = failures.get('/shopify/webhook') ?? 0;
      let status = 500;
      if (remaining > 0) failures.set('/shopify/webhook', remaining - 1);
      else status = (await worker.fetch(await webhookRequest(`${origin}/shopify/webhook`, topic, payload), env)).status;
      if (status === 200) return;
      await sleep(150);
    }
  }

  const page = (title, body) =>
    `<!doctype html><html lang="nb"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><body style="font:18px system-ui;padding:24px">${body}</body></html>`;

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, origin);
      const body = req.method === 'GET' || req.method === 'HEAD' ? null : await readBody(req);
      const html = (status, text) => {
        res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(text);
      };

      // ---- the pretend shop: a cart link goes straight to the checkout
      const cart = url.pathname.match(/^\/cart\/(\d+):(\d+)$/);
      if (req.method === 'GET' && cart) {
        calls.push(url.pathname);
        const plan = PLAN_OF[cart[1]];
        if (!plan) return html(404, page('Fant ikke produktet', '<p>Fant ikke produktet.</p>'));
        const attributes = [...url.searchParams].flatMap(([k, v]) => (k.match(/^attributes\[(.+)\]$/) ? [{ name: k.match(/^attributes\[(.+)\]$/)[1], value: v }] : []));
        const id = `c${nextCart++}`;
        carts.set(id, { plan, attributes });
        res.writeHead(303, { Location: `/checkouts/${id}` });
        return res.end();
      }
      const checkout = url.pathname.match(/^\/checkouts\/(c\d+)(\/pay)?$/);
      if (checkout) {
        const cartOf = carts.get(checkout[1]);
        if (!cartOf) return html(404, page('Fant ikke kassen', '<p>Fant ikke kassen.</p>'));
        if (req.method === 'POST' && checkout[2]) {
          const code = cartOf.attributes.find((a) => a.name === 'kode')?.value ?? null;
          const placed = order({ plan: cartOf.plan, code, attributes: cartOf.attributes, test: env.ACCEPT_TEST_ORDERS === 'true' });
          orders.push(placed);
          deliver('orders/paid', placed); // (not waited for: the customer is on the thank-you page by the time Shopify has told the payment server)
          return html(200, page('Takk for bestillingen', `<h1 id="thanks">Takk for bestillingen!</h1><p id="order">Bestilling ${esc(placed.name)}</p><p><a id="continue" href="/">Fortsett å handle</a></p>`));
        }
        const plan = cartOf.plan;
        return html(
          200,
          page(
            'Kassen',
            `<h1 id="amount">${esc(PRICES[plan].replace('.00', ''))} kr</h1><p id="what">Disputt – ${esc(plan)}</p>
<p id="attributes">${esc(cartOf.attributes.map((a) => `${a.name}: ${a.value}`).join('; '))}</p>
<form method="post" action="/checkouts/${checkout[1]}/pay"><button id="pay" style="font-size:20px;padding:12px 24px">Betal</button></form>
<p><a id="back" href="/">Tilbake til butikken</a></p>`,
          ),
        );
      }
      // ---- the shop's front page: the file that goes into Shopify, with the little Liquid it has filled in
      if (req.method === 'GET' && url.pathname === '/') {
        calls.push('/');
        // (the file has the game's real address in its link; here the game is on this machine)
        return html(200, page('Disputt', renderLiquid(FRONT.replaceAll('https://disputt.site/', env.SITE_URL), {})));
      }

      // ---- the payment server itself
      const remaining = failures.get(url.pathname) ?? 0;
      if (remaining > 0) {
        failures.set(url.pathname, remaining - 1);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'server', message: 'Noe gikk galt hos oss. Prøv igjen om litt.' }));
      }
      const headers = {};
      for (const [k, v] of Object.entries(req.headers)) if (!['host', 'connection', 'content-length'].includes(k) && typeof v === 'string') headers[k] = v;
      const response = await worker.fetch(new Request(url, { method: req.method, headers, body: body ?? undefined }), env);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (err) {
      console.error('shop stack:', err);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(String(err));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  env.SHOP_URL = origin;

  return {
    apiUrl: origin,
    shop: origin,
    publicKey,
    env,
    db,
    orders,
    calls,
    carts,
    setSite: (url) => {
      env.SITE_URL = url;
    },
    /** The next `count` calls to this path of the payment server fail (a server that is down). */
    failNext: (pathname, count = 1) => failures.set(pathname, count),
    /** Shopify takes the money and keeps quiet about it until `release()`. */
    hold: () => {
      holding = true;
    },
    release: async () => {
      holding = false;
      for (const [topic, payload] of held.splice(0)) await deliver(topic, payload);
    },
    refund: (placed, amount = PRICES[PLAN_OF[placed.line_items[0].variant_id]]) => deliver('refunds/create', refund(placed.id, amount)),
    cancel: (placed) => deliver('orders/cancelled', placed),
    dispute: (placed) => deliver('disputes/create', dispute(placed.id)),
    stop: async () => {
      server.closeAllConnections?.();
      server.close();
    },
  };
}
