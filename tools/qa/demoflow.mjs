// The payment demo (payments/demo/) through the real interface, on one phone: the packages from the start screen, a change of mind on
// the pretend payment page, a payment with Vipps and one with Apple Pay, "Takk!" with the code, the pass that survives a reload,
// taking the pass off, and "Logg inn" with the code. No payment server, no Stripe: the page has its own.
//   node tools/qa/demoflow.mjs [--shots]            builds a demo site and tries it
//   node tools/qa/demoflow.mjs --url=https://…      tries a deployed demo site (a test copy with DISPUTT_PAYMENTS_DEMO set)
// Needs Google Chrome (CHROME_PATH to override). Exits non-zero on the first thing that does not behave.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { startP2PSite } from './sites.mjs';

const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOTS = process.argv.includes('--shots');
const URL_ARG = process.argv.find((a) => a.startsWith('--url='))?.slice('--url='.length);
const CODE = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (...a) => console.log(...a);

const site = URL_ARG ? { base: URL_ARG.replace(/\/+$/, ''), stop: async () => {} } : await startP2PSite({ out: 'tmp/dist-demo', paymentsDemo: true });
log(`${URL_ARG ? 'deployed demo site' : 'demo build'} at ${site.base}`);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--hide-scrollbars'] });
if (SHOTS) fs.mkdirSync('tmp/demo', { recursive: true });

const problems = [];
const outside = [];
const page = await (await browser.createBrowserContext()).newPage();
await page.setViewport({ width: 390, height: 664, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' && /Content Security Policy|Refused to (load|connect|execute)/i.test(m.text())) problems.push(`blocked by the CSP: ${m.text()}`);
});
page.on('request', (r) => /\.invalid\b/.test(r.url()) && outside.push(r.url())); // (the names the demo pretends with must never reach the network)

const NAVIGATING = /detached Frame|Execution context was destroyed|Cannot find context/i;
const steady = async (ask) => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await ask();
    } catch (err) {
      if (attempt >= 5 || !NAVIGATING.test(String(err?.message))) throw err;
      await sleep(250);
    }
  }
};
const text = () => steady(() => page.evaluate(() => document.body.innerText));
const waitText = (re, timeout = 15000) =>
  steady(() => page.waitForFunction((src, flags) => new RegExp(src, flags).test(document.body.innerText), { timeout }, re.source, re.flags)).catch(async () => {
    throw new Error(`timed out waiting for ${re}. The screen says:\n${(await text()).slice(0, 600)}`);
  });
const click = async (label) => {
  await steady(() => page.waitForFunction((l) => [...document.querySelectorAll('button')].some((b) => b.innerText.trim().includes(l) && !b.disabled), { timeout: 10000 }, label)).catch(async () => {
    throw new Error(`no enabled button "${label}". The screen says:\n${(await text()).slice(0, 600)}`);
  });
  await steady(() => page.evaluate((l) => [...document.querySelectorAll('button')].find((b) => b.innerText.trim().includes(l) && !b.disabled).click(), label));
};
const shot = (label) => SHOTS && page.screenshot({ path: `tmp/demo/${label}.png` });
const choosePlan = (id) => steady(() => page.evaluate((plan) => document.querySelector(`input[name=plan][value=${plan}]`).click(), id));
const onCheckout = () => steady(() => page.waitForFunction(() => location.pathname.endsWith('/demo/checkout.html') && document.querySelector('#pay'), { timeout: 15000 }));
const storedPass = () =>
  steady(() =>
    page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) => k.startsWith('disputt:pass'));
      return key ? JSON.parse(localStorage.getItem(key)) : null;
    }),
  );

try {
  // ---- the start screen says it is a demo, and has the way in
  await page.goto(`${site.base}/`);
  await waitText(/Allerede kunde\?/);
  assert.match(await page.title(), /\(demo\)$/, 'the tab says it is a demo');
  assert.match(await page.$eval('.demo-badge', (el) => el.textContent), /DEMO/);
  log('the start screen carries the demo label, and "Allerede kunde? Logg inn"');

  // ---- the proposals for the bar at the bottom: ?dock=b is kept in the tab, ?dock=0 turns it off
  const barColour = () => page.$eval('.dock', (el) => getComputedStyle(el).backgroundColor);
  const barNow = await barColour();
  await page.goto(`${site.base}/?dock=b`);
  await waitText(/Allerede kunde\?/);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.dock), 'b');
  assert.notEqual(await barColour(), barNow, 'proposal B has a darker bar');
  await page.goto(`${site.base}/`);
  await waitText(/Allerede kunde\?/);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.dock), 'b', 'the proposal is kept in the tab');
  await page.goto(`${site.base}/?dock=0`);
  await waitText(/Allerede kunde\?/);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.dock), undefined);
  assert.equal(await barColour(), barNow, 'and ?dock=0 puts the bar in use back');
  log('?dock=b shows proposal B for the bar at the bottom, the tab keeps it, and ?dock=0 turns it off');

  // ---- a code that does not exist
  await click('Logg inn');
  await waitText(/Skriv inn koden du fikk da du betalte/);
  await page.type('#pass-code', 'aaaaaaaaaaaa');
  await click('Hent tilgangen');
  await waitText(/Fant ingen betaling med den koden/);
  log('a code nobody was given is refused, by the payment server running in the page');

  // ---- the packages, and a change of mind on the pretend payment page
  await click('Har du ikke kjøpt ennå? Se pakkene');
  await waitText(/Pakker/);
  await shot('1-packages');
  await choosePlan('year');
  await click('Betal med Vipps');
  await onCheckout();
  assert.equal(await page.$eval('#amount', (el) => el.textContent), '399 kr');
  assert.match(await page.$eval('#what', (el) => el.textContent), /For ett år/);
  assert.match(await page.$eval('#methods', (el) => el.textContent), /Vipps/);
  assert.match(await page.$eval('#note', (el) => el.innerText), /Koden din er [0-9A-Z-]{14}/, 'the code is on the payment page too');
  assert.equal(await page.$eval('#pay', (b) => b.disabled), true, 'the box about the right of withdrawal has to be ticked first');
  assert.match(await page.$eval('.terms', (el) => el.innerText), /Jeg godtar vilkårene/);
  await shot('2-pretend-stripe');
  await page.click('#cancel');
  await waitText(/Betalingen ble avbrutt/);
  log('Vipps: the pretend payment page asks for the box to be ticked, and "Avbryt" brings the host back to the game');

  // ---- a payment with Apple Pay
  await click('Logg inn');
  await click('Har du ikke kjøpt ennå? Se pakkene');
  await waitText(/Pakker/);
  await choosePlan('lifetime');
  await click('Betal med Apple Pay');
  await onCheckout();
  assert.equal(await page.$eval('#amount', (el) => el.textContent), '499 kr');
  assert.match(await page.$eval('#methods', (el) => el.textContent), /kort og Apple Pay/);
  await page.click('#terms');
  assert.equal(await page.$eval('#pay', (b) => b.disabled), false);
  await page.click('#pay');
  await waitText(/Takk!/, 30000);
  const sheet = await page.$eval('.sheet', (el) => el.innerText.replace(/\s+/g, ' '));
  assert.match(sheet, /Livstid/);
  assert.match(sheet, /Gjelder for alltid/);
  const code = (await page.$eval('.passcode', (el) => el.textContent)).trim();
  assert.match(code, CODE);
  assert.equal((await storedPass()).code, code);
  assert.equal(new URL(page.url()).search, '', 'the address is clean again');
  await shot('3-thanks');
  log(`Apple Pay: "Takk!" with the code ${code}`);

  // ---- the pass survives a reload; taking it off; getting it back with the code
  await page.reload();
  await waitText(/Du har tilgang/);
  await click('Min tilgang');
  await waitText(/Du har tilgang: Livstid/);
  assert.ok((await text()).includes(code));
  await click('Fjern tilgangen fra denne telefonen');
  await waitText(/Trykk igjen for å fjerne/);
  await click('Trykk igjen for å fjerne');
  await waitText(/Allerede kunde\?/);
  assert.equal(await storedPass(), null);
  await click('Logg inn');
  await waitText(/Skriv inn koden du fikk da du betalte/);
  await page.type('#pass-code', code.replaceAll('-', '').toLowerCase().replaceAll('0', 'o').replaceAll('1', 'l')); // (typed the way people type)
  await click('Hent tilgangen');
  await waitText(/Velkommen tilbake/);
  assert.equal((await storedPass()).code, code);
  await shot('4-back');
  log('the pass survives a reload, can be taken off, and comes back with the code (typed loosely)');

  assert.deepEqual(outside, [], 'the names the demo pretends with never reach the network');
  assert.deepEqual(problems, []);
  log('\nDEMO END-TO-END: OK');
} catch (err) {
  console.error(`\nDEMO END-TO-END FAILED: ${err.message}`);
  if (SHOTS) await page.screenshot({ path: 'tmp/demo/failure.png' }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
  await site.stop();
  process.exit(process.exitCode ?? 0); // (the signalling server keeps the process alive otherwise)
}
