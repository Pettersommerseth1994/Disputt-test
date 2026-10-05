// Where a toast ends up. A toast is a short message ("Koden er kopiert.") and it must sit whole at the top of the screen, in the middle
// of its width, come down into place from above, and never get in the way of a tap, on every phone size. Once it did not: an animation
// replaced the transform that centred it, and every toast started in the middle of the screen and ran off the right edge. Nothing
// noticed, because no tool looked at toasts.
//   node tools/qa/toast.mjs [390x664 …]     three toasts (the copied code on the thank-you sheet, a long message over the start screen,
//                                            and the same over the packages) on these screen sizes
//   node tools/qa/toast.mjs --self-test      puts four old or plausible mistakes back, one at a time, and checks that this check refuses each
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
const TOP_MAX = 80; // px: the toast rests 0.8rem from the top, or below the notch of a phone that has been added to the home screen

/** Mistakes, as the CSS that brings them back. The check has to refuse every one of them. */
const MISTAKES = {
  'the old centring (a transform that the animation replaces)': '.toast { left: 50%; right: auto; margin: 0; transform: translateX(-50%); animation: rise 0.35s both; }',
  'a toast that rises from below instead of coming down': '.toast { animation: rise 0.35s both; }',
  'a toast in the middle of the screen': '.toast { top: 45%; }',
  'a toast that swallows taps': '.toast { pointer-events: auto; }',
};

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
  if (box.left < 0 || box.right > box.vw || box.top < 0 || box.bottom > box.vh) return `it is not whole on the screen (x ${box.left.toFixed(0)}..${box.right.toFixed(0)} of ${box.vw}, y ${box.top.toFixed(0)}..${box.bottom.toFixed(0)} of ${box.vh})`;
  if (Math.abs(centreX - box.vw / 2) > 1) return `it is ${centreX < box.vw / 2 ? 'left' : 'right'} of the middle (centre ${centreX.toFixed(0)} of ${box.vw})`;
  if (box.top > TOP_MAX) return `it is not at the top of the screen (its top edge is ${box.top.toFixed(0)} px down)`;
  if (box.early > box.top - 15) return `it does not come down from above (its top edge starts at ${box.early.toFixed(0)} px and ends at ${box.top.toFixed(0)} px)`;
  if (box.catchesTaps) return 'it would swallow a tap meant for what is under it';
  return null;
}

async function measure(browser, base, size, test, { css = '' } = {}) {
  const [width, height] = size.split('x').map(Number);
  const page = await (await browser.createBrowserContext()).newPage();
  try {
    await page.setViewport({ width, height, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.goto(`${base}/?debug`);
    await page.waitForFunction(() => window.__disputt);
    if (css) await page.addStyleTag({ content: css });
    await test.show(page);
    await page.waitForSelector('.toast');
    const early = await page.$eval('.toast', (el) => el.getBoundingClientRect().top); // (a moment after it came up: the animation has just begun)
    await new Promise((resolve) => setTimeout(resolve, 800)); // (it comes into place in 0.4 s)
    const rest = await page.$eval('.toast', (el) => {
      const r = el.getBoundingClientRect();
      const at = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, vw: innerWidth, vh: innerHeight, catchesTaps: at === el || el.contains(at) };
    });
    return { ...rest, early };
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
    for (const [mistake, css] of Object.entries(MISTAKES)) {
      let refused = 0;
      for (const test of CASES) if (problem(await measure(browser, site.base, '390x664', test, { css }))) refused++;
      const all = refused === CASES.length;
      if (!all) failures++;
      console.log(`${all ? 'ok  ' : 'FAIL'} self-test: with ${mistake}, ${refused} of ${CASES.length} toasts were refused`);
    }
  }
  console.log(failures ? `\n${failures} problem(s) with the toasts.` : '\nEvery toast is whole, at the top, in the middle of the width, comes down from above, and lets taps through.');
} finally {
  await browser.close();
  await site.stop();
}
process.exit(failures ? 1 : 0);
