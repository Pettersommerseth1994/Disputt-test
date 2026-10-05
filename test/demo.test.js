// The payment demo (payments/demo/): the real payment server and the pretend Stripe, run inside the page, with what they know kept in
// the browser. The tests build a demo site and load the demo from the build, the way a browser does, with a Map for localStorage.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { verifyPass } from '../public/js/pay/pass.js';
import { build } from '../tools/pages/build.mjs';

const SITE = 'https://site.test/Disputt-test/';
const CODE = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

let dir;
let demo;
let state;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'disputt-demo-'));
  await build(['--out', dir, '--base', '/Disputt-test/', '--payments-demo', '--payments-methods', 'vipps,applepay'], {});
  demo = await import(pathToFileURL(path.join(dir, 'demo', 'demo.js')).href);
  state = await import(pathToFileURL(path.join(dir, 'demo', 'state.js')).href);
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

/** localStorage, for a test. */
const memory = () => {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => void map.set(k, String(v)), removeItem: (k) => void map.delete(k), map };
};

// (the demo takes over the global fetch, as it does in a page: the payment server it runs calls fetch to reach "Stripe")
const realFetch = globalThis.fetch;
const outside = [];
const start = async (storage, cfg = { methods: ['vipps', 'applepay'], freeRounds: 2 }) => {
  globalThis.fetch = async (url) => (outside.push(String(url)), new Response('the network'));
  return demo.startDemo(cfg, { storage, siteUrl: SITE });
};
afterEach(() => {
  globalThis.fetch = realFetch;
  outside.length = 0;
});

const call = async (cfg, route, init) => {
  const res = await fetch(`${cfg.apiUrl}${route}`, init);
  return { status: res.status, body: await res.json() };
};
const post = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
/** The customer pressing "Betal" on the pretend payment page (demo/checkout.js does exactly this). */
const payOnThePage = (storage, session) => {
  const fake = state.loadStripe(storage);
  fake.pay(session);
  state.saveStripe(storage, fake);
};

describe('the demo build', () => {
  it('carries the demo next to the game: the payment server, the pretend Stripe and the pretend payment page', () => {
    for (const f of ['demo.js', 'state.js', 'worker.js', 'fakestripe.js', 'checkout.html', 'checkout.js', 'checkout.css', 'demo.css']) {
      assert.ok(fs.existsSync(path.join(dir, 'demo', f)), `demo/${f} is in the build`);
    }
    const copied = fs.readFileSync(path.join(dir, 'demo', 'worker.js'), 'utf8');
    assert.equal(copied, fs.readFileSync(new URL('../payments/worker.js', import.meta.url), 'utf8'), 'the payment server is the real one, not a copy that can drift');
    assert.equal(fs.readFileSync(path.join(dir, 'demo', 'fakestripe.js'), 'utf8'), fs.readFileSync(new URL('../tools/qa/fakestripe.mjs', import.meta.url), 'utf8'));
  });

  it('tells the game to run the demo, with no payment server and no key to give', () => {
    const config = fs.readFileSync(path.join(dir, 'config.js'), 'utf8');
    assert.match(config, /"demo": true/);
    assert.doesNotMatch(config, /apiUrl|publicKey/);
    // and the page needs no new place to talk to: the payment server and Stripe are in the page
    assert.doesNotMatch(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), /demo\.invalid/);
    assert.match(fs.readFileSync(path.join(dir, 'demo', 'checkout.html'), 'utf8'), /Content-Security-Policy/, 'the payment page gets the same protections as every page');
  });
});

describe('the demo payment server', () => {
  it('answers for the payment server and for Stripe, and lets everything else through to the network', async () => {
    const cfg = await start(memory());
    assert.equal(cfg.apiUrl, demo.API);
    assert.deepEqual(cfg.methods, ['vipps', 'applepay']);
    assert.equal(cfg.freeRounds, 2);
    assert.match(cfg.publicKey, /^[A-Za-z0-9+/]{100,}={0,2}$/);

    const { status, body } = await call(cfg, '/health');
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true, mode: 'test', methods: ['vipps', 'applepay'], site: SITE, terms: 'box-with-link' });

    const stripe = await fetch(`${demo.STRIPE}/v1/checkout/sessions/cs_test_nothing`, { headers: { Authorization: 'Bearer sk_test_fake' } });
    assert.equal(stripe.status, 404, 'the pretend Stripe answers (and knows no such session)');

    assert.equal(await (await fetch('https://example.com/something')).text(), 'the network');
    assert.deepEqual(outside, ['https://example.com/something'], 'nothing but that went out');
  });

  it('sells a package, takes the payment on the pretend page, and hands out a pass that the game accepts', async () => {
    const storage = memory();
    const cfg = await start(storage);

    const started = await call(cfg, '/checkout', post({ plan: 'year', method: 'vipps' }));
    assert.equal(started.status, 200);
    const { url, session } = started.body;
    assert.equal(url, `${SITE}demo/checkout.html?s=${session}`, 'the host is sent to the pretend payment page of this site');
    const kept = state.loadStripe(storage).sessions.get(session);
    assert.equal(kept.amount_total, 39900);
    assert.equal(kept.success_url, `${SITE}?pay=success&session_id={CHECKOUT_SESSION_ID}`);
    assert.deepEqual(kept.allowed_payment_method_types, ['vipps']);
    assert.equal(kept.consent_collection, 'required', 'the box about the right of withdrawal is on the payment page, as it will be at Stripe');
    assert.match(kept.custom_text.terms, /Jeg godtar \[vilkårene\]\(https:\/\/site\.test\/Disputt-test\/vilkar\.html\), ber om at tilgangen leveres med en gang/);

    const early = await call(cfg, `/claim?session_id=${session}`);
    assert.equal(early.status, 402);
    assert.equal(early.body.error, 'unpaid');

    payOnThePage(storage, session);
    const claimed = await call(cfg, `/claim?session_id=${session}`);
    assert.equal(claimed.status, 200);
    assert.match(claimed.body.code, CODE);
    assert.equal(claimed.body.plan, 'year');

    // the game's own check of a pass, with the key the demo gave it
    const checked = await verifyPass(claimed.body.token, cfg.publicKey, Date.now(), cfg.apiUrl);
    assert.equal(checked.ok, true);
    assert.equal(checked.pass.plan, 'year');
    assert.equal((await verifyPass(claimed.body.token, cfg.publicKey, Date.now(), 'https://pay.elsewhere.test')).reason, 'audience', 'a pass belongs to the payment server that made it');
  });

  it('gives the access back for the code, on this phone, and says no to a code it has never seen', async () => {
    const storage = memory();
    const cfg = await start(storage);
    const { body: started } = await call(cfg, '/checkout', post({ plan: 'lifetime', method: 'applepay' }));
    payOnThePage(storage, started.session);
    const { body: claimed } = await call(cfg, `/claim?session_id=${started.session}`);

    const again = await call(cfg, '/restore', post({ code: claimed.code.toLowerCase().replaceAll('-', '') }));
    assert.equal(again.status, 200);
    assert.equal(again.body.plan, 'lifetime');
    assert.equal(again.body.expiresAt, null);
    assert.equal((await verifyPass(again.body.token, cfg.publicKey, Date.now(), cfg.apiUrl)).ok, true);

    const wrong = await call(cfg, '/restore', post({ code: 'AAAA-AAAA-AAAA' }));
    assert.equal(wrong.status, 404);
    assert.match(wrong.body.message, /Fant ingen betaling med den koden/);
  });

  it('remembers the keys and the payments when the page is opened again, as it is when the host comes back from the payment page', async () => {
    const storage = memory();
    const first = await start(storage);
    const { body: started } = await call(first, '/checkout', post({ plan: 'evening', method: 'applepay' }));
    payOnThePage(storage, started.session);

    globalThis.fetch = realFetch; // (a new page: nothing of the old one is left)
    const second = await start(storage);
    assert.equal(second.publicKey, first.publicKey, 'the same keys, so a pass from before is still good');
    const claimed = await call(second, `/claim?session_id=${started.session}`);
    assert.equal(claimed.status, 200);
    assert.equal((await verifyPass(claimed.body.token, second.publicKey, Date.now(), second.apiUrl)).ok, true);

    // and a second browser knows nothing of it: the demo's "server" is the browser
    const other = await start(memory());
    assert.notEqual(other.publicKey, first.publicKey);
    assert.equal((await call(other, `/claim?session_id=${started.session}`)).status, 404);
  });

  it('only offers the payment methods the build asked for', async () => {
    const cfg = await start(memory(), { methods: ['applepay'], freeRounds: 3 });
    assert.deepEqual(cfg.methods, ['applepay']);
    assert.equal(cfg.freeRounds, 3);
    const vipps = await call(cfg, '/checkout', post({ plan: 'year', method: 'vipps' }));
    assert.equal(vipps.status, 400);
    assert.equal(vipps.body.error, 'method_unavailable');
  });

  it('does not start in a browser that keeps nothing, and leaves fetch alone', async () => {
    const none = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); }, removeItem: () => {} };
    globalThis.fetch = async () => new Response('the network');
    const untouched = globalThis.fetch;
    assert.equal(await demo.startDemo({}, { storage: none, siteUrl: SITE }), null);
    assert.equal(globalThis.fetch, untouched);
  });
});

describe('what the demo keeps', () => {
  it('keeps the newest sessions, and only the payments that belong to them', () => {
    const storage = memory();
    const fake = state.loadStripe(storage);
    for (let i = 0; i < 45; i++) {
      const paid = i % 2 === 1;
      fake.sessions.set(`cs_test_${i}`, { id: `cs_test_${i}`, payment_intent: paid ? `pi_${i}` : null });
      if (paid) fake.payments.set(`pi_${i}`, { id: `pi_${i}` });
    }
    state.saveStripe(storage, fake);
    const kept = state.loadStripe(storage);
    assert.equal(kept.sessions.size, 40);
    assert.ok(kept.sessions.has('cs_test_44') && !kept.sessions.has('cs_test_4'));
    assert.deepEqual([...kept.payments.keys()].every((id) => [...kept.sessions.values()].some((s) => s.payment_intent === id)), true);
    assert.equal(kept.payments.size, 20);
  });

  it('starts empty from storage that has been damaged', () => {
    const storage = memory();
    storage.setItem('disputt:demo:stripe', '{"sessions": 42');
    assert.equal(state.loadStripe(storage).sessions.size, 0);
  });
});
