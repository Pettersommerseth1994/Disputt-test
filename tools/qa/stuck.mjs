// A guest whose line to the host never comes up (the host is known to the introduction service but never answers,
// like a network that blocks direct phone-to-phone traffic) must be told what to try instead of staring at a spinner.
//   node tools/qa/stuck.mjs [--shots]        (takes about 40 s: the hint appears after two failed 15 s attempts)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import WebSocket from 'ws';
import { startP2PSite } from './sites.mjs';

const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const site = await startP2PSite();
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
let dead;
let heartbeat;
try {
  // a "host" registered under room code ZZZZ that ignores every offer it gets
  dead = new WebSocket(`ws://127.0.0.1:${site.peerPort}/peerjs/peerjs?key=peerjs&id=disputt1-ZZZZ&token=dead`);
  await new Promise((resolve, reject) => {
    dead.once('error', reject);
    dead.once('message', (m) => (JSON.parse(String(m)).type === 'OPEN' ? resolve() : reject(new Error(`unexpected first message ${m}`))));
  });
  heartbeat = setInterval(() => dead.send(JSON.stringify({ type: 'HEARTBEAT' })), 5000);

  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  const text = () => page.evaluate(() => document.body.innerText);
  await page.goto(`${site.base}/?j=ZZZZ`);
  await page.waitForFunction(() => /Blir med i ZZZZ/.test(document.body.innerText), { timeout: 10000 });

  const started = Date.now();
  await sleep(10000);
  assert.doesNotMatch(await text(), /Får ikke kontakt ennå/, 'no hint after the first few seconds');
  await page.waitForFunction(() => /Får ikke kontakt ennå/.test(document.body.innerText), { timeout: 60000 });
  const seconds = (Date.now() - started) / 1000;
  assert.ok(seconds > 25, `the hint waits for two failed attempts (it appeared after ${seconds.toFixed(0)} s)`);
  assert.match(await text(), /Wi‑Fi og mobildata/);
  console.log(`hint shown after ${seconds.toFixed(0)} s`);
  if (process.argv.includes('--shots')) {
    fs.mkdirSync('tmp', { recursive: true });
    await page.screenshot({ path: 'tmp/stuck-hint.png' });
  }

  // "Avbryt" leaves the join screen for good
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.includes('Avbryt')).click());
  await page.waitForFunction(() => /Diskuter,?\s+manipuler\s+og\s+vinn/.test(document.body.innerText), { timeout: 5000 });
  assert.doesNotMatch(await text(), /Får ikke kontakt ennå/);
  console.log('STUCK-GUEST HINT: OK');
} catch (err) {
  console.error('STUCK-GUEST HINT FAILED:', err.message);
  process.exitCode = 1;
} finally {
  clearInterval(heartbeat);
  dead?.terminate();
  await browser.close().catch(() => {});
  await Promise.race([site.stop(), sleep(4000)]);
  process.exit(process.exitCode ?? 0);
}
