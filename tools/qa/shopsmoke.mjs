// The real thing, up to the checkout and not a step further: a deployed copy of the game, its payment server and the real Shopify shop.
// Nothing is bought and nothing is typed into the checkout. The host's phone is made to show the packages (through the page's ?debug hook,
// the way toast.mjs does), the box is ticked, "Gå til betaling" is pressed, and the new tab is looked at: is it the shop, does the checkout
// show the price of the package, does the order carry the code and the time of the consent, and is it the same code that the game tab is
// waiting for? Then the tab is closed and the host gives up.
//   node tools/qa/shopsmoke.mjs --url=https://pettersommerseth1994.github.io/Disputt-test [--plan=evening|year|lifetime] [--shot]
// Needs Google Chrome (CHROME_PATH to override). Exits non-zero on the first thing that does not behave. (The pretend shop of
// `play.mjs --pay-shopify` is the one to use for everything that needs a payment to go through.)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { payScreens } from './payfixtures.mjs';

const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CODE = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;
const PRICES = { evening: 149, year: 399, lifetime: 499 };
const base = process.argv.find((a) => a.startsWith('--url='))?.slice('--url='.length).replace(/\/+$/, '');
const plan = process.argv.find((a) => a.startsWith('--plan='))?.slice('--plan='.length) ?? 'evening';
const SHOT = process.argv.includes('--shot');
assert.ok(base, 'usage: shopsmoke.mjs --url=https://… (the address of the deployed game)');
assert.ok(PRICES[plan], 'plan: evening, year or lifetime');
const host = payScreens().find(([key]) => key === 'pay-gate-shop')[1].view; // (the points after round 2: where the host meets the packages)
const log = (msg) => console.log(msg);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// an ordinary phone, not one that says "HeadlessChrome" (a shop may treat that differently)
const PHONE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--hide-scrollbars'] });
let ok = false;
try {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setUserAgent(PHONE_UA);
  await page.setViewport({ width: 390, height: 664, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto(`${base}/?debug`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__disputt, { timeout: 20000 });
  await page.waitForFunction(() => window.__disputt.store.payments, { timeout: 20000 }).catch(() => assert.fail('the deployed page has no payments switched on (DISPUTT_PAYMENTS_URL and _KEY are not in the build)'));
  const pay = await page.evaluate(() => window.__disputt.store.payments);
  assert.equal(pay.provider, 'shopify', `the build is set up for ${pay.provider}, not Shopify`);
  log(`the page at ${base} has payments on, for Shopify, with the payment server ${pay.apiUrl}`);

  await page.evaluate((view) => window.__disputt.setStore({ view, paywall: true }), host);
  await page.waitForSelector('input[name=plan]', { timeout: 10000 });
  const text = await page.evaluate(() => document.body.innerText);
  for (const [name, price] of [['En kveld', 149], ['For ett år', 399], ['Livstid', 499]]) assert.match(text, new RegExp(`${name}[\\s\\S]*${price} kr`), `${name} is on the packages with ${price} kr`);
  assert.match(text, /Jeg godtar vilkårene, ber om at tilgangen leveres med en gang, og forstår at jeg da mister angreretten/);
  log('the host sees the three packages and the consent');

  await page.evaluate((p) => document.querySelector(`input[name=plan][value=${p}]`).click(), plan);
  await page.click('.consent__box');
  const goButton = () => page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.innerText.includes('Gå til betaling'));
    return b ? { disabled: b.disabled } : null;
  });
  // the shop's address comes from the payment server (/shop) as soon as the packages are on screen: the button waits for it
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.innerText.includes('Gå til betaling') && !b.disabled), { timeout: 20000 })
    .catch(async () => assert.fail(`the button stays off: ${JSON.stringify(await goButton())} ${await page.evaluate(() => document.querySelector('[role=alert]')?.innerText ?? '(no error shown)')}`));
  log('the payment server told the page where the shop is, and the box is ticked: the button is on');

  const pagesBefore = (await ctx.pages()).length;
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.includes('Gå til betaling')).click());
  const target = await ctx.waitForTarget((t) => t.type() === 'page' && new URL(t.url(), 'http://x').pathname.startsWith('/checkouts/'), { timeout: 60000 })
    .catch(async () => assert.fail(`no checkout opened; the tabs are: ${(await ctx.pages()).map((p) => p.url()).join(' | ')}`));
  const shop = await target.page();
  assert.equal((await ctx.pages()).length, pagesBefore + 1, 'the shop opened in a NEW tab, and the game is still where it was');
  await shop.waitForFunction((price) => document.body && document.body.innerText.includes(price), { timeout: 45000 }, `${PRICES[plan]},00 kr`)
    .catch(async () => assert.fail(`the checkout does not show ${PRICES[plan]},00 kr. It says: ${(await shop.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 300)}`));
  const url = new URL(shop.url());
  const code = url.searchParams.get('attributes[kode]');
  assert.match(code ?? '', CODE, 'the code is on the order (as the cart attribute "kode")');
  assert.match(url.searchParams.get('attributes[samtykke]') ?? '', /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/, 'the time of the consent is on the order (as "samtykke")');
  const waiting = await page.evaluate(() => JSON.parse(sessionStorage.getItem('disputt:shop') || 'null'));
  assert.ok(waiting, 'the game tab remembers that it is waiting for a payment');
  assert.equal(waiting.code, code, 'the game tab waits for the very code that is on the order');
  assert.equal(new URL(waiting.url).hostname, url.hostname, 'the checkout is on the shop that the payment server named');
  const title = await shop.title();
  log(`the shop opened in a new tab: ${url.origin}${url.pathname.replace(/\/cn\/[^/]+/, '/cn/…')}, "${title}", ${PRICES[plan]},00 kr, the order carries the code ${code} and the consent`);
  if (SHOT) {
    fs.mkdirSync('tmp/shopsmoke', { recursive: true });
    await shop.screenshot({ path: `tmp/shopsmoke/checkout-${plan}.png` });
    await page.screenshot({ path: 'tmp/shopsmoke/game-waiting.png' });
  }

  assert.match(await page.evaluate(() => document.body.innerText), /Venter på betalingen/);
  await shop.close();
  await sleep(500);
  assert.match(await page.evaluate(() => document.body.innerText), /Venter på betalingen/, 'closing the tab does not make the game forget');
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Avbryt').click());
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.innerText.includes('Gå til betaling')), { timeout: 10000 });
  assert.equal(await page.evaluate(() => sessionStorage.getItem('disputt:shop')), null, 'giving up forgets the payment');
  log('the tab was closed without paying, the host gave up, and nothing was bought');
  ok = true;
} catch (err) {
  console.error(`SHOP SMOKE TEST FAILED: ${err.message}`);
} finally {
  await browser.close();
}
console.log(ok ? 'SHOP SMOKE TEST: OK' : 'SHOP SMOKE TEST: FAILED');
process.exit(ok ? 0 : 1);
