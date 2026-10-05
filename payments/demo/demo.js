// The payment demo: a payment server and a pretend Stripe that live in the page itself, so that payments and "Logg inn" can be tried
// on a phone without a Stripe account or a Cloudflare Worker (docs/BETALING.md, "Demo uten Stripe"). It is the real payment server
// (payments/worker.js, copied to demo/worker.js) behind the pretend Stripe of the tests (tools/qa/fakestripe.mjs), with the state
// kept in localStorage. What is pretended: Stripe and its page (demo/checkout.html). Nothing leaves the browser, no money moves.
//
// One limit comes with it: the "server" is this browser. A code works on the phone that paid, not on another one.
//
// Copied to <site>/demo/demo.js when the build switches the demo on (tools/pages/build.mjs); not part of an ordinary build.
import { CHECKOUT_BASE, loadKeys, loadStripe, saveStripe, storageWorks } from './state.js';
import worker from './worker.js';

/** Where the page believes the payment server is, and where the payment server believes Stripe is. Neither name exists. */
export const API = 'https://pay.demo.invalid';
export const STRIPE = 'https://stripe.demo.invalid';

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * Starts the demo: from now on, `fetch` answers for the payment server and for Stripe. Resolves to the payment settings the page
 * should use (the same shape as a real build's), or null when this browser cannot keep anything.
 * `storage`, `host` (whose `fetch` is taken over) and `siteUrl` (the game's own address, with a slash at the end) are for the tests.
 */
export async function startDemo(cfg = {}, { storage = globalThis.localStorage, host = globalThis, siteUrl = new URL('../', import.meta.url).href } = {}) {
  if (!storageWorks(storage)) return null;
  const keys = await loadKeys(storage);
  const methods = cfg.methods?.length ? cfg.methods : ['applepay'];
  const site = new URL(siteUrl).href;
  const env = {
    STRIPE_KEY: loadStripe(storage).key,
    JWT_PRIVATE_KEY: keys.privateKey,
    SITE_URL: site,
    PRICE_EVENING: 'price_evening',
    PRICE_YEAR: 'price_year',
    PRICE_LIFETIME: 'price_lifetime',
    VIPPS_ENABLED: methods.includes('vipps') ? 'true' : 'false',
    // the box about the right of withdrawal, as on the real payment page (the link needs an https address)
    REQUIRE_TERMS: 'true',
    ...(site.startsWith('https:') ? { TERMS_URL: `${site}vilkar.html` } : {}),
    STRIPE_API_BASE: STRIPE,
  };

  const realFetch = host.fetch.bind(host);
  host.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : (input?.url ?? String(input));
    if (url.startsWith(`${STRIPE}/`)) {
      // (afresh every time: the pretend payment page, in this or another tab, may have changed it)
      const fake = loadStripe(storage);
      const { status, body } = fake.handle(init.method ?? 'GET', url, init.body ?? null, init.headers ?? {});
      if (body?.url) body.url = body.url.replace(`${CHECKOUT_BASE}/c/pay/`, `${site}demo/checkout.html?s=`);
      saveStripe(storage, fake);
      return json(status, body);
    }
    if (url === API || url.startsWith(`${API}/`)) return worker.fetch(new Request(url, init), env);
    return realFetch(input, init);
  };

  if (typeof document !== 'undefined') mark(document);
  return {
    apiUrl: API,
    publicKey: keys.publicKey,
    methods,
    freeRounds: cfg.freeRounds,
    ...(cfg.termsUrl ? { termsUrl: cfg.termsUrl } : {}),
    ...(cfg.privacyUrl ? { privacyUrl: cfg.privacyUrl } : {}),
  };
}

/** Says on every screen that this is a demo, so that nobody takes it for the real thing. */
function mark(doc) {
  doc.documentElement.dataset.demo = '';
  doc.title = `${doc.title} (demo)`;
  const css = doc.createElement('link');
  css.rel = 'stylesheet';
  css.href = new URL('demo.css', import.meta.url).href;
  doc.head.append(css);
  const badge = doc.createElement('div');
  badge.className = 'demo-badge';
  badge.setAttribute('aria-hidden', 'true');
  badge.textContent = 'DEMO · ingen ekte betaling';
  doc.body.append(badge);
  previewDock(doc);
}

/**
 * Proposals for the bar at the bottom of the screen (payments/demo/dock-preview.css), to try on a phone: ?dock=a, ?dock=b or ?dock=c,
 * kept in this tab; ?dock=0 turns them off. Temporary: when one is chosen it moves into css/base.css and this goes.
 */
function previewDock(doc) {
  let pick = new URLSearchParams(location.search).get('dock');
  try {
    if (pick !== null) sessionStorage.setItem('disputt:demo:dock', pick);
    else pick = sessionStorage.getItem('disputt:demo:dock');
  } catch {
    /* no storage: the proposal then only lasts for this page */
  }
  if (!['a', 'b', 'c'].includes(pick)) return;
  doc.documentElement.dataset.dock = pick;
  const css = doc.createElement('link');
  css.rel = 'stylesheet';
  css.href = new URL('dock-preview.css', import.meta.url).href;
  doc.head.append(css);
}
