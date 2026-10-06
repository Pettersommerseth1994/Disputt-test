// Visual QA: renders every screen at phone size from engine-generated views and saves PNGs to tmp/shots/.
//   node tools/qa/shots.mjs [filter]      e.g. node tools/qa/shots.mjs role
// Needs Google Chrome (set CHROME_PATH to override) and `npm install` (puppeteer-core).
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { createApp } from '../../server/index.js';
import { buildFixtures } from './fixtures.mjs';
import { PAY_BASE, SHOP_INFO, payScreens } from './payfixtures.mjs';

const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const [VW, VH] = (process.env.VIEWPORT ?? '390x844').split('x').map(Number); // e.g. VIEWPORT=375x667 for an iPhone SE
const OUT = VW === 390 && VH === 844 ? 'tmp/shots' : `tmp/shots-${VW}x${VH}`;
const DOCS = process.argv.includes('--docs'); // also write 1x-viewport WebPs for the style guide gallery
const filter = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? '';
const DOCS_DIR = 'public/design-system/screens';
// the screens shown in the style guide gallery (keep in sync with SCREENS in public/design-system/ds.js)
const DOC_KEYS = new Set(['home', 'profile-new', 'setup-points', 'lobby-host-3', 'lobby-guest-3', 'role-impostor', 'role-impostor-held', 'role-impostor-duo-held', 'question-asker-selected', 'discussion-impostor', 'countdown-asker', 'reveal-wait', 'summary-wrong-host', 'finished-host', 'sheet-scores', 'sheet-fasit', 'pay-gate', 'pay-thanks', 'pay-login', 'pay-guest-host-away']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.mkdirSync(OUT, { recursive: true });
if (DOCS) fs.mkdirSync(DOCS_DIR, { recursive: true });
const app = createApp({ port: 0, host: '127.0.0.1', silent: true });
const port = await app.listen();
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: VW, height: VH, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message));
page.on('console', (m) => ['error', 'warning'].includes(m.type()) && console.error(`console.${m.type()}:`, m.text()));
page.on('requestfailed', (r) => console.error('FAILED:', r.url().replace(/^http:\/\/127\.0\.0\.1:\d+/, '')));

const url = `http://127.0.0.1:${port}/?debug=offline`;
const shot = async (name, opts = {}) => {
  if (filter && !name.includes(filter)) return;
  await sleep(opts.wait ?? 800);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: opts.full ?? true });
  const key = name.replace(/^\d+-/, '');
  if (DOCS && DOC_KEYS.has(key)) {
    const png = await page.screenshot({ fullPage: false });
    await sharp(png).resize(390).webp({ quality: 70, effort: 6 }).toFile(`${DOCS_DIR}/${key}.webp`);
  }
  console.log('shot', name);
};

async function show(view, extra = {}) {
  await page.evaluate((view, extra) => {
    window.__realNow ??= Date.now.bind(Date);
    const delta = view.now - window.__realNow();
    Date.now = () => window.__realNow() + delta; // make the injected timestamps line up with "now"
    window.__disputt.setStore({
      conn: 'open', everOpened: true, view, sheet: null, editing: false, seats: null, qaHold: false,
      session: { code: view.code, playerId: view.you.id, token: 'qa' },
      info: { publicUrl: null, lanUrls: ['http://192.168.100.59:3000'] },
      ...extra,
    });
  }, view, extra);
}

await page.goto(url, { waitUntil: 'networkidle0' });
await page.evaluate((info) => window.__disputt.setShop(info), SHOP_INFO); // (the packages of a Shopify shop have nobody to ask where the shop is)
await page.evaluate(() => window.__disputt.setStore({ conn: 'open', everOpened: true }));
await shot('00-home');
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Bli med i spill'))?.click());
await shot('01-join-code', { wait: 400 });
await page.evaluate(() => window.__disputt.setStore({ sheet: 'rules' }));
await shot('02-rules', { full: false });
await page.evaluate(() => window.__disputt.setStore({ sheet: null }));

const f = buildFixtures();
const order = [
  'profile-new', 'profile-edit', 'lobby-host-new', 'setup-points', 'lobby-host-1', 'lobby-host-3', 'lobby-host-5', 'lobby-guest-3',
  'role-impostor', 'role-impostor-held', 'role-loyal', 'role-loyal-held', 'role-impostor-duo-held', 'role-loyal-duo-held', 'discussion-impostor-duo-held',
  'question-asker', 'question-asker-selected', 'question-asker-timeup', 'discussion-impostor', 'discussion-impostor-held', 'discussion-loyal', 'discussion-host', 'discussion-low',
  'countdown-asker', 'countdown-other', 'reveal-asker', 'reveal-host-asker', 'reveal-wait', 'reveal-duo-wait',
  'summary-right-host', 'summary-right-guest', 'summary-wrong-host', 'summary-wrong-guest', 'summary-duo-wrong-host', 'lobby-host-6',
  'finished-host', 'finished-guest',
];
const LONG = new Set(['lobby-host-new', 'lobby-host-1', 'lobby-host-3', 'lobby-host-5', 'summary-right-host', 'summary-wrong-host', 'finished-host']);
let i = 3;
for (const key of order) {
  // (a key ending in "-held" is the same screen with every hold-to-see button held, as with a finger on the screen)
  const held = key.endsWith('-held');
  await show(f[held ? key.slice(0, -'-held'.length) : key], { ...(key === 'profile-edit' ? { editing: true } : {}), ...(key === 'setup-points' ? { step: 2 } : { step: null }), ...(held ? { qaHold: true } : {}) });
  const name = `${String(i++).padStart(2, '0')}-${key}`;
  await shot(name, { wait: key.startsWith('role') || key.startsWith('finished') ? 900 : 650 });
  // what a phone really shows after scrolling down: the dock sticks to the bottom of the viewport
  if (LONG.has(key) && (!filter || name.includes(filter))) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await sleep(250);
    await page.screenshot({ path: `${OUT}/${name}-bottom.png`, fullPage: false });
    await page.evaluate(() => window.scrollTo(0, 0));
  }
}
await show(f['lobby-host-3'], { sheet: 'qr' });
await shot('90-sheet-qr', { full: false });
await show(f['summary-wrong-host'], { sheet: 'scores' });
await shot('91-sheet-scores', { full: false });
await show(f['summary-wrong-host'], { sheet: 'host' });
await shot('92-sheet-host', { full: false });
await show(f['lobby-host-3'], { sheet: 'home' });
await shot('93-sheet-home-host', { full: false });
await show(f['summary-wrong-host'], { sheet: 'fasit' });
await shot('95-sheet-fasit', { full: false });
await show(f['summary-duo-wrong-host'], { sheet: 'fasit' });
await shot('96-sheet-fasit-duo', { full: false });
await show(f['lobby-guest-3'], { sheet: 'home' });
await shot('94-sheet-home-guest', { full: false });

// payments: the packages the host meets after the free rounds, the sheets that belong to them, and what a guest sees while the host pays
let n = 97;
for (const [key, patch] of payScreens(f)) {
  const { view, ...rest } = patch;
  if (view) await show(view, { ...PAY_BASE, ...rest });
  else await page.evaluate((state) => window.__disputt.setStore({ view: null, session: null, sheet: null, editing: false, seats: null, joining: null, creating: false, notice: null, qaHold: false, step: null, conn: 'open', everOpened: true, ...state }), { ...PAY_BASE, ...rest });
  await shot(`${n++}-${key}`, { full: false });
}

await browser.close();
await app.close();
console.log(`done -> ${OUT}/`);
