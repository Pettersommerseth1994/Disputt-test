// Disputt payments, the Shopify edition: the small server between the game and a Shopify shop. One file, no dependencies, made for
// a Cloudflare Worker (paste it into the dashboard's editor; docs/SHOPIFY.md has every step). payments/worker.js is the Stripe
// edition; the game talks to either the same way, and only one of the two is set up.
//
// Shopify's own checkout takes the payment (Vipps, Apple Pay, cards). The game sends the host there in a new tab with a cart link
// that carries a code the page has made up (a cart attribute called "kode"). When the order is paid, Shopify calls this Worker (a
// webhook), which writes down "this code was paid, for this package, at this time". The game then asks for the pass with the code.
//
//   GET  /shop            { shop, variants }      where the game sends the host: the shop's address and the packages' variant ids
//   POST /restore         { code }                has this code been paid? returns the pass. The page asks while the host pays in the
//                                                 other tab, and a customer on a new phone asks with the code from the e-mail
//   POST /shopify/webhook                         Shopify says that an order was paid, cancelled or refunded (signed: nobody else gets in)
//   GET  /health                                  { ok, provider, mode: "test" | "live", set }   (to check the set-up; no secrets)
//
// A pass is a JWT signed with ES256; the page checks it with the matching public key (public/js/pay/pass.js). What the end of
// the access is (12 hours, a year, never) is decided here and signed into the pass; Shopify only says what was paid, and when.
// Only the order id, the code, the package, the times (of the payment and of the consent) and the amount are kept: no names, no e-mail
// addresses. An order counts only if it carries the consent to getting the access at once (the cart attribute "samtykke"): without it
// the right of withdrawal would not end with the delivery, so nothing is delivered until a person has looked at the order.
//
// Settings (Worker > Settings > Variables and secrets, and Bindings):
//   DB                      binding  a D1 database (empty: the Worker makes its own tables)
//   SHOPIFY_WEBHOOK_SECRET  secret   the signing secret shown on Shopify's Settings > Notifications > Webhooks
//   JWT_PRIVATE_KEY         secret   the private signing key, base64 of the PKCS#8 DER (docs/BETALING.md shows how to make it)
//   SITE_URL                text     where the game lives, e.g. https://disputt.site/
//   SHOP_URL                text     the shop, e.g. https://shop.disputt.site
//   VARIANT_EVENING, VARIANT_YEAR, VARIANT_LIFETIME   text   the variant ids of the three products (numbers)
//   ACCEPT_TEST_ORDERS      text     optional: "true" while testing with Shopify's test mode, so that test orders count. Never in live use.

/** One calendar year after `seconds` (the same day and time, UTC; a year bought on 29 February ends on 1 March). */
function plusOneYear(seconds) {
  const d = new Date(seconds * 1000);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return Math.floor(d.getTime() / 1000);
}

/**
 * The packages. `ends(paidAt)` is when the access ends, in seconds, for an order paid at `paidAt` (seconds); null means never.
 * `rank` says which one wins when an order holds more than one (the cart link can be edited by whoever holds it).
 */
const PLANS = {
  evening: { name: 'En kveld', rank: 1, ends: (paidAt) => paidAt + 12 * 3600 },
  year: { name: 'For ett år', rank: 2, ends: plusOneYear },
  lifetime: { name: 'Livstid', rank: 3, ends: () => null },
};

const VARIANT_VARS = { evening: 'VARIANT_EVENING', year: 'VARIANT_YEAR', lifetime: 'VARIANT_LIFETIME' };
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const te = new TextEncoder();
const MAX_WEBHOOK_BYTES = 1_000_000;
const MIN_SECRET = 16; // (Shopify's signing secrets are much longer: a short one is somebody's placeholder, and anybody could sign with it)

class HttpError extends Error {
  constructor(status, code, message, detail) {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}
const bad = (message) => new HttpError(400, 'bad_request', message);

// ------------------------------------------------------------------------------------------------ small helpers

function bytesToB64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const b64ToBytes = (text) => Uint8Array.from(atob(String(text).replace(/\s+/g, '')), (c) => c.charCodeAt(0));

/** A key that was pasted as PEM ("-----BEGIN PRIVATE KEY-----") is fine too. */
const keyBytes = (text) => b64ToBytes(String(text).replace(/-----[A-Z ]+-----/g, ''));

/** What a person typed, as the canonical code, or null (forgives case, spaces, dashes and O/I/L typed for 0/1/1). */
function normalizeCode(input) {
  const raw = String(input ?? '')
    .toUpperCase()
    .replace(/[\s\-–—_.]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (raw.length !== 12 || [...raw].some((c) => !CODE_ALPHABET.includes(c))) return null;
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
}

const siteUrl = (env) => {
  let u;
  try {
    u = new URL(env.SITE_URL);
  } catch {
    throw new HttpError(503, 'unavailable', 'Betalingen er ikke satt opp riktig (SITE_URL mangler).');
  }
  if (!u.pathname.endsWith('/')) u.pathname += '/';
  u.search = '';
  u.hash = '';
  return u;
};

/** The shop's own address (no path): where the host is sent to pay. (Plain http is only for a pretend shop on this machine, in the tests.) */
function shopOrigin(env) {
  let u = null;
  try {
    u = new URL(env.SHOP_URL);
  } catch {
    /* reported below */
  }
  const local = u?.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u?.protocol !== 'https:' && !local) throw new HttpError(503, 'unavailable', 'Betalingen er ikke satt opp riktig (SHOP_URL må være butikkens adresse, https://…).');
  return u.origin;
}

const testOrders = (env) => String(env.ACCEPT_TEST_ORDERS).toLowerCase() === 'true';

/** The variant id of each package, as text; the ones that are not set (or not numbers) are left out. */
function variantIds(env) {
  const ids = {};
  for (const [plan, name] of Object.entries(VARIANT_VARS)) {
    const id = String(env[name] ?? '').trim();
    if (/^\d{5,20}$/.test(id)) ids[plan] = id;
  }
  return ids;
}

// ------------------------------------------------------------------------------------------------ passes

/**
 * Signs a pass for an order. `paidAt` is in seconds. `aud` is this payment server's own address: a pass is only good for the page that
 * is set up with this server, so a pass from a test server is no use on the live page even if the two were given the same key.
 */
async function signPass(env, { plan, paidAt, issuedAt, aud }) {
  if (!env.JWT_PRIVATE_KEY) throw new HttpError(503, 'unavailable', 'Betalingen er ikke satt opp ennå (JWT_PRIVATE_KEY mangler).');
  const end = PLANS[plan].ends(paidAt);
  const payload = { iss: 'disputt', ...(aud ? { aud } : {}), plan, pa: paidAt, iat: issuedAt, ...(end === null ? {} : { exp: end }) };
  let key;
  try {
    key = await crypto.subtle.importKey('pkcs8', keyBytes(env.JWT_PRIVATE_KEY), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  } catch {
    throw new HttpError(503, 'unavailable', 'Betalingen er ikke satt opp riktig (JWT_PRIVATE_KEY kan ikke leses).');
  }
  const head = bytesToB64url(te.encode(JSON.stringify({ alg: 'ES256', typ: 'JWT' })));
  const body = bytesToB64url(te.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(`${head}.${body}`)));
  return { token: `${head}.${body}.${bytesToB64url(sig)}`, expiresAt: payload.exp === undefined ? null : payload.exp * 1000 };
}

// ------------------------------------------------------------------------------------------------ the database

const SCHEMA = [
  // one row per paid order. `code` is what the buyer carried in the cart; the same code can in theory sit on more than one order
  // (a cart link that is paid twice), so it is not unique. `state`: paid | refunded | cancelled | disputed. Amounts are in øre (of
  // `currency`), the times in seconds: `consented_at` is when the host agreed to getting the access at once.
  `CREATE TABLE IF NOT EXISTS orders (
    order_id TEXT PRIMARY KEY, code TEXT NOT NULL, plan TEXT NOT NULL, paid_at INTEGER NOT NULL, consented_at INTEGER NOT NULL, amount INTEGER NOT NULL,
    currency TEXT NOT NULL, name TEXT NOT NULL, test INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'paid', refunded INTEGER NOT NULL DEFAULT 0
  )`,
  'CREATE INDEX IF NOT EXISTS orders_code ON orders (code)',
  // what has been refunded, and what has been stopped (cancelled, disputed): Shopify does not promise to say things in the order they
  // happened, so a refund or a cancel can come before the order is written down. These are looked at when the order comes.
  'CREATE TABLE IF NOT EXISTS refunds (refund_id TEXT PRIMARY KEY, order_id TEXT NOT NULL, amount INTEGER NOT NULL, currency TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS stops (order_id TEXT PRIMARY KEY, state TEXT NOT NULL)',
];
const prepared = new WeakSet(); // (the databases whose tables are known to be there)

/** The database, with the tables made. A binding that is missing says so in words. */
async function database(env) {
  if (typeof env.DB?.prepare !== 'function') throw new HttpError(503, 'unavailable', 'Betalingen er ikke satt opp ennå (databasen DB mangler).');
  if (!prepared.has(env.DB)) {
    await env.DB.batch(SCHEMA.map((sql) => env.DB.prepare(sql)));
    prepared.add(env.DB);
  }
  return env.DB;
}

/** Adds up what has been refunded on an order (in its own currency; a refund that does not say which counts), and marks the order refunded once all of it is. */
const applyRefunds = (db, orderId) =>
  db
    .prepare(
      `UPDATE orders SET
         refunded = (SELECT COALESCE(SUM(amount), 0) FROM refunds WHERE refunds.order_id = orders.order_id AND (refunds.currency = orders.currency OR refunds.currency = '')),
         state = CASE WHEN state = 'paid' AND amount > 0 AND (SELECT COALESCE(SUM(amount), 0) FROM refunds WHERE refunds.order_id = orders.order_id AND (refunds.currency = orders.currency OR refunds.currency = '')) >= amount
                      THEN 'refunded' ELSE state END
       WHERE order_id = ?`,
    )
    .bind(orderId);

/** An order that has been cancelled or disputed stays stopped, also when the call about the paid order only comes after that. */
const applyStops = (db, orderId) =>
  db
    .prepare(
      `UPDATE orders SET state = (SELECT state FROM stops WHERE stops.order_id = orders.order_id)
       WHERE order_id = ? AND state = 'paid' AND EXISTS (SELECT 1 FROM stops WHERE stops.order_id = orders.order_id)`,
    )
    .bind(orderId);

// ------------------------------------------------------------------------------------------------ Shopify's webhooks

const toOre = (text) => {
  const n = Math.round(Number(text) * 100);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const toSeconds = (text) => {
  const t = Date.parse(text);
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
};
const ignored = (why) => ({ ok: true, ignored: why });

/** Checks Shopify's signature: HMAC-SHA256 of the body with the signing secret, in base64, in the X-Shopify-Hmac-Sha256 header. */
async function checkSignature(env, bytes, header) {
  if (String(env.SHOPIFY_WEBHOOK_SECRET ?? '').length < MIN_SECRET) throw new HttpError(503, 'unavailable', 'Betalingen er ikke satt opp ennå (SHOPIFY_WEBHOOK_SECRET mangler, eller er for kort).');
  let sig = null;
  try {
    sig = b64ToBytes(header ?? '');
  } catch {
    /* not base64: no signature */
  }
  const key = await crypto.subtle.importKey('raw', te.encode(env.SHOPIFY_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  if (!sig || sig.length !== 32 || !(await crypto.subtle.verify('HMAC', key, sig, bytes))) throw new HttpError(401, 'bad_signature', 'Ugyldig signatur.');
}

/** An order was paid: writes down the code, the package and the time (once: Shopify calls again if it does not hear back). */
async function orderPaid(env, order) {
  if (order.test === true && !testOrders(env)) return ignored('test_order');
  if (order.cancelled_at) return ignored('cancelled');
  if (order.financial_status !== 'paid') return ignored('not_paid');
  const ids = variantIds(env);
  const plansByVariant = new Map(Object.entries(ids).map(([plan, id]) => [id, plan]));
  if (plansByVariant.size === 0) throw new HttpError(503, 'unavailable', 'Betalingen er ikke satt opp ennå (VARIANT_EVENING, VARIANT_YEAR og VARIANT_LIFETIME mangler).');
  const lines = Array.isArray(order.line_items) ? order.line_items : [];
  const plan = lines
    .map((line) => plansByVariant.get(String(line?.variant_id)))
    .filter(Boolean)
    .sort((a, b) => PLANS[b].rank - PLANS[a].rank)[0];
  if (!plan) return ignored('no_package'); // (an order for something else in the same shop)
  const attributes = Array.isArray(order.note_attributes) ? order.note_attributes : [];
  const code = normalizeCode(attributes.find((a) => String(a?.name).toLowerCase() === 'kode')?.value);
  if (!code) {
    console.error('Order', order.name, 'was paid for a package but has no code, so nobody can claim it');
    return ignored('no_code');
  }
  // The host agreed to getting the access at once (and so to the right of withdrawal ending) in the game, before the shop. Without
  // that, the order is not delivered: a person has to look at it.
  const consentedAt = toSeconds(attributes.find((a) => String(a?.name).toLowerCase() === 'samtykke')?.value);
  if (consentedAt === null) {
    console.error('Order', order.name, 'was paid for a package but without the consent to getting the access at once, so no access is given');
    return ignored('no_consent');
  }
  const orderId = String(order.id);
  const paidAt = toSeconds(order.processed_at) ?? toSeconds(order.created_at) ?? Math.floor(Date.now() / 1000); // (Shopify's time, not the time the call arrives)
  const db = await database(env);
  await db.batch([
    db
      .prepare('INSERT INTO orders (order_id, code, plan, paid_at, consented_at, amount, currency, name, test) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (order_id) DO NOTHING')
      .bind(orderId, code, plan, paidAt, consentedAt, toOre(order.current_total_price ?? order.total_price), String(order.currency ?? ''), String(order.name ?? ''), order.test === true ? 1 : 0),
    applyRefunds(db, orderId), // (a refund or a cancel that came before the order, if Shopify's calls arrived in the wrong order)
    applyStops(db, orderId),
  ]);
  return { ok: true };
}

/** Writes down that an order is stopped, and stops it if it is there. */
async function stop(env, orderId, state) {
  const db = await database(env);
  await db.batch([db.prepare('INSERT INTO stops (order_id, state) VALUES (?, ?) ON CONFLICT (order_id) DO NOTHING').bind(orderId, state), applyStops(db, orderId)]);
  return { ok: true };
}

const orderCancelled = (env, order) => stop(env, String(order.id), 'cancelled');

/** A refund: all of it, and the order stops giving out passes. A part of it (a goodwill refund) does not take the access away. */
async function refundCreated(env, refund) {
  // (a refund through a payment app is "pending" until it clears: the customer is being paid back, so the code stops at once)
  const paid = (Array.isArray(refund.transactions) ? refund.transactions : []).filter((t) => t?.kind === 'refund' && ['success', 'pending'].includes(t?.status));
  const amount = paid.reduce((sum, t) => sum + toOre(t.amount), 0);
  if (!refund.id || !refund.order_id || amount <= 0) return ignored('nothing_refunded');
  const db = await database(env);
  const orderId = String(refund.order_id);
  await db.batch([
    db.prepare('INSERT INTO refunds (refund_id, order_id, amount, currency) VALUES (?, ?, ?, ?) ON CONFLICT (refund_id) DO NOTHING').bind(String(refund.id), orderId, amount, String(paid[0].currency ?? '')),
    applyRefunds(db, orderId),
  ]);
  return { ok: true };
}

async function disputeCreated(env, dispute) {
  if (!dispute.order_id) return ignored('no_order');
  return stop(env, String(dispute.order_id), 'disputed');
}

const TOPICS = { 'orders/paid': orderPaid, 'orders/cancelled': orderCancelled, 'refunds/create': refundCreated, 'disputes/create': disputeCreated };

async function webhook(request, env) {
  if (Number(request.headers.get('Content-Length')) > MAX_WEBHOOK_BYTES) throw new HttpError(413, 'too_large', 'For stor forespørsel.');
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_WEBHOOK_BYTES) throw new HttpError(413, 'too_large', 'For stor forespørsel.');
  await checkSignature(env, bytes, request.headers.get('X-Shopify-Hmac-Sha256'));
  const topic = request.headers.get('X-Shopify-Topic') ?? '';
  const handler = Object.hasOwn(TOPICS, topic) ? TOPICS[topic] : null;
  if (!handler) return ignored('topic');
  let data = null;
  try {
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    /* reported below */
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw bad('Ugyldig innhold.');
  return handler(env, data);
}

// ------------------------------------------------------------------------------------------------ the endpoints

async function readJson(request) {
  try {
    const data = await request.json();
    if (data && typeof data === 'object') return data;
  } catch {
    /* fall through */
  }
  throw bad('Ugyldig forespørsel.');
}

/** Where to send the host, and which variant is which package. The page builds the cart link from this, in the tap that opens the tab. */
function shop(env) {
  const ids = variantIds(env);
  for (const [plan, name] of Object.entries(VARIANT_VARS)) if (!ids[plan]) throw new HttpError(503, 'unavailable', `Betalingen er ikke satt opp ennå (${name} mangler).`);
  return { shop: shopOrigin(env), variants: ids };
}

/** When the access of an order ends, in milliseconds since 1970 (Infinity for a lifetime package). */
const endsAt = (order) => {
  const end = PLANS[order.plan].ends(order.paid_at);
  return end === null ? Infinity : end * 1000;
};
const longestFirst = (a, b) => (endsAt(a) < endsAt(b) ? 1 : endsAt(a) > endsAt(b) ? -1 : 0);
const SAYS = {
  refunded: 'Denne betalingen er refundert, så koden gjelder ikke lenger.',
  disputed: 'Denne betalingen er bestridt hos kortutstederen, så koden gjelder ikke lenger.',
  cancelled: 'Denne bestillingen er kansellert, så koden gjelder ikke lenger.',
};

/**
 * From the orders that carry a code to the pass: the one that lasts longest of those that still count. A refunded, cancelled or
 * disputed order, or a package that has run out, gives nothing (and says why, if there is nothing else).
 */
async function passForOrders(env, orders, aud, now = Date.now()) {
  const alive = orders.filter((o) => o.state === 'paid' && endsAt(o) > now).sort(longestFirst);
  if (alive.length === 0) {
    const latest = [...orders].sort((a, b) => b.paid_at - a.paid_at)[0];
    if (latest.state !== 'paid') throw new HttpError(410, latest.state, SAYS[latest.state] ?? 'Denne koden gjelder ikke lenger.');
    throw new HttpError(410, 'expired', `Tilgangen «${PLANS[latest.plan].name}» har gått ut.`);
  }
  const order = alive[0];
  const { token, expiresAt } = await signPass(env, { plan: order.plan, paidAt: order.paid_at, issuedAt: Math.floor(now / 1000), aud });
  return { token, code: order.code, plan: order.plan, paidAt: order.paid_at * 1000, expiresAt };
}

async function ordersFor(env, code) {
  const db = await database(env);
  return (await db.prepare('SELECT * FROM orders WHERE code = ?').bind(code).all()).results ?? [];
}

async function restore(request, env) {
  const body = await readJson(request);
  const code = normalizeCode(body.code);
  if (!code) throw bad('Koden ser ikke riktig ut. Den har tolv tegn, som K7M2-9QXD-4TRB.');
  const orders = await ordersFor(env, code);
  // (Shopify can need a moment to say that the order is paid: the page asks again until it does)
  if (orders.length === 0) throw new HttpError(404, 'not_found', 'Fant ingen betaling med den koden. Har du nettopp betalt, kan det gå et øyeblikk før koden virker.');
  return passForOrders(env, orders, new URL(request.url).origin);
}

/** What is set and what is not, so that a person setting this up can see it (true or false, never the values). */
async function health(env) {
  const set = { database: false, webhookSecret: String(env.SHOPIFY_WEBHOOK_SECRET ?? '').length >= MIN_SECRET, signingKey: false, shop: false, ...Object.fromEntries(Object.keys(VARIANT_VARS).map((p) => [p, Boolean(variantIds(env)[p])])) };
  try {
    await (await database(env)).prepare('SELECT 1 AS ok').first();
    set.database = true;
  } catch {
    /* stays false */
  }
  try {
    await signPass(env, { plan: 'lifetime', paidAt: 0, issuedAt: 0 });
    set.signingKey = true;
  } catch {
    /* stays false */
  }
  let shopUrl = null;
  try {
    shopUrl = shopOrigin(env);
    set.shop = true;
  } catch {
    /* stays false */
  }
  return { ok: true, provider: 'shopify', mode: testOrders(env) ? 'test' : 'live', site: siteUrl(env).href, shop: shopUrl, set };
}

// ------------------------------------------------------------------------------------------------ routing and CORS

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = siteUrl(env).origin;
  const headers = { Vary: 'Origin', 'Cache-Control': 'no-store' };
  if (origin && origin === allowed) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    headers['Access-Control-Max-Age'] = '86400';
  }
  return headers;
}

function json(status, data, request, env) {
  let cors = { Vary: 'Origin', 'Cache-Control': 'no-store' };
  try {
    cors = corsHeaders(request, env);
  } catch {
    /* a missing SITE_URL is reported by the endpoint itself */
  }
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors } });
}

async function route(request, env) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  if (origin && origin !== siteUrl(env).origin) throw new HttpError(403, 'forbidden_origin', 'Denne siden har ikke lov til å bruke betalingen.');
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });

  if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) return json(200, await health(env), request, env);
  if (request.method === 'GET' && url.pathname === '/shop') return json(200, shop(env), request, env);
  if (request.method === 'POST' && url.pathname === '/restore') return json(200, await restore(request, env), request, env);
  if (request.method === 'POST' && url.pathname === '/shopify/webhook') return json(200, await webhook(request, env), request, env);
  throw new HttpError(404, 'not_found', 'Fant ikke siden.');
}

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (err) {
      if (err instanceof HttpError) {
        const body = { error: err.code, message: err.message };
        if (err.detail && testOrders(env)) body.detail = err.detail; // (only while testing)
        return json(err.status, body, request, env);
      }
      console.error('Unexpected error:', err);
      return json(500, { error: 'server', message: 'Noe gikk galt hos oss. Prøv igjen om litt.' }, request, env);
    }
  },
};
