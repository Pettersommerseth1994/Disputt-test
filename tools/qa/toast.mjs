// Where a toast ends up. A toast is a short message ("Koden er kopiert.") and it must sit whole in the middle of the screen, on every
// phone size, and never get in the way of a tap. Once it did not: an animation replaced the transform that centred it, and every
// toast started in the middle of the screen and ran off the right edge. Nothing noticed, because no tool looked at toasts.
//   node tools/qa/toast.mjs [390x664 …]    three toasts (the copied code on the thank-you sheet, a long message over the start screen, and
//                                           the same over a game sheet) on these screen sizes
//   node tools/qa/toast.mjs --self-test     puts the old rules back and checks that this check notices
//   node tools/qa/toast.mjs --url=https://…  looks at a deployed site instead of building one (it must let the page's ?debug hook through)
// Needs Google Chrome (CHROME_PATH to override). Exits non-zero when a toast is not where it belongs.
import puppeteer from 'puppeteer-core';
import { CODE, PAY, passOf } from './payfixtures.mjs';
import { startP2PSite } from './sites.mjs';

const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SIZES = ['390x664', '375x553', '320x568', '430x740', '360x640'];
const sizes = process.argv.slice(2).filter((a) => /^\d+x\d+$/.test(a));
const SELF_TEST = process.argv.includes('--self-test');
const URL_ARG = process.argv.find((a) => a.startsWith('--url='))?.slice('--url='.length);
const LONG = 'Betalingen er gjort, men vi fikk ikke hentet tilgangen din akkurat nå. Åpne siden på nytt om litt, så prøver vi igjen. Koden fra betalingssiden virker også under «Logg inn».';

/** The rules before the fix: centred with a transform that the `rise` animation replaces. */
const OLD_RULES = '.toast { inset: auto; margin: 0; height: auto; left: 50%; top: 0.8rem; transform: translateX(-50%); }';

const CASES = [
  {
    name: 'the copied code, on the thank-you sheet',
    show: async (page) => {
      await page.evaluate((patch) => window.__disputt.setStore(patch), { payments: PAY, sheet: 'thanks', pass: passOf('year'), passCode: CODE });
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.innerText.includes('Kopier koden')));
      await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.includes('Kopier koden')).click()); // (the real way a toast comes up)
    },
  },
  { name: 'a long message, over the start screen', show: (page) => page.evaluate((toast) => window.__disputt.setStore({ toast }), LONG) },
  {
    name: 'a long message, over the packages',
    show: (page) => page.evaluate((patch) => window.__disputt.setStore(patch), { payments: PAY, paywall: true, toast: LONG }),
  },
];

/** What is wrong with the toast's place, or null. (Positions in CSS pixels of the visible screen.) */
function problem(box) {
  const centreX = (box.left + box.right) / 2;
  const centreY = (box.top + box.bottom) / 2;
  if (box.left < 0 || box.right > box.vw || box.top < 0 || box.bottom > box.vh) return `it is not whole on the screen (x ${box.left.toFixed(0)}..${box.right.toFixed(0)} of ${box.vw}, y ${box.top.toFixed(0)}..${box.bottom.toFixed(0)} of ${box.vh})`;
  if (Math.abs(centreX - box.vw / 2) > 1) return `it is ${centreX < box.vw / 2 ? 'left' : 'right'} of the middle (centre ${centreX.toFixed(0)} of ${box.vw})`;
  if (Math.abs(centreY - box.vh / 2) > 2) return `it is ${centreY < box.vh / 2 ? 'above' : 'below'} the middle (centre ${centreY.toFixed(0)} of ${box.vh})`;
  if (box.catchesTaps) return 'it would swallow a tap meant for what is under it';
  return null;
}

async function measure(browser, base, size, test, { broken = false } = {}) {
  const [width, height] = size.split('x').map(Number);
  const page = await (await browser.createBrowserContext()).newPage();
  try {
    await page.setViewport({ width, height, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.goto(`${base}/?debug`);
    await page.waitForFunction(() => window.__disputt);
    if (broken) await page.addStyleTag({ content: OLD_RULES });
    await test.show(page);
    await page.waitForSelector('.toast');
    await new Promise((resolve) => setTimeout(resolve, 700)); // (the toast rises for 0.35 s)
    return await page.$eval('.toast', (el) => {
      const r = el.getBoundingClientRect();
      const at = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, vw: innerWidth, vh: innerHeight, catchesTaps: at === el || el.contains(at) };
    });
  } finally {
    await page.close();
  }
}

const site = URL_ARG ? { base: URL_ARG.replace(/\/+$/, ''), stop: async () => {} } : await startP2PSite({ out: 'tmp/dist-toast' });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--hide-scrollbars'] });
let failures = 0;
try {
  for (const size of sizes.length ? sizes : SIZES) {
    for (const test of CASES) {
      const found = problem(await measure(browser, site.base, size, test));
      if (found) failures++;
      console.log(`${found ? 'FAIL' : 'ok  '} ${size}  ${test.name}${found ? `: ${found}` : ''}`);
    }
  }
  if (SELF_TEST) {
    // the check must see what was wrong: with the old rules back, every toast has to be refused
    let noticed = 0;
    for (const test of CASES) if (problem(await measure(browser, site.base, '390x664', test, { broken: true }))) noticed++;
    console.log(`${noticed === CASES.length ? 'ok  ' : 'FAIL'} self-test: with the old rules back, ${noticed} of ${CASES.length} toasts were refused`);
    if (noticed !== CASES.length) failures++;
  }
  console.log(failures ? `\n${failures} toast(s) in the wrong place.` : '\nEvery toast is whole, in the middle of the screen, and lets taps through.');
} finally {
  await browser.close();
  await site.stop();
}
process.exit(failures ? 1 : 0);
