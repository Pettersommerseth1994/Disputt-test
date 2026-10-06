// What the page does around a payment in the Shopify shop (public/js/pay/shop.js): the new tab, the code that goes with it, asking
// whether it was paid, and the cases where the host comes back some other way. The browser is stood in for here; the payment server
// is the real one (payments/worker-shopify.js), with a pretend Shopify and a pretend database. tools/qa/play.mjs --pay-shopify plays the
// same thing in a real browser, with a pretend shop that is a page of its own.
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { VARIANTS, mod, setupShopify } from './helpers/shopify.mjs';

// ---- a pretend browser (the page modules read these when they are loaded, so this comes first)
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
const timers = new Map(); // what the page has asked to be called later: id -> { fn, ms }
let lastTimer = 0;
globalThis.setTimeout = (fn, ms) => {
  timers.set(++lastTimer, { fn, ms });
  return lastTimer;
};
globalThis.clearTimeout = (id) => void timers.delete(id);
/** The moment the page's timers go off: runs each of them once (what they set up in turn waits for the next call). */
const ring = async () => {
  for (const [id, timer] of [...timers]) {
    timers.delete(id);
    await timer.fn();
  }
};
const memory = () => {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
    clear: () => data.clear(),
    has: (k) => data.has(k),
  };
};
const SITE = 'https://site.test/Disputt/';
const PAY_SERVER = 'https://pay.test';
const events = []; // what happened, in order
const listeners = [];
let tabs = true; // does the browser open a new tab? (false: it refuses, like a pop-up blocker)
globalThis.sessionStorage = memory();
globalThis.localStorage = memory();
globalThis.location = { hostname: 'site.test', search: '', pathname: '/Disputt/', hash: '', assign: (url) => events.push(['assign', url]) };
globalThis.window = {
  location: globalThis.location,
  scrollTo() {},
  open: (url, target) => {
    events.push(['open', url, target]);
    return tabs ? { close: () => events.push(['close', url]) } : null;
  },
};
globalThis.history = { replaceState() {} };
globalThis.document = { visibilityState: 'visible', addEventListener: (type, fn) => listeners.push([type, fn]) };
globalThis.addEventListener = (type, fn) => listeners.push([type, fn]);
const fire = (type, event = {}) => Promise.all(listeners.filter(([t]) => t === type).map(([, fn]) => fn(event)));

/** The payment server, as the page reaches it: the real Worker, asked from the game's own site; and what it was asked, in order. */
let t;
const asked = [];
let offline = 0; // how many of the next calls fail, as when the line is bad
globalThis.fetch = async (url, init = {}) => {
  asked.push({ url: String(url), method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : undefined });
  if (offline > 0) {
    offline--;
    throw new TypeError('Failed to fetch');
  }
  return mod.worker.fetch(new Request(String(url), { ...init, headers: { ...(init.headers ?? {}), Origin: 'https://site.test' } }), t.env);
};

let pay;
let away;
let store;
let shop;
let imports = 0;
const CODE_FORMAT = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;
const PASS_KEY = `disputt:pass:${PAY_SERVER}`;

before(async () => {
  pay = await import('../public/js/pay/payments.js');
  away = await import('../public/js/pay/away.js');
  store = (await import('../public/js/store.js')).store;
});
after(() => {
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
});

const settings = () => ({ provider: 'shopify', apiUrl: `${PAY_SERVER}/`, publicKey: t.keys.publicKey, freeRounds: 2, termsUrl: 'https://site.test/vilkar', privacyUrl: 'https://site.test/personvern' });
const opened = () => events.filter((e) => e[0] === 'open');
const flush = () => new Promise((resolve) => setImmediate(resolve)); // (what is waiting to run, runs)
/** The code in the cart link of the tab that was opened last. */
const codeInTab = () => new URL(opened().at(-1)[1]).searchParams.get('attributes[kode]');

beforeEach(async () => {
  t = await setupShopify({ SITE_URL: SITE });
  sessionStorage.clear();
  localStorage.clear();
  listeners.length = 0;
  timers.clear();
  events.length = 0;
  asked.length = 0;
  offline = 0;
  tabs = true;
  document.visibilityState = 'visible';
  away.setAwayAnnouncer(null);
  Object.assign(store, { payments: null, pass: null, passCode: null, paywall: true, payBusy: false, payWaiting: null, sheet: null, toast: null, view: null });
  shop = await import(`../public/js/pay/shop.js?test=${++imports}`); // (a fresh copy each time: it remembers the shop it was told about)
  await pay.initPayments(settings());
});

/** The host's whole trip to the shop and back, up to the moment the shop has said "paid". */
async function startAndPay(plan = 'year', options = {}) {
  await shop.loadShop();
  shop.startShopCheckout(plan);
  const code = codeInTab();
  const res = await t.pay({ plan, code, ...options });
  assert.equal(res.res.status, 200);
  return { code, order: res.order };
}

describe('the settings', () => {
  it('say who takes the money: Stripe, unless the build says Shopify', () => {
    assert.equal(pay.paymentSettings({ apiUrl: 'https://pay.test', publicKey: 'k' }, {}).provider, 'stripe');
    assert.equal(pay.paymentSettings({ apiUrl: 'https://pay.test', publicKey: 'k', provider: 'shopify' }, {}).provider, 'shopify');
    assert.equal(pay.paymentSettings({ apiUrl: 'https://pay.test', publicKey: 'k', provider: 'paypal' }, {}).provider, 'stripe', 'what it does not know is Stripe');
    assert.equal(store.payments.provider, 'shopify');
  });
});

describe('the shop', () => {
  it('is asked for once, and says where to go and which variant is which package', async () => {
    const info = await shop.loadShop();
    assert.deepEqual(info, { shop: 'https://shop.example.test', variants: VARIANTS });
    await shop.loadShop();
    assert.equal(asked.filter((a) => a.url.endsWith('/shop')).length, 1);
    assert.equal(shop.knownShop(), info);
  });

  it('is asked for again after an answer that did not come, and not before', async () => {
    offline = 1;
    await assert.rejects(shop.loadShop(), (err) => err.code === 'network');
    assert.equal(shop.knownShop(), null);
    assert.equal((await shop.loadShop()).shop, 'https://shop.example.test');
  });

  it('is not trusted when it does not look like a shop: another address than https, or variants that are not numbers', async () => {
    for (const [what, patch] of [
      ['an address that is not https', { SHOP_URL: 'http://shop.example.test' }],
      ['not an address', { SHOP_URL: 'nonsense' }],
    ]) {
      Object.assign(t.env, patch);
      await assert.rejects(shop.loadShop(), Error, what);
    }
    Object.assign(t.env, { SHOP_URL: 'https://shop.example.test', VARIANT_YEAR: '12' });
    await assert.rejects(shop.loadShop(), Error, 'a variant that is not a number of the right size');
    // a server that answers with something the page does not accept (the Worker would not, so this is a server that is not ours)
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ shop: 'javascript:alert(1)', variants: VARIANTS }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    await assert.rejects(shop.loadShop(), (err) => err.message.includes('stoler'));
    globalThis.fetch = async () => new Response(JSON.stringify({ shop: 'https://evil.test', variants: { evening: '12345', year: '12345', lifetime: 'x' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    await assert.rejects(shop.loadShop(), Error);
    globalThis.fetch = realFetch;
    assert.equal(shop.knownShop(), null, 'nothing was kept from any of them');
  });
});

describe('the cart link', () => {
  it('puts the package in the cart and carries the code and the time of the consent along as cart attributes', () => {
    const url = new URL(shop.cartLink('https://shop.example.test', VARIANTS.year, 'K7M2-9QXD-4TRB', new Date('2026-10-06T08:15:00Z')));
    assert.equal(url.origin + url.pathname, `https://shop.example.test/cart/${VARIANTS.year}:1`);
    assert.equal(url.searchParams.get('attributes[kode]'), 'K7M2-9QXD-4TRB');
    assert.equal(url.searchParams.get('attributes[samtykke]'), '2026-10-06T08:15:00.000Z');
    assert.equal([...url.searchParams].length, 2, 'and nothing else');
  });

  it('writes the brackets of the attributes as Shopify\'s documentation does, not as %5B and %5D', () => {
    const link = shop.cartLink('https://shop.example.test', VARIANTS.year, 'K7M2-9QXD-4TRB', new Date('2026-10-06T08:15:00Z'));
    assert.equal(link, `https://shop.example.test/cart/${VARIANTS.year}:1?attributes[kode]=K7M2-9QXD-4TRB&attributes[samtykke]=2026-10-06T08%3A15%3A00.000Z`);
  });

  it('is made with a new code every time, 60 bits of the kind the pass code is', () => {
    const codes = new Set(Array.from({ length: 200 }, () => shop.newPayCode()));
    assert.equal(codes.size, 200);
    for (const code of codes) assert.match(code, CODE_FORMAT);
  });
});

describe('the tap that goes to pay', () => {
  it('opens the shop in a new tab at once, with the package in the cart, and starts waiting', async () => {
    await shop.loadShop();
    const told = [];
    away.setAwayAnnouncer((msg) => (told.push(msg), 2));
    const before = events.length;
    shop.startShopCheckout('year'); // (not awaited: the tab has to open inside the tap)
    assert.equal(events.length, before + 1, 'the tab was opened in the same breath');
    const [kind, url, target] = events.at(-1);
    assert.equal(kind, 'open');
    assert.equal(target, '_blank');
    const link = new URL(url);
    assert.equal(link.pathname, `/cart/${VARIANTS.year}:1`);
    assert.match(link.searchParams.get('attributes[kode]'), CODE_FORMAT);
    assert.deepEqual(told, [{ t: 'away', why: 'pay', ms: away.AWAY_MS }], 'the guests are told that the host is away to pay');
    assert.equal(store.payWaiting.plan, 'year');
    assert.equal(store.payWaiting.code, link.searchParams.get('attributes[kode]'));
    assert.equal(store.payWaiting.url, url);
    assert.ok(sessionStorage.has('disputt:shop'), 'and this tab remembers it');
    assert.ok([...timers.values()].some((timer) => timer.ms === shop.POLL.fastMs), 'and asks after a while');
  });

  it('tells the guests before it opens the tab, since the page may be put to sleep as soon as the shop is on top of it', async () => {
    await shop.loadShop();
    away.setAwayAnnouncer(() => (events.push(['told']), 1));
    shop.startShopCheckout('evening');
    assert.deepEqual(events.map((e) => e[0]), ['told', 'open']);
  });

  it('does nothing for a double tap, and opens the same cart, with the same code, for a later tap: the code that is waited for is the one that is paid', async () => {
    await shop.loadShop();
    shop.startShopCheckout('year');
    const first = { ...store.payWaiting };
    shop.startShopCheckout('lifetime'); // (a double tap: the first one is already on its way)
    assert.deepEqual({ ...store.payWaiting }, first);
    assert.equal(opened().length, 1, 'one tab, not two');
    store.payWaiting.at -= 2000;
    shop.startShopCheckout('lifetime'); // (a tap that comes later, before the bar has changed)
    assert.equal(opened().length, 2);
    assert.equal(opened()[1][1], opened()[0][1], 'the same cart again');
    assert.equal(store.payWaiting.code, first.code);
    const { res } = await t.pay({ plan: 'year', code: first.code });
    assert.equal(res.status, 200);
    await ring();
    assert.equal(store.sheet, 'thanks', 'and a payment in either of the two tabs is found');
  });

  it('chooses the variant of the package that was tapped, for each of the three', async () => {
    await shop.loadShop();
    for (const plan of ['evening', 'year', 'lifetime']) {
      shop.startShopCheckout(plan);
      assert.equal(new URL(opened().at(-1)[1]).pathname, `/cart/${VARIANTS[plan]}:1`, plan);
      shop.cancelShopPayment();
    }
  });

  it('does not start before the shop is known, and says so', () => {
    assert.throws(() => shop.startShopCheckout('year'), (err) => err.code === 'unavailable');
    assert.equal(opened().length, 0);
    assert.equal(store.payWaiting, null);
  });

  it('sends this tab to the shop when the browser refuses a new tab, with the room kept here', async () => {
    await shop.loadShop();
    tabs = false;
    shop.startShopCheckout('year');
    await flush();
    assert.equal(events.at(-1)[0], 'assign');
    assert.equal(events.at(-1)[1], store.payWaiting.url);
    assert.equal(timers.size, 0, 'and there is no page left to ask from');
    assert.ok(sessionStorage.has('disputt:shop'), 'so the page finds the payment when the host comes back');
  });

  it('leaves the page only after the guests have been told, when the browser refuses a new tab', async () => {
    await shop.loadShop();
    tabs = false;
    let sent = false;
    away.setAwayAnnouncer(() => ((sent = true), 0));
    shop.startShopCheckout('year');
    assert.equal(sent, true, 'told in the tap');
    assert.equal(events.some((e) => e[0] === 'assign'), false, 'and the page does not leave in the same breath');
    await flush();
    assert.equal(events.at(-1)[0], 'assign');
  });

  it('does not send a host away who would lose the game: no new tab, and a browser that keeps nothing', async () => {
    await shop.loadShop();
    tabs = false;
    store.view = { phase: 'summary' };
    const keep = globalThis.sessionStorage.setItem;
    globalThis.sessionStorage.setItem = () => {
      throw new Error('blocked');
    };
    assert.throws(() => shop.startShopCheckout('year'), (err) => err.code === 'storage');
    globalThis.sessionStorage.setItem = keep;
    assert.equal(events.filter((e) => e[0] === 'assign').length, 0);
    assert.equal(store.payWaiting, null);
  });
});

describe('asking whether it was paid', () => {
  it('keeps the pass and shows "Takk!" once Shopify has said that the order is paid, and not before', async () => {
    await shop.loadShop();
    shop.startShopCheckout('year');
    const code = codeInTab();
    await ring();
    assert.ok(store.payWaiting, 'not paid yet: still waiting');
    assert.equal(store.sheet, null);
    await t.pay({ plan: 'year', code });
    await ring();
    assert.equal(store.payWaiting, null);
    assert.equal(store.sheet, 'thanks');
    assert.equal(store.paywall, false);
    assert.equal(store.pass.plan, 'year');
    assert.equal(store.passCode, code);
    assert.ok(localStorage.has(PASS_KEY), 'the pass is kept on this phone, under the name of the payment server');
    assert.equal(JSON.parse(localStorage.getItem(PASS_KEY)).code, code);
    assert.ok(!sessionStorage.has('disputt:shop'), 'and the tab forgets what it was waiting for');
    assert.equal(timers.size, 0, 'and stops asking');
  });

  it('closes the shop\'s tabs when the payment is in: a tab that the page opened may be closed by it, whatever site is in it', async () => {
    await shop.loadShop();
    shop.startShopCheckout('year');
    shop.reopenShop(); // (a second tab for the same cart)
    const code = codeInTab();
    await ring();
    assert.equal(events.filter((e) => e[0] === 'close').length, 0, 'not before it is paid');
    await t.pay({ plan: 'year', code });
    await ring();
    assert.equal(events.filter((e) => e[0] === 'close').length, 2, 'both');
    await ring();
    assert.equal(events.filter((e) => e[0] === 'close').length, 2, 'and once');
  });

  it('does not close tabs when the host gives up, and a tab that does not want to close is no harm', async () => {
    await shop.loadShop();
    shop.startShopCheckout('year');
    shop.cancelShopPayment();
    assert.equal(events.filter((e) => e[0] === 'close').length, 0);
    const stubborn = window.open;
    window.open = (url, target) => (events.push(['open', url, target]), { close: () => { throw new Error('not allowed'); } });
    shop.startShopCheckout('year');
    await t.pay({ plan: 'year', code: codeInTab() });
    await ring();
    window.open = stubborn;
    assert.equal(store.sheet, 'thanks', 'the pass came all the same');
  });

  it('stops asking after two hours of waiting, though the page is still on screen', async () => {
    await shop.loadShop();
    shop.startShopCheckout('year');
    store.payWaiting.at -= 2 * 3600_000 + 1000;
    timers.clear();
    await shop.check();
    assert.equal(timers.size, 0, 'no more questions');
    assert.ok(store.payWaiting, 'but the screen still says what it waits for, and can be given up');
  });

  it('asks only with the code it made up, and nothing else', async () => {

    await shop.loadShop();
    shop.startShopCheckout('lifetime');
    await ring();
    const question = asked.at(-1);
    assert.equal(question.url, `${PAY_SERVER}/restore`);
    assert.equal(question.method, 'POST');
    assert.deepEqual(question.body, { code: codeInTab() });
  });

  it('asks every few seconds at first and then now and then, and keeps asking while the answer is "not yet"', async () => {
    await shop.loadShop();
    shop.startShopCheckout('evening');
    assert.equal([...timers.values()][0].ms, shop.POLL.fastMs);
    await ring();
    assert.equal([...timers.values()][0].ms, shop.POLL.fastMs, 'the host is probably paying right now');
    store.payWaiting.at -= shop.POLL.fastForMs + 1;
    await ring();
    assert.equal([...timers.values()][0].ms, shop.POLL.slowMs, 'after a few minutes it asks less often');
    assert.equal(asked.filter((a) => a.url.endsWith('/restore')).length, 2);
  });

  it('keeps asking when the line is bad or the payment server stumbles, and does not tell the host anything', async () => {
    const { code } = await startAndPay('evening');
    offline = 1;
    await ring();
    assert.ok(store.payWaiting);
    assert.equal(store.toast, null);
    t.db.failNext(1);
    const quiet = console.error;
    console.error = () => {};
    await ring();
    console.error = quiet;
    assert.ok(store.payWaiting, 'a server that says 500 is tried again');
    await ring();
    assert.equal(store.sheet, 'thanks', `and then it is through (${code})`);
  });

  it('does not ask while nobody looks at the page, and asks at once when somebody does', async () => {
    await shop.loadShop();
    shop.initShop();
    shop.startShopCheckout('year');
    document.visibilityState = 'hidden';
    await fire('visibilitychange');
    assert.equal(timers.size, 0, 'the timer is taken away when the tab is hidden');
    await ring();
    assert.equal(asked.filter((a) => a.url.endsWith('/restore')).length, 0);
    // the host pays in the other tab, and comes back
    await t.pay({ plan: 'year', code: codeInTab() });
    document.visibilityState = 'visible';
    await fire('visibilitychange');
    assert.equal(store.sheet, 'thanks', 'the pass is there the moment the tab is looked at');
  });

  it('does not set a new timer for a question that was on its way when the tab was hidden', async () => {
    await shop.loadShop();
    shop.startShopCheckout('year');
    timers.clear();
    const question = shop.check(); // (on its way)
    document.visibilityState = 'hidden';
    await question;
    assert.equal(timers.size, 0, 'nobody is looking: the next question waits until somebody does');
  });

  it('finds the payment when the page comes back from the browser\'s back/forward cache', async () => {
    await shop.loadShop();
    shop.startShopCheckout('year');
    shop.initShop();
    await t.pay({ plan: 'year', code: codeInTab() });
    await fire('pageshow', { persisted: false });
    assert.equal(store.payWaiting === null, false, 'a fresh page load is not a restore');
    await fire('pageshow', { persisted: true });
    assert.equal(store.sheet, 'thanks');
  });

  it('tells the host, and stops waiting, when the order was refunded, cancelled or disputed, or the package has run out', async () => {
    for (const [what, act, wording] of [
      ['refunded', (o) => t.deliver('refunds/create', { id: 1 + Math.floor(Math.random() * 1e9), order_id: o.id, transactions: [{ kind: 'refund', status: 'success', amount: '149.00', currency: 'NOK' }] }), /refundert/],
      ['cancelled', (o) => t.deliver('orders/cancelled', o), /kansellert/],
      ['disputed', (o) => t.deliver('disputes/create', { id: 7, order_id: o.id }), /bestridt/],
    ]) {
      store.toast = null;
      const { order } = await startAndPay('evening');
      await act(order);
      await ring();
      assert.equal(store.payWaiting, null, what);
      assert.match(store.toast, wording, what);
      assert.equal(store.sheet, null, what);
      assert.equal(timers.has(0), false);
    }
    store.toast = null;
    await startAndPay('evening', { paidAt: new Date(Date.now() - 13 * 3600_000) });
    await ring();
    assert.equal(store.payWaiting, null);
    assert.match(store.toast, /har gått ut/);
  });
});

describe('when the host comes back some other way', () => {
  it('takes up a payment that this tab was waiting for when the page is opened again (a reload, or the back button)', async () => {
    const { code } = await startAndPay('lifetime');
    // the page is gone and comes back: the store is new, the tab's storage is the same
    Object.assign(store, { payWaiting: null, pass: null, passCode: null, paywall: true, sheet: null });
    const again = await import(`../public/js/pay/shop.js?test=again${imports}`);
    again.initShop();
    await new Promise((resolve) => realSetTimeout(resolve, 20)); // (the check that initShop starts)
    assert.equal(store.sheet, 'thanks');
    assert.equal(store.pass.plan, 'lifetime');
    assert.equal(store.passCode, code);
  });

  it('shows the waiting again on a reload, when it has not been paid yet, and the host can go on to pay', async () => {
    await shop.loadShop();
    shop.startShopCheckout('year');
    const waiting = { ...store.payWaiting };
    store.payWaiting = null;
    const again = await import(`../public/js/pay/shop.js?test=reload${imports}`);
    again.initShop();
    assert.deepEqual({ ...store.payWaiting }, waiting);
    again.reopenShop();
    assert.equal(opened().at(-1)[1], waiting.url, 'the same cart, the same code');
  });

  it('forgets a payment that was started and never finished, after two hours', async () => {
    await shop.loadShop();
    shop.startShopCheckout('year');
    const waiting = JSON.parse(sessionStorage.getItem('disputt:shop'));
    sessionStorage.setItem('disputt:shop', JSON.stringify({ ...waiting, at: Date.now() - 2 * 3600_000 - 1000 }));
    store.payWaiting = null;
    const again = await import(`../public/js/pay/shop.js?test=old${imports}`);
    again.initShop();
    assert.equal(store.payWaiting, null);
    sessionStorage.setItem('disputt:shop', JSON.stringify({ ...waiting, code: 'not a code' }));
    const garbled = await import(`../public/js/pay/shop.js?test=garbled${imports}`);
    garbled.initShop();
    assert.equal(store.payWaiting, null, 'something that is not a code is not waited for');
    sessionStorage.setItem('disputt:shop', 'not json');
    const broken = await import(`../public/js/pay/shop.js?test=broken${imports}`);
    broken.initShop();
    assert.equal(store.payWaiting, null);
  });

  it('does nothing at all for the Stripe edition', async () => {
    await pay.initPayments({ apiUrl: `${PAY_SERVER}/`, publicKey: t.keys.publicKey });
    assert.equal(store.payments.provider, 'stripe');
    sessionStorage.setItem('disputt:shop', JSON.stringify({ code: 'K7M2-9QXD-4TRB', plan: 'year', url: 'https://x.test/', at: Date.now() }));
    const stripe = await import(`../public/js/pay/shop.js?test=stripe${imports}`);
    const listening = listeners.length; // (what initPayments itself listens for)
    stripe.initShop();
    assert.equal(store.payWaiting, null);
    assert.equal(listeners.length, listening, 'it listens for nothing');
    assert.equal(asked.length, 0);
  });

  it('lets the host open the shop again, or give up, and a new try is a new code', async () => {
    await shop.loadShop();
    shop.startShopCheckout('year');
    const first = codeInTab();
    shop.reopenShop();
    assert.equal(opened().length, 2);
    assert.equal(opened()[1][1], opened()[0][1], 'the same cart again, with the same code: if the first tab is paid in, so is this');
    shop.cancelShopPayment();
    assert.equal(store.payWaiting, null);
    assert.ok(!sessionStorage.has('disputt:shop'));
    assert.equal(timers.size, 0);
    shop.startShopCheckout('year');
    assert.notEqual(codeInTab(), first);
  });

  it('can still be paid in the first tab after the host gave up: the code from the e-mail gets the pass back under "Logg inn"', async () => {
    await shop.loadShop();
    shop.startShopCheckout('year');
    const code = codeInTab();
    shop.cancelShopPayment();
    await t.pay({ plan: 'year', code });
    const pass = await pay.restoreWithCode(code);
    assert.equal(pass.plan, 'year');
  });
});
