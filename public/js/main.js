import { App } from './app.js';
import { actions, connect, dropSession, reconnectNow } from './net.js';
import { asset } from './paths.js';
import { initPayments, handlePaymentReturn } from './pay/payments.js';
import { initShop, setKnownShop } from './pay/shop.js';
import { config, isP2P } from './settings.js';
import { html, render } from './vendor/htm-preact.js';
import { setStore, store } from './store.js';

// QR-code link (?j=ABCD, or the older /j/ABCD): join that room, unless this tab already belongs to it (then we resume).
if (store.route.page === 'join') {
  if (store.session && store.session.code !== store.route.code) dropSession();
  if (!store.session) actions.join(store.route.code);
}

const debug = new URLSearchParams(location.search).get('debug'); // QA only: ?debug (hook) or ?debug=offline (no socket)
if (debug !== 'offline') connect();

// Payments (off unless the build switched them on): check the pass on this phone, and take care of a host who is back from Stripe,
// or whose payment in the Shopify shop is still being waited for.
const startPayments = (cfg) =>
  initPayments(cfg)
    .then(() => handlePaymentReturn())
    .then(() => initShop())
    .catch(() => {});
if (config.payments?.demo) {
  // A demo build (a test copy, docs/BETALING.md "Demo uten Stripe") has no payment server: the page runs a pretend one (demo/demo.js).
  import(new URL('../demo/demo.js', import.meta.url).href)
    .then((demo) => demo.startDemo(config.payments))
    .catch(() => null)
    .then(startPayments);
} else {
  startPayments(config.payments);
}

// Phones sleep and drop sockets: come back to life as soon as the page is visible or online again.
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && reconnectNow());
window.addEventListener('online', reconnectNow);
window.addEventListener('pageshow', (e) => e.persisted && reconnectNow());

// Only our own Node server has /api/info (LAN addresses for the QR code). Static hosting does not.
if (!isP2P && !config.serverUrl) {
  fetch(asset('api/info'))
    .then((r) => r.json())
    .then((info) => setStore({ info }))
    .catch(() => {});
}

// Dev/QA hook: lets screenshots and tests inject a view without a game.
if (debug !== null) window.__disputt = { store, setStore, setShop: setKnownShop };

const root = document.getElementById('app');
root.replaceChildren(); // drop the boot splash; Preact would otherwise leave it in place below the app
render(html`<${App} />`, root);
