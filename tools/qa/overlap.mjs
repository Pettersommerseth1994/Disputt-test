// Text and buttons must never be drawn on top of other things, or cut off, on any screen of the game. The rules:
//   1. The bar at the bottom of a screen (`.dock`) is frozen to the screen only when it carries the screen's main action,
//      a button, and it has a solid background: nothing that scrolls underneath may show through its text or its button.
//   2. A bar that only has text or links (waiting for the host, "how to play") is not frozen at all: it is `.foot`.
//   3. No two pieces of visible text overlap, wherever the page is scrolled to.
//   4. No text runs off the edge of the screen (the app clips sideways overflow, so it would just be cut off).
//   5. No text is cut off by its own box (a long name clipped at the edge).
//   6. What a hold-to-see button reveals is not on or under that button, where the finger that holds it would cover it
//      (checked on every screen that is shown "held").
// The solid-background rule is checked on pixels: the bar is photographed as it is, then again with everything else on
// the page hidden. If the two pictures differ, something showed through.
//
// Every screen is checked: all game views, the screens without a game (start page, join by code, connecting, seat picker,
// "opened elsewhere") and the sheets. Not only with the friendly test data but also with the worst the game accepts
// (ten players, the widest 14-letter names, the longest question and answers, two-digit scores) and with larger text.
//   node tools/qa/overlap.mjs                 the whole plan (a minute or two)
//   node tools/qa/overlap.mjs 390x664 …       the same plan, on just these screen sizes
//   node tools/qa/overlap.mjs --font=150      just the friendly and the worst-case data, with the text 150% larger
//   node tools/qa/overlap.mjs --self-test     breaks the layout on purpose, four ways, and checks that the rules notice
//   exits non-zero when a screen breaks a rule
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { createApp } from '../../server/index.js';
import { buildFixtures } from './fixtures.mjs';
import { PAY_BASE, SHOP_INFO, payScreens } from './payfixtures.mjs';
import { underTheFinger } from './underfinger.mjs';

const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const asked = process.argv.slice(2).filter((a) => /^\d+x\d+$/.test(a));

// font: the root font size in percent. Everything is sized in rem, so 125 stands for someone who has made the text
// bigger in the browser or the phone's settings, and 150 is a harsher version of the same.
const PLAN = [
  { label: 'friendly test data', stress: false, font: 100, sizes: ['390x664', '375x553', '430x740', '360x640'] },
  { label: 'worst case: ten players, widest names, longest texts', stress: true, font: 100, sizes: ['390x664', '360x640'] },
  { label: 'text 125% larger', stress: false, font: 125, sizes: ['390x664'] },
  { label: 'worst case + text 125% larger', stress: true, font: 125, sizes: ['390x664'] },
].map((p) => ({ ...p, sizes: asked.length ? asked : p.sizes }));
const fontArg = process.argv.find((a) => a.startsWith('--font='));
if (fontArg) {
  const font = Number(fontArg.slice('--font='.length));
  PLAN.length = 0;
  for (const stress of [false, true]) PLAN.push({ label: `${stress ? 'worst case' : 'friendly test data'}, text ${font}%`, stress, font, sizes: asked.length ? asked : ['390x664'] });
}

const app = createApp({ port: 0, host: '127.0.0.1', silent: true });
const port = await app.listen();
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--hide-scrollbars'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message));
await page.goto(`http://127.0.0.1:${port}/?debug=offline`, { waitUntil: 'networkidle0' });

/** Put the app in a state: everything not mentioned goes back to "nothing special". */
const BASE = { view: null, session: null, seats: null, joining: null, creating: false, replaced: false, notice: null, sheet: null, editing: false, step: null, stuck: 0, toast: null, conn: 'open', everOpened: true, qaHold: false, route: { page: 'home' }, ...PAY_BASE };
const put = (patch) =>
  page.evaluate(
    (base, patch) => {
      window.__realNow ??= Date.now.bind(Date);
      if (patch.view) {
        const delta = patch.view.now - window.__realNow();
        Date.now = () => window.__realNow() + delta; // makes the timestamps in the view line up with "now"
        patch = { session: { code: patch.view.code, playerId: patch.view.you.id, token: 'qa' }, info: { publicUrl: null, lanUrls: ['http://192.168.100.59:3000'] }, ...patch };
      }
      window.__disputt.setStore({ ...base, ...patch });
    },
    BASE,
    patch,
  );

function screensFor(fixtures) {
  const seatsOf = (view) => view.players.filter((p) => !p.isHost).map((p) => ({ id: p.id, name: p.name, avatar: p.avatar }));
  const list = [
    ['home', () => put({})],
    ['home-notice', () => put({ notice: 'Spillet er avsluttet.' })],
    ...Object.entries(fixtures).map(([key, view]) => [key, () => put({ view, editing: key === 'profile-edit', step: key === 'setup-points' ? 2 : null })]),
    // the screens with a hold-to-see button, with every such button held: the role card, and the role strip turned cream
    ...Object.entries(fixtures)
      .filter(([key]) => /^(role|question|discussion|reveal)/.test(key))
      .map(([key, view]) => [`${key}-held`, () => put({ view, qaHold: true })]),
    // payments: the start screen for customers, the packages, and the sheets and banners that belong to them
    ...payScreens(fixtures).map(([key, patch]) => [key, () => put(patch)]),
    ['connecting-join', () => put({ joining: 'ABCD', conn: 'closed', stuck: 2, route: { page: 'join', code: 'ABCD' } })],
    ['connecting-create', () => put({ creating: true })],
    ['seat-picker', () => put({ seats: { code: 'KRAP', seats: seatsOf(fixtures['lobby-host-3']) } })],
    ['replaced', () => put({ replaced: true })],
    ['sheet-rules', () => put({ view: fixtures['lobby-guest-3'], sheet: 'rules' })],
    ['sheet-scores-host', () => put({ view: fixtures['summary-wrong-host'], sheet: 'scores' })],
    ['sheet-scores-guest', () => put({ view: fixtures['summary-wrong-guest'], sheet: 'scores' })],
    ['sheet-host', () => put({ view: fixtures['summary-wrong-host'], sheet: 'host' })],
    ['sheet-host-offline', () => put({ view: fixtures['summary-offline-host'], sheet: 'host' })],
    ['sheet-fasit', () => put({ view: fixtures['summary-wrong-host'], sheet: 'fasit' })],
    ['sheet-fasit-duo', () => put({ view: fixtures['summary-duo-wrong-host'], sheet: 'fasit' })],
    ['sheet-qr', () => put({ view: fixtures['lobby-host-3'], sheet: 'qr' })],
    ['sheet-settings', () => put({ view: fixtures['lobby-guest-3'], sheet: 'settings' })],
    ['sheet-home-host', () => put({ view: fixtures['lobby-host-3'], sheet: 'home' })],
    ['sheet-home-guest', () => put({ view: fixtures['lobby-guest-3'], sheet: 'home' })],
    // last: this one lives in the start page's own state, and only another screen leaves it
    [
      'join-by-code',
      async () => {
        await put({});
        await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.includes('Bli med i spill')).click());
      },
    ],
  ];
  return list;
}

/** The pixels of a rectangle given in viewport coordinates (a screenshot's own clip option counts from the top of the document). */
const raw = async (rect) => {
  const png = await page.screenshot({ captureBeyondViewport: false });
  const { data, info } = await sharp(png).extract({ left: rect.x, top: rect.y, width: rect.width, height: rect.height }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, info };
};
/** Share of pixels that differ visibly between two photographs of the same rectangle. */
const difference = (a, b) => {
  let bad = 0;
  const n = a.data.length / 4;
  for (let i = 0; i < a.data.length; i += 4) {
    const d = Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]));
    if (d > 14) bad++;
  }
  return bad / n;
};

/** Rules 3 and 5, measured in the page: overlapping visible text, and text cut off by its own box. */
const measureText = () =>
  page.evaluate(() => {
    const lines = [];
    const clipped = [];
    const offscreen = [];
    // Does something opaque sit on top of this point, between the viewer and the text's own element? (A transparent box on
    // top hides nothing: the text under it is still seen.)
    const opaque = (e) => {
      const c = getComputedStyle(e).backgroundColor.match(/[\d.]+/g);
      return c && c.length >= 3 && (c.length < 4 || Number(c[3]) >= 0.95);
    };
    const hiddenUnder = (el, x, y) => {
      for (const e of document.elementsFromPoint(x, y)) {
        if (e === el || el.contains(e) || e.contains(el)) return false;
        if (opaque(e)) return true;
      }
      return false;
    };
    const walker = document.createTreeWalker(document.querySelector('#app'), NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent.trim();
      const el = n.parentElement;
      if (!text || !el || getComputedStyle(el).visibility === 'hidden' || el.closest('.confetti, .decor, [aria-hidden="true"], .sr-only')) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const box = el.getBoundingClientRect();
      for (const line of range.getClientRects()) {
        if (line.width >= 3 && line.height >= 3 && line.bottom > 0 && line.top < innerHeight && (line.right > innerWidth + 1 || line.left < -1)) {
          offscreen.push(`"${text.slice(0, 24)}" runs off the edge of the screen`);
        }
        // A line's own box can be taller than what is drawn (a big numeral with a tight line-height): keep to the element's box.
        const r = { left: Math.max(line.left, box.left), right: Math.min(line.right, box.right), top: Math.max(line.top, box.top), bottom: Math.min(line.bottom, box.bottom) };
        r.width = r.right - r.left;
        r.height = r.bottom - r.top;
        if (r.width < 3 || r.height < 3 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
        // is this text seen at all? (something opaque on top of it hides it, which is fine)
        const cx = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2));
        const cy = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2));
        if (hiddenUnder(el, cx, cy)) continue;
        lines.push({ text: text.slice(0, 24), el, r });
      }
      // rule 5: the text is wider than the box that holds it, and the box hides the rest
      for (let box2 = el; box2 && box2 !== document.body; box2 = box2.parentElement) {
        const s = getComputedStyle(box2);
        if ((s.overflowX === 'hidden' || s.overflowX === 'clip') && s.textOverflow !== 'ellipsis' && box2.scrollWidth > box2.clientWidth + 1 && !box2.matches('#app, .sheet-backdrop, .home, .finale')) {
          clipped.push(`"${text.slice(0, 24)}" is cut off by ${box2.tagName.toLowerCase()}.${String(box2.className).split(' ')[0]}`);
          break;
        }
      }
    }
    const overlapping = [];
    for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        const a = lines[i];
        const b = lines[j];
        if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (w > 2 && h > 2 && (w * h) / Math.min(a.r.width * a.r.height, b.r.width * b.r.height) > 0.2) {
          // Where something solid lies on top of one of the two, that one is covered, not overlapped: a bar that sticks to the top hides
          // the heading that scrolls under it, like the bottom bar does (rule 1 sees to it that the bar is solid). The same bar made
          // see-through is not exempt (the self-test checks both).
          const x = Math.min(innerWidth - 1, Math.max(0, Math.max(a.r.left, b.r.left) + w / 2));
          const y = Math.min(innerHeight - 1, Math.max(0, Math.max(a.r.top, b.r.top) + h / 2));
          if (hiddenUnder(a.el, x, y) || hiddenUnder(b.el, x, y)) continue;
          overlapping.push(`"${a.text}" over "${b.text}"`);
        }
      }
    }
    return { overlapping: [...new Set(overlapping)], clipped: [...new Set(clipped)], offscreen: [...new Set(offscreen)] };
  });

if (process.argv.includes('--self-test')) {
  // A checker that never complains proves nothing. Break the layout in three known ways and see that each one is reported.
  const stress = buildFixtures({ stress: true });
  await page.setViewport({ width: 390, height: 664, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.evaluate((info) => window.__disputt.setShop(info), SHOP_INFO); // (the packages of a Shopify shop have nobody to ask where the shop is; and the browser reloads the page when the viewport first becomes a phone's, which forgets it)
  // (measured at the top, halfway and at the bottom of the page, like the real run: the player list is below the first screenful)
  const everywhere = (pick) => async () => {
    const max = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    let total = 0;
    for (const y of [0, Math.round(max / 2), max]) {
      await page.evaluate((y) => window.scrollTo(0, Math.max(0, y)), y);
      await sleep(150);
      total += pick(await measureText()).length;
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    return total;
  };
  const faults = [
    ['names pushed into each other', () => put({ view: stress['lobby-host-3'] }), '.player { margin-inline: -1.6rem !important; }', everywhere((m) => m.overlapping)],
    ['a name cut off by its box', () => put({ view: stress['lobby-host-3'] }), '.player__name { display: block !important; width: 2.2rem !important; overflow: hidden !important; text-overflow: clip !important; white-space: nowrap !important; }', everywhere((m) => m.clipped)],
    ['a page wider than the screen (the app clips it, so text just runs off the edge)', () => put({ view: stress['lobby-host-3'] }), 'main { width: 125vw !important; }', everywhere((m) => m.offscreen)],
    ['what a hold reveals ends up under the button that is held', () => put({ view: stress['discussion-impostor-duo'], qaHold: true }), '.role-strip__info { order: 2 !important; flex: 1 1 100% !important; }', async () => (await page.evaluate(underTheFinger)).length],
  ];
  let missed = 0;
  for (const [what, setup, css, count] of faults) {
    await setup();
    await sleep(900);
    await page.addStyleTag({ content: `${css} /* qa-fault */` });
    await sleep(200);
    const found = await count();
    await page.evaluate(() => document.querySelectorAll('style').forEach((s) => s.textContent.includes('qa-fault') && s.remove()));
    console.log(`${found > 0 ? 'noticed' : 'MISSED '}  ${what}${found > 0 ? ` (${found})` : ''}`);
    if (!found) missed++;
  }
  // The other way round: something solid on top is covering, not overlap, and the same thing made see-through is overlap. (The "checking
  // the payment" banner at the top hides the points heading that scrolls under it; that must not be called text over text, and a
  // banner that let the heading show through must not be let off.)
  await put(Object.fromEntries(payScreens(buildFixtures({ stress: false })))['pay-checking']);
  await page.evaluate(() => (document.documentElement.style.fontSize = '125%'));
  await sleep(900);
  await page.evaluate(() => window.scrollTo(0, Math.round((document.documentElement.scrollHeight - innerHeight) / 2)));
  await sleep(250);
  const solid = (await measureText()).overlapping.length;
  await page.addStyleTag({ content: '.banner { background: transparent !important; } /* qa-fault */' });
  await sleep(150);
  const seeThrough = (await measureText()).overlapping.length;
  const rightWay = solid === 0 && seeThrough > 0;
  console.log(`${rightWay ? 'right  ' : 'WRONG '}  a solid bar over scrolled text covers it (${solid} overlaps), the same bar see-through does not (${seeThrough})`);
  if (!rightWay) missed++;
  await browser.close();
  await app.close();
  if (missed) {
    console.error(`\n${missed} deliberate fault(s) went unnoticed.`);
    process.exit(1);
  }
  console.log('\nAll deliberate faults were noticed.');
  process.exit(0);
}

let failures = 0;
let screensChecked = 0;
let barsChecked = 0;
for (const plan of PLAN) {
  const screens = screensFor(buildFixtures({ stress: plan.stress }));
  await page.evaluate((p) => (document.documentElement.style.fontSize = p === 100 ? '' : `${p}%`), plan.font);
  for (const size of plan.sizes) {
    const [w, h] = size.split('x').map(Number);
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await page.evaluate((info) => window.__disputt.setShop(info), SHOP_INFO); // (the packages of a Shopify shop have nobody to ask where the shop is; and the browser reloads the page when the viewport first becomes a phone's, which forgets it)
    const problems = [];
    for (const [key, setup] of screens) {
      await setup();
      await sleep(/^(role|finished)/.test(key) ? 1300 : 850); // entrance animations
      screensChecked++;
      const maxScroll = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
      // rules 3 and 5, at the top, halfway and at the bottom of the page
      for (const at of [0, Math.round(maxScroll / 2), maxScroll]) {
        await page.evaluate((y) => window.scrollTo(0, Math.max(0, y)), at);
        await sleep(180);
        const { overlapping, clipped, offscreen } = await measureText();
        for (const c of overlapping) problems.push(`${key}: text over text (scrolled to ${Math.max(0, at)}px): ${c}`);
        for (const c of clipped) problems.push(`${key}: ${c}`);
        for (const c of offscreen) problems.push(`${key}: ${c}`);
        if (maxScroll <= 0) break;
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      // (rule 4 is part of measureText; a page that scrolls sideways is also a problem)
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      if (sideways > 1) problems.push(`${key}: the page is ${sideways}px wider than the screen`);
      // rule 6
      if (key.endsWith('-held')) for (const text of await page.evaluate(underTheFinger)) problems.push(`${key}: ${text} sits on or under the hold button, where the finger covers it`);
      // rules 1 and 2
      const facts = await page.evaluate(() => {
        const dock = document.querySelector('main .dock');
        if (!dock) return null;
        const style = getComputedStyle(dock);
        return {
          sticky: style.position === 'sticky' || style.position === 'fixed',
          hasButton: Boolean(dock.querySelector('.btn:not(.btn--text)')),
          scrolls: document.documentElement.scrollHeight > innerHeight + 1,
          maxScroll: document.documentElement.scrollHeight - innerHeight,
        };
      });
      if (!facts) continue;
      barsChecked++;
      if (facts.sticky && !facts.hasButton) problems.push(`${key}: the bar only has text or links but is frozen to the screen (give it class "foot" instead of "dock")`);
      if (facts.sticky && facts.scrolls) {
        for (const at of [0, Math.round(facts.maxScroll / 2)]) {
          await page.evaluate((y) => window.scrollTo(0, y), at);
          await sleep(250);
          const rect = await page.evaluate(() => {
            const r = document.querySelector('main .dock').getBoundingClientRect();
            return { x: Math.max(0, Math.floor(r.left)), y: Math.max(0, Math.floor(r.top)), width: Math.ceil(Math.min(r.width, innerWidth)), height: Math.ceil(Math.min(r.height, innerHeight - r.top)) };
          });
          const asIs = await raw(rect);
          // everything in the screen is hidden except the bar and what is in it (the bar may sit inside a form: hide by visibility)
          await page.addStyleTag({ content: 'main * { visibility: hidden !important; } main .dock, main .dock * { visibility: visible !important; } #qa-hide {}' });
          await sleep(100);
          const alone = await raw(rect);
          await page.evaluate(() => document.querySelectorAll('style').forEach((s) => s.textContent.includes('#qa-hide') && s.remove()));
          const share = difference(asIs, alone);
          if (share > 0.004) problems.push(`${key}: ${(share * 100).toFixed(1)}% of the bar's pixels show something from underneath (scrolled to ${at}px)`);
        }
        await page.evaluate(() => window.scrollTo(0, 0));
      }
    }
    failures += problems.length;
    console.log(`${plan.label} @ ${size}: ${problems.length ? `${problems.length} problem(s)\n  ${problems.join('\n  ')}` : 'ok'}`);
  }
}
await browser.close();
await app.close();
if (failures) {
  console.error(`\n${failures} problem(s) with overlapping or cut-off text.`);
  process.exit(1);
}
console.log(`\n${screensChecked} screen checks and ${barsChecked} bottom bars: nothing overlaps, nothing is cut off, bars are solid, and only bars with a button are frozen.`);
