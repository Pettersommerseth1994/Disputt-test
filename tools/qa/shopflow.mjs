// The paid part of a game, with Shopify as the shop, played through the real interface against the pretend shop
// (tools/qa/shop-stack.mjs): the host presses "Neste runde" after the free rounds and gets the packages, ticks the box, goes to pay in a
// NEW tab, closes it, opens it again, gives up, tries again, pays, and the game finds the payment by itself while the guests wait,
// connected, the whole time. Later somebody buys from the start screen with a browser that refuses new tabs, and a customer on a new
// phone gets the access back with the code. Used by `play.mjs --pay-shopify`.
//
// `t` is play.mjs's own toolbox: { clickButton, waitText, bodyText, newPhone, shot, sleep, log }.
import assert from 'node:assert/strict';
import { checkHome } from './payflow.mjs';

const CODE = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;
/** The pass this phone keeps (it sits under a key that names the payment server it came from), or null. */
const storedPass = (p) =>
  p.page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('disputt:pass'));
    return key ? JSON.parse(localStorage.getItem(key)) : null;
  });
const choosePlan = (p, id) => p.page.evaluate((plan) => document.querySelector(`input[name=plan][value=${plan}]`).click(), id);
const buttons = (p) => p.page.$$eval('button', (els) => els.map((b) => ({ text: b.innerText.trim(), disabled: b.disabled })));
const button = async (p, label) => (await buttons(p)).find((b) => b.text.includes(label));
/** The tab the host's tap opened: the pretend shop's checkout, in the same browser as the game. */
async function shopTab(host) {
  const target = await host.ctx.waitForTarget((x) => x.type() === 'page' && new URL(x.url(), 'http://x').pathname.startsWith('/checkouts/'), { timeout: 20000 });
  const page = await target.page();
  await page.waitForSelector('#attributes');
  return page;
}
const codeOnCheckout = async (page) => (await page.$eval('#attributes', (el) => el.textContent)).match(/kode: ([0-9A-Z-]{14})/)?.[1];
const tick = (p) => p.page.click('.consent__box'); // (the box itself: the middle of the whole line can be on the link to the terms)

/**
 * The host is at the points of the last free round. Returns the code of the access that was bought.
 * `holdMs`: how long the host stays in the shop (the guests, who are connected to the game tab all along, must not notice).
 */
export async function payAfterFreeRoundsShop(t, { host, others, stack, holdMs = 0 }) {
  const { clickButton, waitText, bodyText, shot, sleep, log } = t;
  const guest = others[0];
  const orders = stack.orders.length;

  // "Neste runde" shows the packages to the host. The others just wait, like between any two rounds.
  await clickButton(host, 'Neste runde');
  await waitText(host, /Fortsett kvelden/);
  const paywall = await bodyText(host);
  assert.match(paywall, /Dere har spilt to runder gratis/);
  assert.match(await host.page.$eval('.plan.is-selected', (el) => el.innerText), /For ett år/, 'the year is the package that is chosen from the start');
  for (const [name, price] of [['En kveld', 149], ['For ett år', 399], ['Livstid', 499]]) assert.match(paywall, new RegExp(`${name}[\\s\\S]*${price} kr`), `${name} is shown with its price`);
  assert.match(paywall, /Gå til betaling/);
  assert.match(paywall, /Jeg godtar vilkårene, ber om at tilgangen leveres med en gang, og forstår at jeg da mister angreretten/);
  assert.doesNotMatch(paywall, /Betal med (Vipps|Apple Pay)/, 'the shop lets the customer choose the way to pay: there is one button');
  assert.doesNotMatch(paywall, /Stripe|Shopify/, 'the page does not name the shop');
  assert.equal((await button(host, 'Gå til betaling')).disabled, true, 'the button waits for the box to be ticked');
  await shot(host, '20-paywall-shop');
  for (const p of others) {
    const text = await bodyText(p);
    assert.match(text, /Venter på at verten starter neste runde/, `${p.name} just waits`);
    assert.doesNotMatch(text, /Fortsett kvelden|Gå til betaling/, `${p.name} is not asked to pay`);
  }
  assert.equal(stack.orders.length, orders, 'nothing is bought until the host chooses');
  assert.deepEqual(stack.calls.filter((c) => c.startsWith('/cart/')), [], 'the shop has not been visited yet');
  log('after the free rounds the host gets the packages and one button that waits for the box, and the others only wait');

  // 1) "En kveld": the box, the button, a new tab; the tab is closed without paying, opened again, and the host gives up
  await choosePlan(host, 'evening');
  await waitText(host, /Gjelder i 12 timer fra du betaler/);
  await tick(host);
  assert.equal((await button(host, 'Gå til betaling')).disabled, false, 'ticked: the button is on');
  const pagesBefore = (await host.ctx.pages()).length;
  await clickButton(host, 'Gå til betaling');
  const first = await shopTab(host);
  assert.equal((await host.ctx.pages()).length, pagesBefore + 1, 'the shop opened in a new tab, and the game is still where it was');
  assert.equal(await first.$eval('#amount', (el) => el.textContent), '149 kr');
  assert.match(await first.$eval('#what', (el) => el.textContent), /evening/);
  const attributes = await first.$eval('#attributes', (el) => el.textContent);
  assert.match(attributes, /samtykke: \d{4}-\d{2}-\d{2}T[\d:.]+Z/, 'the time of the consent is on the order');
  const firstCode = await codeOnCheckout(first);
  assert.match(firstCode, CODE, 'the code is on the order');
  await waitText(host, /Venter på betalingen/);
  assert.equal(await host.page.$$eval('input[name=plan]', (els) => els.every((i) => i.disabled)), true, 'the host cannot change package while waiting');
  assert.ok(await host.page.evaluate(() => sessionStorage.getItem('disputt:shop')), 'the game tab remembers that it is waiting');
  await shot(host, '21-host-waiting');
  // the guests are not disturbed: the game tab is still there and still connected
  for (const p of others) {
    const text = await bodyText(p);
    assert.match(text, /Venter på at verten starter neste runde/, `${p.name} still just waits`);
    assert.equal(await p.page.$('.banner'), null, `${p.name} has not lost the host`);
  }
  await first.close();
  await sleep(500);
  assert.match(await bodyText(host), /Venter på betalingen/, 'closing the tab does not make the game forget');
  const pagesWithoutShop = (await host.ctx.pages()).length;
  await clickButton(host, 'Åpne betalingen igjen');
  const again = await shopTab(host);
  assert.equal(await codeOnCheckout(again), firstCode, 'the same cart again, with the same code');
  // a phone where the game tab was put to sleep while the host paid: "Fortsett å handle" leads to the shop's front page
  // (shopify/forside.liquid), which closes the tab that the game opened
  await again.goto(`${stack.shop}/`);
  await again.waitForSelector('#disputt-close', { visible: true });
  assert.equal(await again.$eval('#disputt-no-game', (el) => el.hidden), true, 'a tab that the game opened gets no link to the game (it would open the game a second time, with a copy of the room)');
  await again.evaluate(() => setTimeout(() => document.getElementById('disputt-close').click(), 0)); // (the click closes the tab it is made in: not waited for)
  await sleep(800);
  assert.equal(again.isClosed(), true, 'the button on the shop\'s front page closes the tab that the game opened');
  assert.equal((await host.ctx.pages()).length, pagesWithoutShop);
  await clickButton(host, 'Avbryt');
  await waitText(host, /Gå til betaling/);
  assert.equal((await button(host, 'Gå til betaling')).disabled, true, 'after giving up the box has to be ticked again');
  assert.equal(await host.page.evaluate(() => sessionStorage.getItem('disputt:shop')), null);
  assert.equal(stack.orders.length, orders, 'and nothing was bought');
  log('a closed tab is no payment: the host can open the shop again, or give up, and the guests never notice');

  // 2) "Livstid", paid in the new tab: the game tab finds the payment itself
  await choosePlan(host, 'lifetime');
  await tick(host);
  await clickButton(host, 'Gå til betaling');
  const shop = await shopTab(host);
  assert.equal(await shop.$eval('#amount', (el) => el.textContent), '499 kr');
  const code = await codeOnCheckout(shop);
  assert.notEqual(code, firstCode, 'a new try is a new code');
  if (holdMs) {
    log(`the host stays in the shop for ${Math.round(holdMs / 1000)} s`);
    await sleep(holdMs);
    for (const p of others) {
      const text = await bodyText(p).catch((err) => `[the page is gone: ${err.message}]`);
      assert.match(text, /Venter på at verten starter neste runde/, `${p.name} is still waiting for the host after ${Math.round(holdMs / 1000)} s, but the screen says: ${text.slice(0, 200)}`);
    }
  }
  // Shopify takes the money and is slow to tell the payment server: the game keeps waiting, and has nothing to show for it yet
  stack.hold();
  await shop.click('#pay');
  await shop.waitForSelector('#thanks');
  const placed = stack.orders.at(-1);
  assert.equal(placed.note_attributes.find((a) => a.name === 'kode').value, code, 'the order carries the code');
  await host.page.bringToFront();
  await sleep(4500);
  assert.match(await bodyText(host), /Venter på betalingen/, 'paid, but Shopify has not said so: the game waits');
  assert.equal(await storedPass(host), null);
  await stack.release();
  await waitText(host, /Takk!/, 30000);
  const thanks = await host.page.$eval('.sheet', (el) => el.innerText.replace(/\s+/g, ' '));
  assert.match(thanks, /Livstid/);
  assert.match(thanks, /Gjelder for alltid/);
  assert.match(thanks, /Den står også i e-posten du får fra butikken/);
  const shown = (await host.page.$eval('.passcode', (el) => el.textContent)).trim();
  assert.equal(shown, code, 'the code on the thank-you sheet is the one on the order');
  const stored = await storedPass(host);
  assert.equal(stored.code, code);
  assert.equal(stored.token.split('.').length, 3, 'a signed pass is kept on the phone');
  assert.equal(await host.page.evaluate(() => sessionStorage.getItem('disputt:shop')), null, 'and the game tab has forgotten that it waited');
  assert.equal(new URL(host.page.url()).search, '');
  const sheetButtons = await host.page.$$eval('.sheet button', (els) => els.map((b) => b.innerText.trim()));
  assert.ok(sheetButtons.includes('Start runde 3'), `the thank-you sheet offers the round the host asked for (${sheetButtons.join(' | ')})`);
  await shot(host, '22-thanks-shop');
  log(`paid in the shop's tab: "Takk!" with the code ${shown}`);

  // the game closes the tab it opened, now that the payment is in, and the host is where the game is
  for (let i = 0; i < 20 && !shop.isClosed(); i++) await sleep(250);
  assert.equal(shop.isClosed(), true, 'the game closes the shop\'s tab when the payment is in');
  log('the game closes the shop\'s tab once the payment is in, and the host is where the game is');

  // somebody who comes to the shop's front page without having been sent by the game gets a link to it, and no button
  const visitor = await host.ctx.newPage();
  await visitor.goto(`${stack.shop}/`);
  await visitor.waitForSelector('#disputt-open', { visible: true });
  assert.equal(await visitor.$eval('#disputt-from-game', (el) => el.hidden), true, 'no button that closes a tab that nobody opened');
  assert.equal(await visitor.$eval('#disputt-open', (a) => a.href), host.page.url().split('?')[0], 'the link goes to the game');
  await visitor.close();

  await host.page.bringToFront();
  await clickButton(host, 'Start runde 3');
  return { code };
}

/**
 * Buying from the start screen, with no game, in a browser that does not open new tabs: the page sends this tab to the shop, the
 * customer pays there and comes back with the back button. Nothing in the address says what happened, so the page has to find the
 * payment itself from what it remembered about leaving.
 */
export async function buyAndComeBackShop(t, { base, stack }) {
  const { clickButton, waitText, bodyText, newPhone, shot, log } = t;
  const phone = await newPhone('Kjøper');
  await phone.page.evaluateOnNewDocument(() => {
    window.open = () => null; // (a pop-up blocker)
  });
  await phone.page.goto(`${base}/`);
  await checkHome(t, phone);
  await clickButton(phone, 'Logg inn');
  await waitText(phone, /Skriv inn koden/);
  await clickButton(phone, 'Har du ikke kjøpt ennå? Se pakkene');
  await waitText(phone, /Pakker/);
  const browse = await bodyText(phone);
  assert.match(browse, /Bare verten betaler/);
  assert.doesNotMatch(browse, /Fortsett kvelden/, 'opened from the start screen it is a list of packages, not a gate');
  await shot(phone, '25-paywall-browse-shop');
  await choosePlan(phone, 'year');
  await tick(phone);
  const orders = stack.orders.length;
  await clickButton(phone, 'Gå til betaling');
  await phone.page.waitForFunction(() => location.pathname.startsWith('/checkouts/'), { timeout: 20000 });
  assert.equal(await phone.page.$eval('#amount', (el) => el.textContent), '399 kr');
  await phone.page.click('#pay');
  await phone.page.waitForSelector('#thanks');
  assert.equal(stack.orders.length, orders + 1);
  // "Fortsett å handle" leads to the shop's front page, which here has no tab to close and so offers the way back to the game
  await phone.page.click('#continue');
  await phone.page.waitForSelector('#disputt-open', { visible: true });
  assert.equal(await phone.page.$eval('#disputt-from-game', (el) => el.hidden), true, 'this is the game\'s own tab: there is no tab to close');
  await shot(phone, '26-shop-front-page');
  await phone.page.click('#disputt-open');
  await waitText(phone, /Takk!/, 30000);
  const sheet = await phone.page.$eval('.sheet', (el) => el.innerText.replace(/\s+/g, ' '));
  assert.match(sheet, /For ett år/);
  const code = (await phone.page.$eval('.passcode', (el) => el.textContent)).trim();
  assert.match(code, CODE);
  assert.equal(stack.orders.at(-1).note_attributes.find((a) => a.name === 'kode').value, code);
  assert.equal((await storedPass(phone))?.code, code);
  assert.equal(await phone.page.evaluate(() => sessionStorage.getItem('disputt:shop')), null, 'and has forgotten it now');
  await clickButton(phone, 'Fortsett spillet');
  await waitText(phone, /Du har tilgang/);
  log('bought from the start screen with no new tab allowed, paid in the shop, came back by the link on the shop\'s front page: the page found the payment itself');

  // and the same with the back button, on another phone: the thank-you page, the checkout, and then the game
  const other = await newPhone('Kjøper2');
  await other.page.evaluateOnNewDocument(() => {
    window.open = () => null;
  });
  await other.page.goto(`${base}/`);
  await clickButton(other, 'Logg inn');
  await clickButton(other, 'Har du ikke kjøpt ennå? Se pakkene');
  await waitText(other, /Pakker/);
  await choosePlan(other, 'evening');
  await tick(other);
  await clickButton(other, 'Gå til betaling');
  await other.page.waitForFunction(() => location.pathname.startsWith('/checkouts/'), { timeout: 20000 });
  await other.page.click('#pay');
  await other.page.waitForSelector('#thanks');
  await other.page.goBack();
  await other.page.goBack();
  await waitText(other, /Takk!/, 30000);
  assert.match(await other.page.$eval('.sheet', (el) => el.innerText.replace(/\s+/g, ' ')), /En kveld/);
  log('and the back button works as well');
}
