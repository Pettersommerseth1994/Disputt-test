// UI end-to-end: several "phones" (isolated browser contexts) play a whole game through the real interface.
//   node tools/qa/play.mjs [players=4] [target=2] [--p2p] [--subpath] [--url=https://…] [--shots]
//   (with six players or more there are two impostors, who must be told about each other: try `play.mjs 6 2`)
//   --p2p   test the peer-to-peer build (static site + local PeerJS signalling server) instead of the Node server
//   --subpath   with --p2p: serve the site below /Disputt/ like GitHub Pages does (catches links that forget the sub-path)
//   --url   play against an already deployed peer-to-peer site (real PeerJS cloud, real timers), e.g. the GitHub Pages address
//   --pay   payments switched on (with --p2p; needs a target of 3 or more): after the second round the host has to pay, through a pretend
//           Stripe (tools/qa/payments-stack.mjs, tools/qa/payflow.mjs); --pay-slow also keeps the host away for 75 s while paying
//   --pay-demo   the same evening against the payment demo of a test copy (payments/demo/), where the payment server and Stripe are pretended
//           by the page itself. With --url it plays against a published test copy that runs the demo (real timers, the real signalling service).
//   --pay-shopify   the same, with a pretend Shopify shop that opens in a new tab (tools/qa/shop-stack.mjs, tools/qa/shopflow.mjs);
//           --pay-shopify-slow also keeps the host in the shop for 75 s
// Needs Google Chrome (CHROME_PATH to override). Exits non-zero on the first thing that does not behave.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import jsQR from 'jsqr';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { QUESTIONS } from '../../shared/questions.js';
import { buyAndComeBackByTheBackButton, checkHome, payAfterFreeRounds, restoreOnNewPhone } from './payflow.mjs';
import { demoServer, realServer } from './payserver.mjs';
import { startPaymentsStack } from './payments-stack.mjs';
import { startShopStack } from './shop-stack.mjs';
import { buyAndComeBackShop, payAfterFreeRoundsShop } from './shopflow.mjs';
import { FAST, startNodeSite, startP2PSite } from './sites.mjs';
import { underTheFinger } from './underfinger.mjs';

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith('--'));
const nums = args.filter((a) => !a.startsWith('--')).join(' ').split(/\s+/).filter(Boolean).map(Number);
const PLAYERS = nums[0] ?? 4;
const TARGET = nums[1] ?? 2;
assert.ok(Number.isInteger(PLAYERS) && PLAYERS >= 3 && PLAYERS <= 10 && Number.isInteger(TARGET) && TARGET >= 1, 'usage: play.mjs [players 3-10] [target]');
const SHOTS = flags.includes('--shots');
const LIVE_URL = flags.find((f) => f.startsWith('--url='))?.slice('--url='.length);
const LIVE = Boolean(LIVE_URL);
const SUBPATH = flags.includes('--subpath');
const PAY_SLOW = flags.includes('--pay-slow');
const DEMO = flags.includes('--pay-demo');
const PAY = flags.includes('--pay') || PAY_SLOW || DEMO;
const PAY_SHOP_SLOW = flags.includes('--pay-shopify-slow');
const PAY_SHOP = flags.includes('--pay-shopify') || PAY_SHOP_SLOW;
const FREE_ROUNDS = 2; // (the page's default)
const P2P = LIVE || SUBPATH || flags.includes('--p2p');
const SLOW = LIVE ? 2 : 1; // the deployed site runs on the real timers and a real network
if (PAY || PAY_SHOP) assert.ok((!LIVE || DEMO) && TARGET >= 3, '--pay needs a local site (a deployed one only with --pay-demo) and a target of 3 or more, so that there is a third round to pay for');
assert.ok(!(PAY && PAY_SHOP), 'a game is paid for at Stripe or at Shopify, not both');
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const NAMES = ['Petter', 'Mari', 'Ola', 'Sofie', 'Jonas', 'Ida', 'Kari', 'Per', 'Nina', 'Lars'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

const stack = PAY && !DEMO ? await startPaymentsStack() : PAY_SHOP ? await startShopStack() : null; // the payment server with a pretend Stripe (the demo has its own, in the page), or with a pretend Shopify
const server = DEMO ? demoServer() : PAY ? realServer(stack) : null;
const site = LIVE
  ? { base: LIVE_URL.replace(/\/+$/, ''), stop: async () => {} }
  : P2P
    ? await startP2PSite({ prefix: SUBPATH ? '/Disputt/' : '', payments: stack && { url: stack.apiUrl, key: stack.publicKey, ...(PAY_SHOP ? { provider: 'shopify' } : { methods: 'vipps,applepay' }) }, paymentsDemo: DEMO })
    : await startNodeSite();
const base = site.base;
stack?.setSite(`${base}/`); // Stripe sends the host back to the game
log(`${LIVE ? 'deployed peer-to-peer site' : P2P ? 'peer-to-peer build' : 'Node server'} at ${base}`);
// (loopback WebRTC between two pages of the same browser needs real host candidates, not mDNS names)
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--hide-scrollbars', '--disable-features=WebRtcHideLocalIpsWithMdns'] });
if (SHOTS) fs.mkdirSync('tmp/play', { recursive: true });

// ---------------------------------------------------------------- helpers
const phones = [];
const problems = [];
async function newPhone(name, { wakeLock = 'granted' } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  // (what only reads from the page is asked again if the page happened to be in the middle of a navigation: see `steady`)
  for (const method of ['$eval', '$$eval', '$', '$$', 'waitForFunction', 'waitForSelector']) {
    const original = page[method].bind(page);
    page[method] = (...args) => steady(() => original(...args));
  }
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  // Screen wake lock: most phones grant it, some refuse (low-power mode, home-screen apps). Headless Chrome decides by
  // itself, so every phone gets a stand-in with a known answer.
  await page.evaluateOnNewDocument((mode) => {
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: async () => {
          if (mode === 'denied') throw new DOMException('Denied', 'NotAllowedError');
          return { release: async () => {}, addEventListener() {} };
        },
      },
    });
  }, wakeLock);
  // Vibration: remember what the game asks the phone to do, so that a test can see that both roles feel the same thing.
  await page.evaluateOnNewDocument(() => {
    window.__vibrations = [];
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: (pattern) => (window.__vibrations.push(pattern), true) });
  });
  // An uncaught exception or a blocked resource (the built site ships a Content-Security-Policy) is a failure, not a log line.
  // (Other console errors are printed only: PeerJS logs its own, harmless ones while peers come and go.)
  page.on('pageerror', (e) => {
    problems.push(`[${name}] page error: ${e.message}`);
    console.error(`[${name}] PAGE ERROR:`, e.message);
  });
  page.on('console', (m) => {
    if (m.type() !== 'error' || /404/.test(m.text())) return;
    if (/Content Security Policy|Refused to (load|connect|execute)/i.test(m.text())) problems.push(`[${name}] blocked by the CSP: ${m.text()}`);
    console.error(`[${name}] console.error:`, m.text());
  });
  const phone = { name, ctx, page };
  phones.push(phone);
  return phone;
}
// A page that is in the middle of a navigation (the host leaving for Stripe, or coming back) answers "detached frame" or "context
// destroyed" to whoever asks at that very moment. That is the test being quicker than the page, not a failure: ask again.
const NAVIGATING = /detached Frame|Execution context was destroyed|Cannot find context/i;
async function steady(ask) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await ask();
    } catch (err) {
      if (attempt >= 5 || !NAVIGATING.test(String(err?.message))) throw err;
      await sleep(250);
    }
  }
}
const bodyText = (p) => steady(() => p.page.evaluate(() => document.body.innerText));
const waitText = (p, re, timeout = 10000) =>
  steady(() => p.page.waitForFunction((src, flags) => new RegExp(src, flags).test(document.body.innerText), { timeout }, re.source, re.flags)).catch(async () => {
    throw new Error(`[${p.name}] timed out waiting for ${re}. Screen says:\n${(await bodyText(p)).slice(0, 500)}`);
  });
const clickButton = async (p, label, timeout = 10000) => {
  await steady(() => p.page.waitForFunction((l) => [...document.querySelectorAll('button')].some((b) => b.innerText.trim().includes(l) && !b.disabled), { timeout }, label)).catch(async () => {
    throw new Error(`[${p.name}] no enabled button "${label}". Screen says:\n${(await bodyText(p)).slice(0, 500)}`);
  });
  await steady(() => p.page.evaluate((l) => [...document.querySelectorAll('button')].find((b) => b.innerText.trim().includes(l) && !b.disabled).click(), label));
};
const shot = async (p, label) => SHOTS && p.page.screenshot({ path: `tmp/play/${label}.png` });

// The role is only on the screen while a finger holds a button: first on the role screen, later in the strip above the round.
// Presses it, reads what the screen says while it is held, lets go, and checks that the role is hidden again.
const ROLE_WORD = /\b(Imposter|Lojal)\b/; // (as a word of its own: "Imposteren" or "lojale" inside a sentence is not the role)
const holdAndRead = async (p, label) => {
  const button = await p.page.waitForSelector('.hold-btn, .role-strip .secret', { visible: true, timeout: 5000 * SLOW });
  const box = await button.boundingBox();
  await p.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.page.mouse.down();
  await p.page.waitForFunction((src) => new RegExp(src).test(document.body.innerText), { timeout: 3000 }, ROLE_WORD.source);
  if (label) await shot(p, label);
  const text = await bodyText(p);
  // just the card (or, on the other screens, the strip), with the spaces and line breaks squeezed together
  const card = await p.page.evaluate(() => (document.querySelector('.rolecard, .role-strip')?.innerText ?? '').replace(/\s+/g, ' '));
  // the text on the button itself, and whatever the hold reveals that lies where the finger is: there must be nothing
  const buttonText = await p.page.evaluate(() => (document.querySelector('.hold-btn, .role-strip .secret')?.innerText ?? '').trim());
  const covered = await p.page.evaluate(underTheFinger);
  assert.deepEqual(covered, [], `${p.name}: nothing that the hold reveals sits on or under the button, where the finger covers it`);
  await p.page.mouse.up();
  await p.page.waitForFunction((src) => !new RegExp(src).test(document.body.innerText), { timeout: 3000 }, ROLE_WORD.source);
  return { text, card, buttonText };
};

async function register(p, name, avatarIndex, button = 'Klar!') {
  await p.page.waitForSelector('#name', { timeout: 10000 });
  await p.page.type('#name', name);
  await p.page.evaluate((i) => document.querySelectorAll('.picker__item:not([disabled])')[i].click(), avatarIndex);
  await shot(p, `profile-${name}`);
  await clickButton(p, button);
}

try {
  // ------------------------------------------------------------ lobby
  const host = await newPhone(NAMES[0], { wakeLock: 'denied' }); // the host's phone refuses to stay awake
  await host.page.goto(`${base}/`);
  await waitText(host, /Diskuter,?\s+manipuler\s+og\s+vinn/);
  if (PAY || PAY_SHOP) await checkHome({ waitText, bodyText }, host);
  await shot(host, '01-home');
  await clickButton(host, 'Opprett spill');
  // the host sets the game up in three steps: who you are, how long to play, and last the invitation
  await waitText(host, /Steg 1 av 3/);
  await shot(host, '01b-setup-1-profile');
  assert.match(await bodyText(host), /Hvem er du\?/);
  assert.equal(await host.page.$eval('.dock .btn', (b) => b.disabled), true, 'Neste waits for a name and an avatar');
  await register(host, NAMES[0], 0, 'Neste');
  await waitText(host, /Steg 2 av 3/);
  assert.match(await bodyText(host), /Hvor lenge skal dere spille\?/);
  // "back" keeps the profile, and going on again is possible
  await clickButton(host, 'Tilbake');
  await waitText(host, /Steg 1 av 3/);
  assert.equal(await host.page.$eval('#name', (i) => i.value), NAMES[0], 'the profile is still there after going back');
  await clickButton(host, 'Neste');
  await waitText(host, /Steg 2 av 3/);
  await shot(host, '01c-setup-2-points');
  // the points go in the free-text field (focusing selects the old value, so typing replaces it), and a point takes six minutes
  await host.page.focus('#target');
  await host.page.keyboard.type(String(TARGET));
  await sleep(500);
  if (TARGET * 6 < 90) assert.match(await bodyText(host), new RegExp(`ca\\. ${TARGET * 6} min`), 'six minutes a point');
  await clickButton(host, 'Neste');
  await waitText(host, /Steg 3 av 3/);
  await waitText(host, /Spillere\s+1\/10/);
  // a phone that refuses to keep the screen awake must tell its owner to turn auto-lock off by hand
  await waitText(host, /sett skjermlåsen/i, 5000);
  const code = await host.page.$eval('.lobby__code', (el) => el.textContent.trim());
  assert.match(code, /^[A-Z]{4}$/, 'host sees a four-letter code');
  // the QR code really contains a join link for this room
  const svg = await host.page.$eval('.qr svg', (el) => el.outerHTML);
  const { data, info } = await sharp(Buffer.from(svg), { density: 300 }).resize(500, 500).flatten({ background: '#fff' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const qrLink = jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data;
  assert.ok(qrLink, 'the QR code can be read');
  assert.equal(new URL(qrLink).searchParams.get('j'), code, `the QR link carries the room code (${qrLink})`);
  if (P2P) assert.equal(qrLink, `${base}/?j=${code}`, 'p2p: the QR link is the page address itself');
  log(`host created game ${code}`);

  // "Del lenke": through the phone's share sheet where there is one, otherwise the link is copied
  await host.page.evaluate(() => {
    window.__shared = null;
    window.__copied = null;
    Object.defineProperty(navigator, 'share', { value: async (data) => void (window.__shared = data), configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => void (window.__copied = t) }, configurable: true });
  });
  await clickButton(host, 'Del lenke');
  const shared = await host.page.evaluate(() => window.__shared);
  assert.equal(shared?.url, qrLink, 'the share sheet gets the same link as the QR code');
  assert.ok(shared?.text?.includes(code), 'the shared text carries the room code');
  await host.page.evaluate(() => Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }));
  await clickButton(host, 'Del lenke');
  await waitText(host, /Lenken er kopiert/);
  assert.equal(await host.page.evaluate(() => window.__copied), qrLink, 'without a share sheet the link is copied');

  const others = [];
  for (let i = 1; i < PLAYERS; i++) {
    const p = await newPhone(NAMES[i]);
    await p.page.goto(`${base}/?j=${code.toLowerCase()}`); // like scanning the QR code
    await register(p, NAMES[i], 0); // taken avatars are disabled, so the first enabled one is always free
    await waitText(p, /Du er med/);
    assert.doesNotMatch(await bodyText(p), /sett skjermlåsen/i, 'a phone that does keep the screen awake needs no tip');
    others.push(p);
  }
  await waitText(host, new RegExp(`Spillere\\s+${PLAYERS}/10`));
  for (const p of others) await waitText(p, new RegExp(`Spillere\\s+${PLAYERS}`));
  await shot(host, '02-lobby-host');
  await shot(others[0], '03-lobby-guest');
  const all = [host, ...others];
  log(`${PLAYERS} players in the lobby`);

  // A guest's gear menu: change name or avatar, show the QR code, leave. (They used to be three loose links in a frozen bar
  // under the player list, drawn on top of the players.)
  // (clicked from inside the page: a sheet is replaced by another one in the same spot, and a click that first measures the
  // button can find it gone)
  const clickLabel = async (p, label) => {
    await p.page.waitForSelector(`button[aria-label="${label}"]`, { timeout: 5000 });
    await p.page.evaluate((l) => document.querySelector(`button[aria-label="${l}"]`).click(), label);
  };
  const gear = (p) => clickLabel(p, 'Innstillinger');
  const menuGuest = others[0];
  await gear(menuGuest);
  await waitText(menuGuest, /Innstillinger/);
  await clickButton(menuGuest, 'Vis QR-koden');
  await waitText(menuGuest, new RegExp(`Bli med[\\s\\S]*${code}`));
  await clickLabel(menuGuest, 'Lukk');
  await menuGuest.page.waitForFunction(() => !document.querySelector('.sheet'));
  await gear(menuGuest);
  await clickButton(menuGuest, 'Endre navn eller avatar');
  await menuGuest.page.waitForSelector('#name');
  await clickButton(menuGuest, 'Avbryt');
  await waitText(menuGuest, /Du er med/);
  if (PLAYERS < NAMES.length) {
    // leaving takes two taps, so a stray tap in a menu cannot throw anybody out of the game
    const leaver = await newPhone(NAMES[PLAYERS]);
    await leaver.page.goto(`${base}/?j=${code}`);
    await register(leaver, NAMES[PLAYERS], 0);
    await waitText(leaver, /Du er med/);
    await waitText(host, new RegExp(`Spillere\\s+${PLAYERS + 1}/10`));
    await gear(leaver);
    await clickButton(leaver, 'Forlat spillet');
    await waitText(leaver, /Trykk igjen for å forlate spillet/);
    assert.match(await bodyText(host), new RegExp(NAMES[PLAYERS]), 'one tap does not make anybody leave');
    await clickButton(leaver, 'Trykk igjen for å forlate spillet');
    await waitText(leaver, /Diskuter,?\s+manipuler\s+og\s+vinn/);
    await waitText(host, new RegExp(`Spillere\\s+${PLAYERS}/10`));
    log('the gear menu works: QR code, change profile, and leaving (two taps)');

    // the logo is a button in the lobby: back to the start screen, after asking (and the same name can come back in again)
    const leaver2 = await newPhone(NAMES[PLAYERS]);
    await leaver2.page.goto(`${base}/?j=${code}`);
    await register(leaver2, NAMES[PLAYERS], 0);
    await waitText(leaver2, /Du er med/);
    await waitText(host, new RegExp(`Spillere\\s+${PLAYERS + 1}/10`));
    await clickLabel(leaver2, 'Til hjemskjermen');
    await waitText(leaver2, /Tilbake til hjemskjermen\?/);
    assert.match(await bodyText(leaver2), /Du forlater spillet/);
    await clickButton(leaver2, 'Forlat spillet');
    await waitText(leaver2, /Diskuter,?\s+manipuler\s+og\s+vinn/);
    await waitText(host, new RegExp(`Spillere\\s+${PLAYERS}/10`));
    log('the logo asks first, and a guest who says yes is back on the start screen');
  }
  // the same question for the host, and "stay" really stays (a guest and the host, both in the lobby)
  for (const [p, said] of [[menuGuest, /Du forlater spillet/], [host, P2P ? /avsluttes for alle/ : /en annen spiller blir vert/]]) {
    await clickLabel(p, 'Til hjemskjermen');
    await waitText(p, /Tilbake til hjemskjermen\?/);
    assert.match(await bodyText(p), said);
    await clickButton(p, 'Bli i spillet');
    await p.page.waitForFunction(() => !document.querySelector('.sheet'));
  }
  await waitText(menuGuest, /Du er med/);
  assert.match(await bodyText(host), /Få med vennene dine/, 'the host is still at the invitation after choosing to stay');

  // removing a friend takes two taps: the first only arms the button
  await host.page.evaluate(() => document.querySelector('.player__kick').click());
  await waitText(host, /Fjern\?/);
  assert.match(await bodyText(host), new RegExp(NAMES[PLAYERS - 1]), 'one tap does not remove anyone');

  // the invitation says what the second step set, and the host starts
  await waitText(host, new RegExp(`Spiller til ${TARGET} poeng`));
  await clickButton(host, 'Start Disputt');

  // ------------------------------------------------------------ rounds
  const tools = { clickButton, waitText, bodyText, newPhone, shot, sleep, log };
  let payment = null;
  let round = 0;
  let finished = false;
  while (!finished && round < 30) {
    round++;
    // role reveal: nothing about the role is on anybody's screen until a finger holds the button, and every phone looks the same
    await Promise.all(all.map((p) => waitText(p, /din rolle/i, 10000 * SLOW)));
    const roleSeenAt = Date.now();
    const idleScreens = await Promise.all(all.map((p) => p.page.$eval('main', (el) => `${el.className}|${el.innerText.replace(/\s+/g, ' ')}`)));
    idleScreens.forEach((text, i) => assert.doesNotMatch(text, ROLE_WORD, `round ${round}: ${all[i].name}'s screen says nothing about the role before the button is held`));
    assert.equal(new Set(idleScreens).size, 1, `round ${round}: every phone shows the same role screen until its button is held`);
    for (const p of all) assert.equal(await p.page.$('.rolecard'), null, 'no role card before the button is held');
    if (round === 1) {
      // (the buzz is asked for in an effect, a moment after the screen is drawn)
      const buzzes = await Promise.all(
        all.map(async (p) => {
          await p.page.waitForFunction(() => window.__vibrations.length > 0, { timeout: 3000 });
          return p.page.evaluate(() => JSON.stringify(window.__vibrations));
        }),
      );
      assert.equal(new Set(buzzes).size, 1, `the role screen buzzes the same on every phone (${[...new Set(buzzes)].join(' / ')})`);
    }
    // hold: one impostor (two from six players), and only the impostors see the answer (every phone at once: the role screen is short)
    const peeks = await Promise.all(all.map((p) => holdAndRead(p, SHOTS && round === 1 ? `04-role-held-${p.name}` : null)));
    const roles = peeks.map(({ text }) => (/\bImposter\b/.test(text) ? 'impostor' : 'loyal'));
    peeks.forEach(({ text }, i) => assert.match(text, roles[i] === 'impostor' ? /\bImposter\b/ : /\bLojal\b/, `${all[i].name} sees ${roles[i]}`));
    const expectedImpostors = all.length >= 6 ? 2 : 1;
    assert.equal(roles.filter((r) => r === 'impostor').length, expectedImpostors, `round ${round}: ${expectedImpostors} impostor(s) among ${all.length}, got ${roles}`);
    const impostors = all.filter((_, i) => roles[i] === 'impostor');
    const isImpostor = (p) => impostors.includes(p);
    for (const [i, p] of all.entries()) {
      if (isImpostor(p)) assert.match(peeks[i].text, /\b[A-D]\s*\n?\s*[A-Za-zÆØÅæøå ]+/, 'an impostor sees letter + answer');
      else assert.match(peeks[i].text, /\?/, 'the loyal player gets a "?" where the impostor gets the answer');
    }
    // with two impostors each is told who the other is, in the card's third part; the loyal players get a "?" there
    for (const [i, p] of all.entries()) {
      const card = peeks[i].card;
      if (expectedImpostors === 1) assert.doesNotMatch(card, /imposterne/i, 'a lone impostor has no "Imposterne" row');
      else if (isImpostor(p)) assert.match(card, new RegExp(`imposterne .*Du og ${impostors.find((o) => o !== p).name}\\b`, 'i'), `${p.name}'s card names the other impostor`);
      else assert.match(card, /imposterne \? Finn dem sammen/i, `${p.name}'s card has a "?" where the impostors are named`);
    }
    for (const p of impostors) assert.equal(await p.page.$('.rolecard'), null, 'the card is gone when the button is let go');

    // discussion: one asker holds the question, the others only see who
    await Promise.all(
      all.map((p) =>
        p.page.waitForFunction(() => document.querySelector('.question__text') || /har spørsmålet/i.test(document.body.innerText), { timeout: 12000 * SLOW }),
      ),
    );
    if (round === 1) {
      // the role screen lasts as long as the engine says: 8 s on the real site, the test timings (FAST) elsewhere
      const shown = Date.now() - roleSeenAt;
      const expected = LIVE ? 8000 : FAST.roleMs;
      assert.ok(Math.abs(shown - expected) < 1500, `the role screen lasts about ${expected / 1000} s (it lasted ${(shown / 1000).toFixed(1)} s)`);
      log(`the role screen lasted ${(shown / 1000).toFixed(1)} s`);
    }
    const askerIndex = (await Promise.all(all.map(async (p) => (await p.page.$('.question__text')) !== null))).indexOf(true);
    assert.ok(askerIndex >= 0, `round ${round}: someone has the question`);
    const asker = all[askerIndex];
    const questionText = await asker.page.$eval('.question__text', (el) => el.textContent.trim());
    const q = QUESTIONS.find((x) => x.text === questionText);
    assert.ok(q, `known question: ${questionText}`);
    for (const p of all.filter((x) => x !== asker)) {
      assert.equal(await p.page.$('.question__text'), null, 'others never see the question');
      assert.ok(!(await bodyText(p)).includes(q.text));
      await waitText(p, /har spørsmålet/);
    }
    // what looks different between the roles is what the neighbours would see: the strip above the round, and the tip under the clock
    const strips = await Promise.all(all.map((p) => p.page.$eval('.role-strip', (el) => `${el.className}|${el.innerText.replace(/\s+/g, ' ')}`)));
    assert.equal(new Set(strips).size, 1, `round ${round}: the role strip looks the same on every phone (${[...new Set(strips)].join(' / ')})`);
    assert.doesNotMatch(strips[0], ROLE_WORD, 'the strip says nothing about the role before its button is held');
    const tips = await Promise.all(all.filter((p) => p !== asker).map((p) => p.page.$eval('.discussion__tip', (el) => el.innerText)));
    assert.equal(new Set(tips).size, 1, `round ${round}: the tip under the clock is the same for both roles`);
    if (round === 1) {
      // held, the strip gives the same role as the role screen did
      for (const [i, p] of all.entries()) {
        const { text, card, buttonText } = await holdAndRead(p);
        assert.equal(buttonText, 'Hold for å se', 'the strip\'s button keeps its text (the answer is not in it, under the finger)');
        if (roles[i] === 'impostor') assert.match(card, /Riktig svar: [A-D]: /, `${p.name}'s strip shows the right answer, beside the button`);
        assert.match(text, roles[i] === 'impostor' ? /\bImposter\b/ : /\bLojal\b/, `${p.name}'s role strip agrees with the role screen`);
        if (expectedImpostors === 2) {
          if (roles[i] === 'impostor') assert.match(card, new RegExp(`Sammen med ${impostors.find((o) => o !== p).name}\\b`), `${p.name}'s strip names the other impostor`);
          else assert.match(card, /To av dere er imposterer/);
        } else assert.doesNotMatch(card, /Sammen med|er imposterer/);
      }
      await shot(asker, '06-question-asker');
      await shot(all.find((p) => p !== asker), '07-discussion');

      // the host's options are behind the gear in the header (not under the scoreboard), and only the host has the gear
      for (const p of others) assert.equal(await p.page.$('button[aria-label="Vertsvalg"]'), null, `${p.name} is not the host and has no gear`);
      await clickLabel(host, 'Vertsvalg');
      await waitText(host, /Poengmål/);
      const options = await bodyText(host);
      for (const label of [/Hopp over denne runden/, /Avslutt spillet nå/, /Slik spiller du/]) assert.match(options, label);
      await clickLabel(host, 'Lukk');
      await host.page.waitForFunction(() => !document.querySelector('.sheet'));
      await clickLabel(host, 'Se poengtavle');
      await waitText(host, /Poengtavle/);
      assert.doesNotMatch(await bodyText(host), /Vertsvalg|Poengmål|Hopp over denne runden|Avslutt spillet nå|Slik spiller du/, 'under the scoreboard there is only the scoreboard');
      await clickLabel(host, 'Lukk');
      await host.page.waitForFunction(() => !document.querySelector('.sheet'));
      log('the host options sit behind the gear next to "Poeng"');
    }

    // asker: adjust the clock, then reload the page to prove the session survives, then answer
    await clickButton(asker, '10');
    await sleep(300);
    const clockText = await asker.page.$eval('.timer', (el) => el.textContent.replace(/\s/g, ''));
    assert.match(clockText, /^(09:5\d|10:00)$/, `clock reset to ten minutes (${clockText})`);
    if (round === 1) {
      const bystander = all.find((p) => p !== asker && p !== host) ?? host;
      await bystander.page.reload();
      await waitText(bystander, /har spørsmålet/);
      assert.match((await holdAndRead(bystander)).text, isImpostor(bystander) ? /\bImposter\b/ : /\bLojal\b/, 'role restored after reload');
      log('reload restored the session');
      if (P2P) {
        // the game lives in the host's page: reloading it must not end the game, and guests must find their way back
        await host.page.reload();
        await host.page.waitForFunction(() => document.querySelector('.question__text') || /har spørsmålet/i.test(document.body.innerText), { timeout: 30000 });
        for (const p of others) {
          // back in the round: no "connection lost" banner, and the screen is the asker's or the discussion screen again
          await p.page.waitForFunction(() => !document.querySelector('.banner') && (document.querySelector('.question__text') || /har spørsmålet/i.test(document.body.innerText)), { timeout: 40000 });
        }
        assert.match((await holdAndRead(host)).text, isImpostor(host) ? /\bImposter\b/ : /\bLojal\b/, 'host role restored after reload');
        log('the host reloaded and everybody is back in the same round');
      }
    }
    const groupRight = round % 2 === 1;
    const choice = groupRight ? q.correct : (q.correct + 1) % 4;
    await asker.page.evaluate((i) => document.querySelectorAll('.option')[i].click(), choice);
    await sleep(200);
    await clickButton(asker, 'Lås svaret');

    // countdown: every phone looks the same and says what was locked, and none of them says whether it was right
    await Promise.all(all.map((p) => waitText(p, /Svaret er låst/i)));
    const lockedAs = `${'ABCD'[choice]}: ${q.options[choice]}`;
    // (the screen itself, `main`: a toast, such as the notice that a seat changed phones, comes and goes on its own, per phone)
    const counting = await Promise.all(all.map((p) => p.page.evaluate(() => ({ screen: document.querySelector('main').innerText.replace(/\s+/g, ' '), whole: document.body.innerText.replace(/\s+/g, ' ') }))));
    // (the seconds are masked: two phones can be a tick apart when they are read)
    assert.equal(new Set(counting.map((c) => c.screen.replace(/\d/g, '#'))).size, 1, `round ${round}: the countdown looks the same on every phone (${[...new Set(counting.map((c) => c.screen))].join(' / ')})`);
    counting.forEach((c, i) => {
      assert.ok(c.screen.includes(`Dere låste ${lockedAs}`), `${all[i].name}'s countdown says what was locked: ${lockedAs} (${c.screen})`);
      assert.doesNotMatch(c.whole, /Riktig!|Feil!|Riktig svar/, 'the countdown does not say whether it was right');
    });

    // the reveal is spoken: the same screen on every phone, with nothing about the verdict, the answer or the impostors,
    // and a button only for the asker
    await Promise.all(all.map((p) => waitText(p, /avslører seg/i, 8000 * SLOW)));
    const stage = await Promise.all(
      all.map((p) =>
        p.page.evaluate(() => ({
          body: document.querySelector('.stage__body')?.innerText.replace(/\s+/g, ' ') ?? '',
          strip: document.querySelector('.role-strip')?.innerText.replace(/\s+/g, ' ') ?? '',
          whole: document.body.innerText.replace(/\s+/g, ' '),
          buttons: [...document.querySelectorAll('button')].map((b) => b.innerText.trim()),
        })),
      ),
    );
    assert.equal(new Set(stage.map((s) => s.body)).size, 1, `round ${round}: the reveal looks the same on every phone (${[...new Set(stage.map((s) => s.body))].join(' / ')})`);
    assert.equal(new Set(stage.map((s) => s.strip)).size, 1, `round ${round}: and so does the role strip`);
    assert.match(stage[0].body, expectedImpostors === 2 ? /Imposterne avslører seg/ : /Imposteren avslører seg/);
    stage.forEach((s, i) => {
      assert.doesNotMatch(s.whole, /Riktig!|Feil!|Riktig svar|Gruppa hadde rett|lurte dere|Imposter(en|ne) var/, `${all[i].name}'s screen reveals nothing`);
      // (as text, not as a pattern: an answer such as "Falling Feather (rødvin)" has characters that mean something in one)
      if (q.options[q.correct].length >= 5) assert.ok(!s.whole.includes(q.options[q.correct]), `${all[i].name}'s screen does not say the right answer`);
      assert.equal(s.buttons.some((b) => b.includes('Det er sagt')), all[i] === asker, `only the asker has the button (${all[i].name})`);
    });
    if (round === 1) {
      // an impostor can still look the answer up, on the strip, beside the button
      const { card } = await holdAndRead(impostors[0]);
      assert.match(card, /Riktig svar: [A-D]: /, 'an impostor can read the answer on the strip while the reveal is on');
      await shot(asker, '08-reveal');
      await shot(all.find((p) => p !== asker), '08b-reveal-wait');
    }
    // a double tap on "Det er sagt": the second tap hits a screen that is already out of date, and must not show an error
    await asker.page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.innerText.includes('Det er sagt'));
      b.click();
      b.click();
    });
    await waitText(asker, /Poengene|vant!|Delt seier/i, 8000 * SLOW);
    await sleep(300);
    // (the notice that a seat was taken over by a new phone is a toast too, and is meant to be there)
    const toasts = await asker.page.$$eval('.toast', (els) => els.map((e) => e.innerText));
    assert.deepEqual(toasts.filter((t) => !/^Plassen til .* ble tatt over av en ny telefon\.$/.test(t)), [], 'no error toast after a double tap');

    // the points (or the winner)
    await Promise.all(all.map((p) => waitText(p, /Poengene|vant!|Delt seier/i, 8000 * SLOW)));
    const hostText = await bodyText(host);
    finished = /vant!|Delt seier/i.test(hostText);
    if (round === 1) await shot(host, '09-summary');
    if (!finished) {
      assert.match(hostText, groupRight ? /Gruppa hadde rett/ : /Imposter(en|ne) lurte dere/);
      // nobody is named: the impostors have said it out loud
      assert.equal(await host.page.$('.impostor-card'), null, 'no card names the impostors');
      assert.doesNotMatch(hostText, /Imposter(en|ne) var/);
      // the points went to the right players: every loyal player when the group was right, the impostors when it was not
      const rows = await host.page.$$eval('.scoreboard .score', (els) => els.map((el) => ({ name: el.querySelector('.score__name').innerText.replace(/\s*\(deg\)\s*/, '').trim(), gain: Boolean(el.querySelector('.score__gain')) })));
      const gainers = rows.filter((r) => r.gain).map((r) => r.name).sort();
      const expected = all.filter((p) => (groupRight ? !isImpostor(p) : isImpostor(p))).map((p) => p.name).sort();
      assert.deepEqual(gainers, expected, `round ${round}: the points went to ${expected.join(', ')}`);
      // "Se fasit" has the right answer, what was locked and who the impostors were
      await clickButton(host, 'Se fasit');
      await waitText(host, /Fasit/);
      const key = await host.page.$eval('.sheet', (el) => el.innerText.replace(/\s+/g, ' '));
      assert.ok(key.includes(q.options[q.correct]), `the answer key shows the right answer (${key})`);
      assert.ok(key.includes(lockedAs), `the answer key shows what was locked (${lockedAs})`);
      assert.match(key, expectedImpostors === 2 ? /imposterne var/i : /imposteren var/i);
      for (const p of impostors) assert.ok(key.includes(p.name), `the answer key names ${p.name} (${key})`);
      await clickLabel(host, 'Lukk');
      await host.page.waitForFunction(() => !document.querySelector('.sheet'));
      assert.match(await bodyText(others[0]), /Venter på at verten starter neste runde/);

      // a phone loses its browser data mid-game: the player re-enters through the QR link and takes their old seat
      if (round === 1 && others.length >= 3) {
        const lost = others[others.length - 1];
        await lost.ctx.close();
        const fresh = await newPhone(lost.name);
        await fresh.page.goto(`${base}/?j=${code}`);
        await waitText(fresh, /Spillet har startet/i);
        await shot(fresh, '12-seat-picker');
        const seatShown = (n) => fresh.page.evaluate((n) => [...document.querySelectorAll('.player')].some((el) => el.innerText.includes(n)), n);
        // over WebRTC the host needs a little while to notice that a phone has vanished; "Sjekk på nytt" asks again
        for (let tries = 0; !(await seatShown(lost.name)); tries++) {
          assert.ok(tries < (P2P ? 14 : 4), `the seat of ${lost.name} became available`);
          await sleep(P2P ? 5000 : 400);
          if (await seatShown(lost.name)) break;
          await clickButton(fresh, 'Sjekk på nytt');
          await waitText(fresh, /Spillet har startet/i);
        }
        await fresh.page.evaluate((n) => [...document.querySelectorAll('.player')].find((el) => el.innerText.includes(n)).click(), lost.name);
        await waitText(fresh, /Venter på at verten starter neste runde/);
        all[all.indexOf(lost)] = fresh;
        others[others.indexOf(lost)] = fresh;
        // everybody else is told that the seat changed phones (claiming a seat needs no secret, so it has to be visible)
        await waitText(host, new RegExp(`Plassen til ${lost.name} ble tatt over av en ny telefon`), 5000);
        log('a fresh phone took over the lost seat, and the host was told');
      }
      // a guest has the scoreboard open when the host starts the next round: the role reveal must not be hidden behind it
      const guest = others[0];
      await guest.page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.includes('Poeng')).click());
      await guest.page.waitForSelector('.sheet-backdrop');
      if ((PAY || PAY_SHOP) && round === FREE_ROUNDS) {
        // the host has to pay before the third round (and the first round of the paid part starts from the thank-you sheet)
        payment = PAY_SHOP
          ? await payAfterFreeRoundsShop(tools, { host, others, stack, holdMs: PAY_SHOP_SLOW ? 75_000 : 0 })
          : await payAfterFreeRounds(tools, { host, others, server, holdMs: PAY_SLOW ? 75_000 : 0 });
      } else await clickButton(host, 'Neste runde');
      await waitText(guest, /din rolle/i);
      assert.equal(await guest.page.$('.sheet-backdrop'), null, 'sheets close when a new round starts');
    }
  }

  assert.ok(finished, 'the game ended with a winner');
  await shot(host, '10-finished-host');
  await shot(others[0], '11-finished-guest');
  const finalText = await bodyText(host);
  assert.match(finalText, /Sluttresultat/);
  log(`game finished after ${round} rounds: ${finalText.match(/(\S+ vant!|Delt seier!)/)?.[1]}`);

  if (PAY || PAY_SHOP) {
    assert.ok(payment, 'the host was asked to pay after the free rounds');
    // (no more packages after that: the host has paid, and every round up to the winner started without asking again)
    if (PAY_SHOP) await buyAndComeBackShop(tools, { base, stack });
    else await buyAndComeBackByTheBackButton(tools, { base, server });
    // (a code works on the phone that paid in the demo, not on another one: tools/qa/demoflow.mjs plays "Logg inn" there)
    if (!DEMO) await restoreOnNewPhone(tools, { base, code: payment.code });
  }

  // play again returns everyone to the lobby with scores reset
  await clickButton(host, 'Spill igjen');
  await Promise.all(all.map((p) => waitText(p, /Spillere/)));
  log('play again -> lobby ok');

  // the host's logo ends the game for everybody when the host's page is the game; with a server the host just leaves
  await clickLabel(host, 'Til hjemskjermen');
  await waitText(host, /Tilbake til hjemskjermen\?/);
  await clickButton(host, P2P ? 'Avslutt spillet' : 'Forlat spillet');
  await waitText(host, /Diskuter,?\s+manipuler\s+og\s+vinn/);
  if (P2P) for (const p of others) await waitText(p, /Spillet er avsluttet/, 15000 * SLOW);
  log(P2P ? 'the host chose "end the game" behind the logo: everybody else is told it is over' : 'the host left through the logo');
  assert.deepEqual(problems, [], 'no page errors and nothing blocked by the Content-Security-Policy');
  log('\nUI END-TO-END: OK');
} catch (err) {
  console.error('\nUI END-TO-END FAILED:', err.message);
  // (an assertion says what was wrong; anything else, such as a browser error, also needs to say where)
  if (err.name !== 'AssertionError') console.error(String(err.stack).split('\n').slice(1, 7).join('\n'));
  if (SHOTS) for (const p of phones) await p.page.screenshot({ path: `tmp/play/FAIL-${p.name}.png` }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
  await Promise.race([site.stop(), sleep(4000)]);
  await stack?.stop();
  process.exit(process.exitCode ?? 0); // the local PeerJS server may keep sockets open; do not hang on them
}
