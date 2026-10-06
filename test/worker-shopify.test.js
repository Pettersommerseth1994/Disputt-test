// The payment server for Shopify (payments/worker-shopify.js), against a pretend Shopify and a pretend database.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { verifyPass } from '../public/js/pay/pass.js';
import { CODE, dispute, order, refund, sign, webhookRequest } from '../tools/qa/fakeshopify.mjs';
import { ORIGIN, SECRET, SHOP, SITE, VARIANTS, WORKER, mod, setupShopify } from './helpers/shopify.mjs';

let t;
beforeEach(async () => {
  t = await setupShopify();
});
// (the Worker logs what it could not use: the tests that provoke that keep the output clean)
const realError = console.error;
afterEach(() => (console.error = realError));
const quiet = () => (console.error = () => {});

const json = async (res) => ({ status: res.status, body: await res.json(), headers: res.headers });
const HOUR = 3600_000;
const AGREED = { name: 'samtykke', value: '2026-10-06T08:15:00.000Z' }; // (the consent that the page puts in the cart)
/** What the page does while the host pays in the other tab: asks for the pass with the code it made up. */
const claim = async (code = CODE) => json(await t.call('/restore', { method: 'POST', body: { code } }));
const rows = () => (t.db.sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'orders'").get() ? t.db.sqlite.prepare('SELECT * FROM orders ORDER BY paid_at').all() : []);

describe('health', () => {
  it('says what is set up and what is not, as true and false, and never what it is set to', async () => {
    const r = await json(await t.call('/health'));
    assert.deepEqual(r.body, {
      ok: true,
      provider: 'shopify',
      mode: 'live',
      site: SITE,
      shop: SHOP,
      set: { database: true, webhookSecret: true, signingKey: true, shop: true, evening: true, year: true, lifetime: true },
    });
    const text = JSON.stringify(r.body);
    for (const secret of [SECRET, t.env.JWT_PRIVATE_KEY, VARIANTS.year]) assert.ok(!text.includes(secret), 'no secret in the answer');
    t.env.ACCEPT_TEST_ORDERS = 'true';
    assert.equal((await json(await t.call('/'))).body.mode, 'test');
  });

  it('shows each missing part as false, so that a person setting it up can see what is left', async () => {
    for (const [name, key] of [['database', 'DB'], ['webhookSecret', 'SHOPIFY_WEBHOOK_SECRET'], ['signingKey', 'JWT_PRIVATE_KEY'], ['shop', 'SHOP_URL'], ['year', 'VARIANT_YEAR']]) {
      const { call } = await setupShopify({ [key]: undefined });
      const r = await json(await call('/health'));
      assert.equal(r.status, 200);
      assert.equal(r.body.set[name], false, `${key} missing`);
      assert.equal(Object.values(r.body.set).filter((v) => !v).length, 1, 'and only that');
    }
    const garbled = await setupShopify({ JWT_PRIVATE_KEY: 'not a key', VARIANT_LIFETIME: 'abc' });
    const g = await json(await garbled.call('/health'));
    assert.equal(g.body.set.signingKey, false);
    assert.equal(g.body.set.lifetime, false, 'a variant id is a number');
  });

  it('makes its tables the first time it is asked, and only needs an empty database', async () => {
    assert.deepEqual(t.db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name), []);
    await t.call('/health');
    const names = t.db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((r) => r.name);
    assert.deepEqual(names, ['orders', 'refunds', 'stops']);
    await t.call('/health'); // (and again is no harm)
  });
});

describe('GET /shop', () => {
  it('says where to send the host and which variant is which package, and nothing else', async () => {
    const r = await json(await t.call('/shop'));
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { shop: SHOP, variants: VARIANTS });
  });

  it('gives only the address of the shop, whatever is written after it, and only if it is https', async () => {
    t.env.SHOP_URL = 'https://shop.example.test/products/x?y=1#z';
    assert.equal((await json(await t.call('/shop'))).body.shop, SHOP);
    t.env.SHOP_URL = 'http://shop.example.test';
    assert.equal((await json(await t.call('/shop'))).status, 503);
    t.env.SHOP_URL = 'http://localhost.example.test';
    assert.equal((await json(await t.call('/shop'))).status, 503, 'a name that only starts like localhost');
    t.env.SHOP_URL = 'http://127.0.0.1:8123/anything';
    assert.equal((await json(await t.call('/shop'))).body.shop, 'http://127.0.0.1:8123', 'a pretend shop on this machine, as the tests have');
    t.env.SHOP_URL = 'nonsense';
    assert.equal((await json(await t.call('/shop'))).status, 503);
  });

  it('says it is not set up when a package has no variant', async () => {
    t.env.VARIANT_YEAR = '';
    const r = await json(await t.call('/shop'));
    assert.equal(r.status, 503);
    assert.match(r.body.message, /VARIANT_YEAR/);
  });
});

describe('POST /shopify/webhook: who is let in', () => {
  it('only lets in a call that Shopify has signed with the secret, and writes nothing for the others', async () => {
    const o = order();
    const body = JSON.stringify(o);
    const wrongSecret = await t.deliver('orders/paid', body, { secret: 'another secret' });
    assert.equal(wrongSecret.status, 401);
    assert.equal((await t.deliver('orders/paid', body, { signature: '' })).status, 401, 'no signature');
    assert.equal((await t.deliver('orders/paid', body, { signature: 'not base64 !!' })).status, 401, 'a signature that is not base64');
    assert.equal((await t.deliver('orders/paid', body, { signature: Buffer.from('short').toString('base64') })).status, 401, 'a signature of the wrong length');
    const signed = await sign(body);
    assert.equal((await t.deliver('orders/paid', body.replace('year', 'evening'), { signature: signed })).status, 401, 'a body that was changed after it was signed');
    assert.equal(rows().length, 0);
    assert.equal((await t.deliver('orders/paid', body, { signature: signed })).status, 200, 'and the real one is let in');
    assert.equal(rows().length, 1);
  });

  it('is not let in by a browser from another site either, and cannot be used without a secret to check against', async () => {
    const res = await mod.worker.fetch(await webhookRequest(`${WORKER}/shopify/webhook`, 'orders/paid', order(), { headers: { Origin: 'https://evil.example' } }), t.env);
    assert.equal(res.status, 403);
    delete t.env.SHOPIFY_WEBHOOK_SECRET;
    const open = await t.deliver('orders/paid', order(), { signature: Buffer.alloc(32).toString('base64') });
    assert.equal(open.status, 503, 'with no secret set, nothing is let in');
    assert.equal(rows().length, 0);
  });

  it('does not accept a short secret, such as a placeholder: anybody could sign with it', async () => {
    for (const secret of ['x', 'temporary', '123456789012345']) {
      t.env.SHOPIFY_WEBHOOK_SECRET = secret;
      const o = order();
      const r = await json(await t.deliver('orders/paid', o, { secret }));
      assert.equal(r.status, 503, `"${secret}" is too short`);
      assert.match(r.body.message, /SHOPIFY_WEBHOOK_SECRET/);
      assert.equal((await json(await t.call('/health'))).body.set.webhookSecret, false);
    }
    assert.equal(rows().length, 0);
    t.env.SHOPIFY_WEBHOOK_SECRET = '1234567890123456';
    assert.equal((await t.deliver('orders/paid', order(), { secret: t.env.SHOPIFY_WEBHOOK_SECRET })).status, 200, 'sixteen characters are enough');
    assert.equal((await json(await t.call('/health'))).body.set.webhookSecret, true);
  });

  it('answers a signed call about something it does not handle with yes, so that Shopify does not keep trying', async () => {

    const r = await json(await t.deliver('products/update', { id: 1 }));
    assert.deepEqual(r.body, { ok: true, ignored: 'topic' });
    for (const topic of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
      const r = await json(await t.deliver(topic, { id: 1 }));
      assert.deepEqual(r.body, { ok: true, ignored: 'topic' }, `${topic}: a name that every object has is not a handler`);
    }
  });

  it('refuses a body that is not JSON, and one that is far too big', async () => {
    assert.equal((await t.deliver('orders/paid', 'not json')).status, 400);
    assert.equal((await t.deliver('orders/paid', '[1,2]')).status, 400, 'JSON, but not an order');
    const big = JSON.stringify({ pad: 'x'.repeat(1_100_000) });
    assert.equal((await t.deliver('orders/paid', big)).status, 413);
    // a body that says it is big is refused before it is read (the signature does not have to be right: it is not looked at)
    const declared = await t.deliver('orders/paid', '{}', { headers: { 'Content-Length': '2000000' }, signature: 'x' });
    assert.equal(declared.status, 413);
  });
});

describe('POST /shopify/webhook: orders/paid', () => {
  it('writes down the code, the package, the time and the amount, and nothing about the customer', async () => {
    const { order: o, res } = await t.pay({ plan: 'year' });
    assert.equal(res.status, 200);
    const [row] = rows();
    assert.deepEqual({ ...row }, {
      order_id: String(o.id),
      code: CODE,
      plan: 'year',
      paid_at: Math.floor(Date.parse(o.processed_at) / 1000),
      consented_at: Math.floor(Date.parse(o.note_attributes.find((a) => a.name === 'samtykke').value) / 1000),
      amount: 39900,
      currency: 'NOK',
      name: o.name,
      test: 0,
      state: 'paid',
      refunded: 0,
    });
    assert.ok(!JSON.stringify(rows()).match(/kunde@example\.com|Kari|Nordmann/), 'no e-mail address and no name is kept');
  });

  it('writes an order down once, however many times Shopify calls about it', async () => {
    const o = order();
    for (let i = 0; i < 3; i++) assert.equal((await t.deliver('orders/paid', o)).status, 200);
    assert.equal(rows().length, 1);
  });

  it('does not undo a cancel, a refund or a dispute when Shopify calls about the same paid order again, a day later', async () => {
    const cancelled = order({ code: 'JJJJ-JJJJ-JJJ1' });
    const refunded = order({ code: 'KKKK-KKKK-KKK1' });
    const disputed = order({ code: 'MMMM-MMMM-MMM1' });
    for (const o of [cancelled, refunded, disputed]) await t.deliver('orders/paid', o);
    await t.deliver('orders/cancelled', cancelled);
    await t.deliver('refunds/create', refund(refunded.id, '399.00'));
    await t.deliver('disputes/create', dispute(disputed.id));
    for (const o of [cancelled, refunded, disputed]) assert.equal((await t.deliver('orders/paid', o)).status, 200);
    assert.deepEqual(rows().map((r) => r.state).sort(), ['cancelled', 'disputed', 'refunded']);
    assert.equal((await claim('JJJJ-JJJJ-JJJ1')).status, 410);
    assert.equal((await claim('MMMM-MMMM-MMM1')).status, 410);
  });

  it('goes by the time Shopify says the order was made, so a call that comes late does not stretch the evening', async () => {
    const paidAt = new Date(Date.now() - 5 * HOUR);
    await t.pay({ plan: 'evening', paidAt });
    const r = await claim();
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.paidAt, Math.floor(+paidAt / 1000) * 1000);
    assert.equal(r.body.expiresAt, r.body.paidAt + 12 * HOUR);
    assert.ok(r.body.expiresAt - Date.now() < 7 * HOUR + 1000, 'seven hours are left, not twelve');
  });

  it('takes the code however it is written in the order: any case in the name, spaces, small letters, O for 0', async () => {
    await t.pay({ attributes: [{ name: 'Kode', value: ' k7m2 9qxd-4trb ' }, AGREED] });
    assert.equal((await claim()).status, 200);
    await t.pay({ code: null, attributes: [{ name: 'KODE', value: 'abcd-efgh-jkmn' }, AGREED] });
    assert.equal((await claim('ABCD-EFGH-JKMN')).status, 200);
    await t.pay({ code: null, attributes: [{ name: 'kode', value: 'OOOO-1111-LLLL' }, AGREED] });
    assert.equal((await claim('0000-1111-1111')).status, 200, 'O is 0 and L is 1, as when it is typed in the game');
  });

  it('counts the best package when an order holds more than one, and counts a package once however many were bought', async () => {
    await t.pay({ code: 'AAAA-AAAA-AAA1', lines: [{ plan: 'evening' }, { plan: 'lifetime' }, { plan: 'year' }] });
    assert.equal((await claim('AAAA-AAAA-AAA1')).body.plan, 'lifetime');
    await t.pay({ code: 'BBBB-BBBB-BBB1', lines: [{ plan: 'evening', quantity: 3 }] });
    const r = await claim('BBBB-BBBB-BBB1');
    assert.equal(r.body.plan, 'evening');
    assert.equal(r.body.expiresAt, r.body.paidAt + 12 * HOUR, 'three evenings in one order is still one evening');
  });

  it('ignores what is not a paid order for one of the packages, and says why', async () => {
    const cases = [
      ['a test order', order({ test: true }), 'test_order'],
      ['an order that was cancelled', order({ cancelledAt: '2026-10-06T10:00:00+02:00' }), 'cancelled'],
      ['an order that is still waiting for the money', order({ status: 'pending' }), 'not_paid'],
      ['an order for something else in the shop', order({ lines: [{ plan: 'other', variant_id: 123456789 }] }), 'no_package'],
      ['an order with no lines at all', { ...order(), line_items: [] }, 'no_package'],
    ];
    for (const [what, o, why] of cases) {
      const r = await json(await t.deliver('orders/paid', o));
      assert.deepEqual(r.body, { ok: true, ignored: why }, what);
    }
    assert.equal(rows().length, 0);
  });

  it('gives no access for an order that does not carry the consent to getting it at once, and says so in the log', async () => {
    const logged = [];
    console.error = (...args) => logged.push(args.join(' '));
    const cases = [
      ['no consent at all', order({ consent: false })],
      ['an empty one', order({ attributes: [{ name: 'kode', value: CODE }, { name: 'samtykke', value: '' }] })],
      ['one that is not a time', order({ attributes: [{ name: 'kode', value: CODE }, { name: 'samtykke', value: 'ja' }] })],
    ];
    for (const [what, o] of cases) {
      const r = await json(await t.deliver('orders/paid', o));
      assert.deepEqual(r.body, { ok: true, ignored: 'no_consent' }, what);
      assert.ok(logged.at(-1).includes(o.name) && logged.at(-1).includes('consent'), `${what}: the log names the order`);
    }
    assert.equal(rows().length, 0);
    const ok = order({ attributes: [{ name: 'KODE', value: CODE }, { name: 'Samtykke', value: '2026-10-06T08:15:00.000Z' }] });
    assert.equal((await t.deliver('orders/paid', ok)).status, 200);
    assert.equal(rows()[0].consented_at, Math.floor(Date.parse('2026-10-06T08:15:00.000Z') / 1000), 'the time of the consent is kept');
  });

  it('cannot give anybody access for an order that has no code: it says so in the log and writes nothing', async () => {

    const logged = [];
    console.error = (...args) => logged.push(args.join(' '));
    for (const attributes of [[], [{ name: 'noe', value: CODE }], [{ name: 'kode', value: 'for kort' }], [{ name: 'kode', value: '' }], 'not a list']) {
      const o = order({ attributes });
      const r = await json(await t.deliver('orders/paid', o));
      assert.deepEqual(r.body, { ok: true, ignored: 'no_code' });
      assert.ok(logged.at(-1).includes(o.name), 'the log names the order, so that the owner can find it in Shopify');
    }
    assert.equal(rows().length, 0);
  });

  it('counts test orders only when it has been told to, while testing', async () => {
    assert.equal((await t.pay({ test: true })).res.status, 200);
    assert.equal(rows().length, 0);
    t.env.ACCEPT_TEST_ORDERS = 'true';
    await t.pay({ test: true });
    assert.equal(rows().length, 1);
    assert.equal(rows()[0].test, 1, 'and they are marked, so that they can be told apart');
  });

  it('does not care what was paid: a discount code or a campaign price is the shop owner\'s choice', async () => {
    await t.pay({ plan: 'year', price: '0.00' });
    await t.pay({ plan: 'evening', code: 'CCCC-CCCC-CCC1', price: '99.50' });
    assert.deepEqual(rows().map((r) => r.amount).sort((a, b) => a - b), [0, 9950]);
    assert.equal((await claim()).status, 200);
  });

  it('says it is not set up, and not "ignored", when it does not know the variants', async () => {
    for (const name of ['VARIANT_EVENING', 'VARIANT_YEAR', 'VARIANT_LIFETIME']) delete t.env[name];
    const r = await json(await t.deliver('orders/paid', order()));
    assert.equal(r.status, 503, 'Shopify tries again later, when the set-up is done');
  });

  it('fails, and writes nothing half way, when the database is down, so that Shopify calls again', async () => {
    await t.call('/health'); // (the tables)
    t.db.failNext(1);
    quiet();
    const o = order();
    assert.equal((await t.deliver('orders/paid', o)).status, 500);
    assert.equal(rows().length, 0);
    assert.equal((await t.deliver('orders/paid', o)).status, 200, 'and the second call, a moment later, does it');
    assert.equal(rows().length, 1);
  });
});

describe('POST /shopify/webhook: cancelled, refunded, disputed', () => {
  it('stops an order that is cancelled from giving access', async () => {
    const { order: o } = await t.pay();
    assert.equal((await claim()).status, 200);
    await t.deliver('orders/cancelled', o);
    const r = await claim();
    assert.equal(r.status, 410);
    assert.equal(r.body.error, 'cancelled');
    assert.match(r.body.message, /kansellert/);
  });

  it('stops an order that is refunded in full, and not one that is refunded in part', async () => {
    const { order: o } = await t.pay({ plan: 'year' });
    await t.deliver('refunds/create', refund(o.id, '100.00'));
    assert.equal((await claim()).status, 200, 'a part of it back (a goodwill refund) does not take the access away');
    assert.equal(rows()[0].refunded, 10000);
    await t.deliver('refunds/create', refund(o.id, '299.00'));
    const r = await claim();
    assert.equal(r.status, 410);
    assert.equal(r.body.error, 'refunded');
    assert.equal(rows()[0].refunded, 39900);
  });

  it('counts a refund once, however many times Shopify calls about it, and does not count one that did not go through', async () => {
    const { order: o } = await t.pay({ plan: 'year' });
    const part = refund(o.id, '200.00');
    for (let i = 0; i < 3; i++) await t.deliver('refunds/create', part);
    assert.equal(rows()[0].refunded, 20000);
    await t.deliver('refunds/create', refund(o.id, '199.00', { status: 'failure' }));
    await t.deliver('refunds/create', refund(o.id, '199.00', { status: 'error' }));
    await t.deliver('refunds/create', refund(o.id, '199.00', { kind: 'void' }));
    await t.deliver('refunds/create', refund(o.id, null));
    assert.equal(rows()[0].refunded, 20000);
    assert.equal((await claim()).status, 200);
  });

  it('counts a refund that has been asked for but has not cleared yet (a payment app such as Vipps), and stops the code at once', async () => {
    const { order: o } = await t.pay({ plan: 'year' });
    await t.deliver('refunds/create', refund(o.id, '399.00', { status: 'pending' }));
    assert.equal((await claim()).body.error, 'refunded');
  });

  it('counts a refund that does not say which currency it is in as one in the currency of the order', async () => {
    const { order: o } = await t.pay({ plan: 'evening' });
    await t.deliver('refunds/create', { id: 77, order_id: o.id, transactions: [{ kind: 'refund', status: 'success', amount: '149.00' }] });
    assert.equal((await claim()).body.error, 'refunded');
  });

  it('counts a refund only in the currency of the order: a sum in another currency is not the same sum', async () => {
    const { order: o } = await t.pay({ plan: 'year' });
    await t.deliver('refunds/create', refund(o.id, '36.00', { currency: 'EUR' }));
    await t.deliver('refunds/create', refund(o.id, '399.00', { currency: 'EUR' }));
    assert.equal(rows()[0].refunded, 0, 'what was paid back in euros does not add up to what was paid in kroner');
    assert.equal((await claim()).status, 200);
  });

  it('applies a refund that Shopify\'s calls delivered before the order', async () => {
    const o = order({ plan: 'evening' });
    await t.deliver('refunds/create', refund(o.id, '149.00'));
    await t.deliver('orders/paid', o);
    assert.equal((await claim()).body.error, 'refunded');
  });

  it('stops an order that is disputed, and an order that is not ours changes nothing', async () => {
    const { order: o } = await t.pay();
    await t.deliver('orders/cancelled', { id: 999 });
    await t.deliver('refunds/create', refund(999, '1.00'));
    await t.deliver('disputes/create', dispute(999));
    assert.equal((await claim()).status, 200);
    await t.deliver('disputes/create', dispute(o.id));
    const r = await claim();
    assert.equal(r.status, 410);
    assert.equal(r.body.error, 'disputed');
  });

  it('stops an order that was cancelled or disputed before Shopify\'s call about the paid order got through (calls come in any order, and are tried again)', async () => {
    const cancelled = order({ code: 'NNNN-NNNN-NNN1' });
    const disputed = order({ code: 'PPPP-PPPP-PPP1' });
    await t.deliver('orders/cancelled', cancelled);
    await t.deliver('orders/cancelled', cancelled); // (and again: written down once)
    await t.deliver('disputes/create', dispute(disputed.id));
    for (let i = 0; i < 2; i++) {
      await t.deliver('orders/paid', cancelled);
      await t.deliver('orders/paid', disputed);
    }
    assert.deepEqual(rows().map((r) => r.state).sort(), ['cancelled', 'disputed']);
    assert.equal((await claim('NNNN-NNNN-NNN1')).body.error, 'cancelled');
    assert.equal((await claim('PPPP-PPPP-PPP1')).body.error, 'disputed');
    assert.equal(t.db.sqlite.prepare('SELECT COUNT(*) AS n FROM stops').get().n, 2);
  });

  it('does not let a later order that is cancelled or refunded take away what an earlier one on the same code gave', async () => {

    await t.pay({ plan: 'lifetime' });
    const { order: second } = await t.pay({ plan: 'evening' });
    await t.deliver('orders/cancelled', second);
    assert.equal((await claim()).body.plan, 'lifetime');
  });
});

describe('POST /restore: the pass for a code', () => {
  it('turns a paid order into a pass that the page can check', async () => {
    await t.pay({ plan: 'year' });
    const r = await claim();
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.plan, 'year');
    assert.equal(r.body.code, CODE);
    const aYearOn = new Date(r.body.paidAt);
    aYearOn.setUTCFullYear(aYearOn.getUTCFullYear() + 1);
    assert.equal(r.body.expiresAt, aYearOn.getTime(), 'twelve months: the same day next year, however many days that is');
    const checked = await verifyPass(r.body.token, t.keys.publicKey);
    assert.equal(checked.ok, true, JSON.stringify(checked));
    assert.equal(checked.pass.plan, 'year');
    assert.equal(checked.pass.expiresAt, r.body.expiresAt);
  });

  it('counts "En kveld" as 12 hours from the payment, however many times it is claimed, and a lifetime pass never ends', async () => {
    await t.pay({ plan: 'evening' });
    const a = await claim();
    const b = await claim();
    assert.equal(a.body.expiresAt, a.body.paidAt + 12 * HOUR);
    assert.equal(b.body.expiresAt, a.body.expiresAt, 'a second claim does not stretch it');
    await t.pay({ plan: 'lifetime', code: 'DDDD-DDDD-DDD1' });
    const c = await claim('DDDD-DDDD-DDD1');
    assert.equal(c.body.expiresAt, null);
    assert.equal((await verifyPass(c.body.token, t.keys.publicKey)).pass.expiresAt, null);
  });

  it('says that it knows no payment with the code to one it has not heard of (yet), so that the page asks again', async () => {
    const r = await claim();
    assert.equal(r.status, 404);
    assert.equal(r.body.error, 'not_found');
    assert.match(r.body.message, /nettopp betalt/);
    await t.pay();
    assert.equal((await claim()).status, 200, 'and once Shopify has called, it is paid');
  });

  it('says no to something that is not a code', async () => {
    for (const bad of ['', 'nope', 'AAAA-AAAA', 'UUUU-UUUU-UUUU', `${CODE}0`]) assert.equal((await claim(bad)).status, 400, JSON.stringify(bad));
    assert.equal((await json(await t.call('/restore', { method: 'POST', body: {} }))).status, 400);
  });

  it('takes the code however it is typed', async () => {
    await t.pay();
    for (const typed of ['k7m2-9qxd-4trb', 'K7M2 9QXD 4TRB', 'k7m29qxd4trb', ' K7M2-9QXD-4TRB ']) assert.equal((await claim(typed)).status, 200, typed);
  });

  it('says that a package has run out, and not that it was never paid', async () => {
    await t.pay({ plan: 'evening', paidAt: new Date(Date.now() - 13 * HOUR) });
    const r = await claim();
    assert.equal(r.status, 410);
    assert.equal(r.body.error, 'expired');
    assert.match(r.body.message, /En kveld/);
    await t.pay({ plan: 'year', code: 'EEEE-EEEE-EEE1', paidAt: new Date(Date.now() - 400 * 24 * HOUR) });
    assert.equal((await claim('EEEE-EEEE-EEE1')).status, 410);
  });

  it('makes a pass for this Worker only: a pass from one payment server is no use to a page set up with another', async () => {
    await t.pay();
    const r = await claim();
    assert.equal((await verifyPass(r.body.token, t.keys.publicKey, Date.now(), WORKER)).ok, true);
    const other = await verifyPass(r.body.token, t.keys.publicKey, Date.now(), 'https://pay.other.example');
    assert.equal(other.ok, false);
    assert.equal(other.reason, 'audience');
  });

  it('gives the one that lasts longest when a code was paid for more than once', async () => {
    await t.pay({ plan: 'evening' });
    await t.pay({ plan: 'year' });
    await t.pay({ plan: 'evening' });
    assert.equal((await claim()).body.plan, 'year');
    await t.pay({ plan: 'lifetime' });
    assert.equal((await claim()).body.plan, 'lifetime');
    await t.pay({ plan: 'evening', paidAt: new Date(Date.now() - 20 * HOUR), code: 'FFFF-FFFF-FFF1' });
    await t.pay({ plan: 'evening', code: 'FFFF-FFFF-FFF1' });
    assert.equal((await claim('FFFF-FFFF-FFF1')).status, 200, 'an evening that has run out does not hide a new one');
  });
});

describe('POST /restore: a customer on a new phone', () => {
  it('gives the pass back to somebody who types the code from the e-mail, however they type it', async () => {
    await t.pay({ plan: 'lifetime' });
    for (const typed of [CODE, 'k7m2-9qxd-4trb', 'K7M2 9QXD 4TRB', 'K7M29QXD4TRB']) {
      const r = await json(await t.call('/restore', { method: 'POST', body: { code: typed } }));
      assert.equal(r.status, 200, typed);
      assert.equal(r.body.plan, 'lifetime');
      assert.equal(r.body.code, CODE);
      assert.equal((await verifyPass(r.body.token, t.keys.publicKey, Date.now(), WORKER)).ok, true);
    }
  });

  it('works without ever having claimed: the customer closed the tab after paying', async () => {
    await t.pay({ plan: 'year' });
    assert.equal((await json(await t.call('/restore', { method: 'POST', body: { code: CODE } }))).status, 200);
  });

  it('says no to codes that are wrong, unknown, refunded or from an order that has run out', async () => {
    const post = async (code) => json(await t.call('/restore', { method: 'POST', body: { code } }));
    assert.equal((await post('nope')).status, 400);
    assert.equal((await post(undefined)).status, 400);
    const unknown = await post('GGGG-GGGG-GGG1');
    assert.equal(unknown.status, 404);
    assert.match(unknown.body.message, /Fant ingen betaling/);
    const { order: o } = await t.pay({ plan: 'year' });
    await t.deliver('refunds/create', refund(o.id, '399.00'));
    assert.equal((await post(CODE)).body.error, 'refunded');
    await t.pay({ plan: 'evening', code: 'HHHH-HHHH-HHH1', paidAt: new Date(Date.now() - 13 * HOUR) });
    assert.equal((await post('HHHH-HHHH-HHH1')).body.error, 'expired');
    const notJson = await json(await t.call('/restore', { method: 'POST' }));
    assert.equal(notJson.status, 400);
  });
});

describe('CORS', () => {
  it('only lets the game\'s own site use it', async () => {
    const ok = await t.call('/shop', { origin: ORIGIN });
    assert.equal(ok.headers.get('Access-Control-Allow-Origin'), ORIGIN);
    assert.equal(ok.headers.get('Cache-Control'), 'no-store');
    const stranger = await json(await t.call('/shop', { origin: 'https://evil.example' }));
    assert.equal(stranger.status, 403);
    assert.equal(stranger.headers.get('Access-Control-Allow-Origin'), null);
    const preflight = await t.call('/claim', { method: 'OPTIONS' });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('Access-Control-Allow-Methods'), 'GET, POST, OPTIONS');
  });

  it('is happy with a call that has no Origin (a person with curl), and reports a missing SITE_URL', async () => {
    assert.equal((await t.call('/shop', { origin: null })).status, 200);
    delete t.env.SITE_URL;
    const r = await json(await t.call('/health', { origin: null }));
    assert.equal(r.status, 503);
    assert.match(r.body.message, /SITE_URL/);
  });
});

describe('when something is wrong', () => {
  it('reports a missing or broken signing key instead of handing out something that will not check', async () => {
    await t.pay();
    delete t.env.JWT_PRIVATE_KEY;
    const missing = await claim();
    assert.equal(missing.status, 503);
    assert.match(missing.body.message, /JWT_PRIVATE_KEY/);
    t.env.JWT_PRIVATE_KEY = 'AAAA';
    assert.equal((await claim()).status, 503);
  });

  it('says that the database is missing, in words, on every way in', async () => {
    delete t.env.DB;
    for (const res of [await t.call('/restore', { method: 'POST', body: { code: CODE } }), await t.deliver('orders/paid', order())]) {
      const r = await json(res);
      assert.equal(r.status, 503);
      assert.match(r.body.message, /DB/);
    }
  });

  it('answers a database that is down with an error that can be tried again, not with a pass or a "no"', async () => {
    await t.pay();
    t.db.failNext(1);
    quiet();
    const r = await claim();
    assert.equal(r.status, 500);
    assert.equal(r.body.error, 'server');
    assert.equal((await claim()).status, 200);
  });

  it('knows nothing else: there is no way to start a payment here, the game builds the cart link itself', async () => {
    for (const [method, path] of [['POST', '/checkout'], ['GET', '/session'], ['GET', '/nope'], ['GET', '/claim'], ['POST', '/claim'], ['GET', '/shopify/webhook'], ['GET', '/restore']]) {
      assert.equal((await json(await t.call(path, { method, body: method === 'POST' ? {} : undefined }))).status, 404, `${method} ${path}`);
    }
  });

  it('accepts the signing key as a PEM too', async () => {
    const pem = `-----BEGIN PRIVATE KEY-----\n${t.env.JWT_PRIVATE_KEY.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----`;
    t.env.JWT_PRIVATE_KEY = pem;
    await t.pay();
    assert.equal((await verifyPass((await claim()).body.token, t.keys.publicKey)).ok, true);
  });
});

describe('what it shares with the Stripe edition', () => {
  const stripe = readFileSync(new URL('../payments/worker.js', import.meta.url), 'utf8');
  const shopify = readFileSync(new URL('../payments/worker-shopify.js', import.meta.url), 'utf8');
  // The two files are pasted into Cloudflare one at a time, so they cannot import from each other; what they have in common is
  // written twice, and this keeps the two copies the same.
  const piece = (source, pattern) => source.match(pattern)?.[0];
  const SHARED = {
    'the one-year rule': /^function plusOneYear[\s\S]*?\n}\n/m,
    HttpError: /^class HttpError[\s\S]*?\n}\n/m,
    bytesToB64url: /^function bytesToB64url[\s\S]*?\n}\n/m,
    b64ToBytes: /^const b64ToBytes = .*;$/m,
    keyBytes: /^const keyBytes = .*;$/m,
    normalizeCode: /^function normalizeCode[\s\S]*?\n}\n/m,
    siteUrl: /^const siteUrl = [\s\S]*?\n};\n/m,
    signPass: /^async function signPass[\s\S]*?\n}\n/m,
    readJson: /^async function readJson[\s\S]*?\n}\n/m,
    corsHeaders: /^function corsHeaders[\s\S]*?\n}\n/m,
    json: /^function json[\s\S]*?\n}\n/m,
  };
  for (const [name, pattern] of Object.entries(SHARED)) {
    it(`has the same ${name}`, () => {
      assert.ok(piece(stripe, pattern), `${name} is in payments/worker.js`);
      assert.equal(piece(shopify, pattern), piece(stripe, pattern));
    });
  }

  it('has the same packages: the same names, and an access that ends at the same time', async () => {
    const stripeSide = await import(`data:text/javascript;base64,${Buffer.from(`${stripe.replace('export default {', 'const worker = {')}\nexport { PLANS };`).toString('base64')}`);
    assert.deepEqual(Object.keys(mod.PLANS), Object.keys(stripeSide.PLANS));
    for (const plan of Object.keys(mod.PLANS)) {
      assert.equal(mod.PLANS[plan].name, stripeSide.PLANS[plan].name);
      for (const paidAt of [1_790_000_000, 1_835_000_000 /* a year that has a 29 February in it */]) assert.equal(mod.PLANS[plan].ends(paidAt), stripeSide.PLANS[plan].ends(paidAt), `${plan} at ${paidAt}`);
    }
  });

  it('has the same alphabet for the code as the page', () => {
    const page = readFileSync(new URL('../public/js/pay/pass.js', import.meta.url), 'utf8');
    const alphabet = (source) => source.match(/CODE_ALPHABET = '([0-9A-Z]+)'/)?.[1];
    assert.ok(alphabet(shopify));
    assert.equal(alphabet(shopify), alphabet(page));
  });
});
