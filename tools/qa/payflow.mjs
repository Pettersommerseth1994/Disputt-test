// The paid part of a game, played through the real interface against the pretend payment chain (tools/qa/payments-stack.mjs) or the
// payment demo (payments/demo/), as the `server` of tools/qa/payserver.mjs says:
// the host presses "Neste runde" after the free rounds and gets the packages, changes their mind on Stripe's page, pays with
// Vipps, comes back, and starts the round. Meanwhile the guests are told that the host is away and wait. Later a customer on a
// new phone gets the access back with the code from the receipt. Used by `play.mjs --pay`.
//
// `t` is play.mjs's own toolbox: { clickButton, waitText, bodyText, newPhone, shot, sleep, log }.
import assert from 'node:assert/strict';

const CODE = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;
/** The pass this phone keeps (it sits under a key that names the payment server it came from), or null. */
const storedPass = (p) =>
  p.page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('disputt:pass'));
    return key ? JSON.parse(localStorage.getItem(key)) : null;
  });
const choosePlan = (p, id) => p.page.evaluate((plan) => document.querySelector(`input[name=plan][value=${plan}]`).click(), id);

/** What the start screen says once payments are on: "Allerede kunde? Logg inn" where "Slik spiller du" used to be. */
export async function checkHome(t, phone) {
  await t.waitText(phone, /Allerede kunde\?/);
  const text = await t.bodyText(phone);
  assert.match(text, /Logg inn/);
  assert.doesNotMatch(text, /Slik spiller du/, 'the rules link has made room for "Allerede kunde?"');
  const buttons = await phone.page.$$eval('button', (els) => els.map((b) => b.innerText.trim()));
  assert.ok(buttons.includes('Logg inn'), '"Logg inn" is a button (a link-button)');
}

/**
 * The host is at the points of the last free round. Returns the code of the access that was bought.
 * `holdMs`: how long the host stays on Stripe's page (the guests have to be patient that long).
 */
export async function payAfterFreeRounds(t, { host, others, server, holdMs = 0 }) {
  const { clickButton, waitText, bodyText, shot, sleep, log } = t;
  const guest = others[0];
  const before = await server.sessionCount(host);

  // "Neste runde" shows the packages to the host. The others just wait, like between any two rounds.
  await clickButton(host, 'Neste runde');
  await waitText(host, /Fortsett kvelden/);
  const paywall = await bodyText(host);
  assert.match(paywall, /Dere har spilt to runder gratis/);
  for (const [name, price] of [['En kveld', 149], ['For ett år', 399], ['Livstid', 499]]) assert.match(paywall, new RegExp(`${name}[\\s\\S]*${price} kr`), `${name} is shown with its price`);
  assert.match(paywall, /Betal med Vipps/);
  assert.match(paywall, /Betal med Apple Pay/);
  assert.match(paywall, /Allerede kunde\?/);
  await shot(host, '20-paywall');
  for (const p of others) {
    const text = await bodyText(p);
    assert.match(text, /Venter på at verten starter neste runde/, `${p.name} just waits`);
    assert.doesNotMatch(text, /Fortsett kvelden|Betal med/, `${p.name} is not asked to pay`);
  }
  assert.equal(await server.sessionCount(host), before, 'nothing is started at Stripe until the host chooses');
  log('after the free rounds the host gets the packages, and the others only wait');

  // 1) "En kveld" with Apple Pay, and a change of mind on Stripe's page
  await choosePlan(host, 'evening');
  await waitText(host, /Gjelder i 12 timer fra du betaler/);
  await clickButton(host, 'Betal med Apple Pay');
  await server.onCheckoutPage(host);
  const first = await server.lastSession(host);
  assert.equal(first.metadata.plan, 'evening');
  assert.equal(first.amount_total, 14900);
  assert.deepEqual(first.allowed_payment_method_types, ['card'], 'Apple Pay is part of "card" on Stripe\'s page');
  await waitText(host, /149 kr/);
  // the guests are told where the host is
  await waitText(guest, /Verten betaler/, 25000);
  await shot(guest, '21-guest-host-pays');
  await host.page.click('#cancel');
  await waitText(host, /Betalingen ble avbrutt/, 30000);
  await waitText(host, /Poengene/);
  assert.equal(new URL(host.page.url()).search, '', 'the address bar is clean after coming back');
  for (const p of others) {
    await p.page.waitForFunction(() => !document.querySelector('.banner') && /Venter på at verten starter neste runde/.test(document.body.innerText), { timeout: 45000 });
  }
  log('a cancelled payment leaves the game as it was, and the guests are back');

  // 2) "Livstid" with Vipps, paid
  await clickButton(host, 'Neste runde');
  await waitText(host, /Fortsett kvelden/);
  assert.match(await host.page.$eval('.plan.is-selected', (el) => el.innerText), /For ett år/, 'the year is the package that is chosen from the start');
  await choosePlan(host, 'lifetime');
  await clickButton(host, 'Betal med Vipps');
  await server.onCheckoutPage(host);
  const second = await server.lastSession(host);
  assert.equal(second.metadata.plan, 'lifetime');
  assert.equal(second.amount_total, 49900);
  assert.deepEqual(second.allowed_payment_method_types, ['vipps']);
  // the code is on Stripe's page too, so that a customer who pays always has it
  const shown = server.codeOnThePage(await host.page.$eval('#note', (el) => el.textContent));
  assert.equal(shown, second.metadata.code, 'Stripe\'s page says the code');
  await waitText(guest, /Verten betaler/, 25000);
  if (holdMs) {
    // a payment with Vipps means another app: the guests must not give up on a host who is away for longer than a minute
    log(`the host stays on Stripe's page for ${Math.round(holdMs / 1000)} s`);
    await sleep(holdMs);
    for (const p of others) {
      // (a phone that gave up has been sent to the start screen: its page is gone, or says something else)
      const text = await bodyText(p).catch((err) => `[the page is gone: ${err.message}]`);
      assert.match(text, /Verten betaler/, `${p.name} is still waiting for the host after ${Math.round(holdMs / 1000)} s, but the screen says: ${text.slice(0, 200)}`);
      assert.doesNotMatch(text, /trolig avsluttet|Diskuter\s+og\s+vinn/, `${p.name} has not given up`);
    }
  }
  await server.confirm(host);
  await waitText(host, /Takk!/, 30000);
  const thanks = await host.page.$eval('.sheet', (el) => el.innerText.replace(/\s+/g, ' '));
  assert.match(thanks, /Livstid/);
  assert.match(thanks, /Gjelder for alltid/);
  const code = (await host.page.$eval('.passcode', (el) => el.textContent)).trim();
  assert.match(code, CODE, 'the code on the thank-you sheet');
  const stored = await storedPass(host);
  assert.equal(stored.code, code);
  assert.equal(stored.token.split('.').length, 3, 'a signed pass is kept on the phone');
  const paid = await server.lastPayment(host);
  assert.equal(paid.metadata.code, code, 'the code on the sheet is the one in the receipt');
  assert.equal(paid.amount, 49900);
  assert.equal(new URL(host.page.url()).search, '');
  // (the sheet can come up a moment before the host's room is back: it is asked for as soon as the answer from the payment side is in, and
  // the room has to find its way back to the signalling service first. Then the button turns into the round the host asked for.)
  const thanksAt = Date.now();
  await host.page.waitForFunction(() => [...document.querySelectorAll('.sheet button')].some((b) => b.innerText.trim() === 'Start runde 3'), { timeout: 30000 }).catch(async () => {
    const buttons = await host.page.$$eval('.sheet button', (els) => els.map((b) => b.innerText.trim())).catch(() => []);
    throw new Error(`the thank-you sheet does not offer the round the host asked for, even after 30 s (${buttons.join(' | ')})`);
  });
  const roomBackAfter = Date.now() - thanksAt;
  await shot(host, '22-thanks');
  log(`paid with Vipps: "Takk!" with the code ${code} (the round the host asked for was offered ${roomBackAfter} ms later)`);

  // the guests find their way back; then the round the host asked for starts with one tap
  await host.page.waitForFunction(() => !/Venter på at .* kommer tilbake/.test(document.querySelector('.sheet')?.innerText ?? ''), { timeout: 45000 });
  await clickButton(host, 'Start runde 3');
  return { code };
}

/**
 * Buying from the start screen, with no game, and coming back some other way than Stripe's redirect: the customer pays in the Vipps
 * app (here: the payment goes through behind the page's back) and goes back to the game's tab by the back button. Nothing in the
 * address says "?pay=success", so the page has to find the payment itself from what it remembered about leaving.
 */
export async function buyAndComeBackByTheBackButton(t, { base, server }) {
  const { clickButton, waitText, bodyText, newPhone, shot, log } = t;
  const phone = await newPhone('Kjøper');
  await phone.page.goto(`${base}/`);
  await checkHome(t, phone);
  await clickButton(phone, 'Logg inn');
  await waitText(phone, /Skriv inn koden/);
  await clickButton(phone, 'Har du ikke kjøpt ennå? Se pakkene');
  await waitText(phone, /Pakker/);
  const browse = await bodyText(phone);
  assert.match(browse, /Bare verten betaler/);
  assert.doesNotMatch(browse, /Fortsett kvelden/, 'opened from the start screen it is a list of packages, not a gate');
  await shot(phone, '25-paywall-browse');
  await choosePlan(phone, 'year');
  await clickButton(phone, 'Betal med Apple Pay');
  await server.onCheckoutPage(phone);
  const session = await server.lastSession(phone);
  assert.equal(session.metadata.plan, 'year');
  assert.equal(session.amount_total, 39900);
  // (the page remembered where it sent the customer, in this tab's own storage, which Stripe's page cannot see)
  // the customer pays in the app, not on this page: the redirect never happens
  await server.payBehindTheBack(phone, session);
  await phone.page.goBack();
  await waitText(phone, /Takk!/, 30000);
  const sheet = await phone.page.$eval('.sheet', (el) => el.innerText.replace(/\s+/g, ' '));
  assert.match(sheet, /For ett år/);
  const code = (await phone.page.$eval('.passcode', (el) => el.textContent)).trim();
  assert.match(code, CODE);
  assert.equal((await storedPass(phone))?.code, code);
  assert.equal(await phone.page.evaluate(() => sessionStorage.getItem('disputt:paying')), null, 'and has forgotten it now');
  assert.equal(new URL(phone.page.url()).search, '');
  await clickButton(phone, 'Fortsett spillet');
  await waitText(phone, /Du har tilgang/);
  log('bought from the start screen, paid "in the app", came back by the back button: the page found the payment itself');
}

/** A customer on a new phone: "Allerede kunde? Logg inn", a wrong code, and then the right one, typed the way people type it. */
export async function restoreOnNewPhone(t, { base, code }) {
  const { clickButton, waitText, bodyText, newPhone, shot } = t;
  const phone = await newPhone('Kunde');
  await phone.page.goto(`${base}/`);
  await checkHome(t, phone);
  await clickButton(phone, 'Logg inn');
  await waitText(phone, /Skriv inn koden du fikk da du betalte/);
  await shot(phone, '23-login');
  const field = '#pass-code';
  assert.equal(await phone.page.$eval('button[type=submit]', (b) => b.disabled), true, 'the button waits for a code that looks right');

  await phone.page.type(field, 'aaaaaaaaaaaa');
  assert.equal(await phone.page.$eval(field, (i) => i.value), 'AAAA-AAAA-AAAA', 'the code is written in capitals with dashes as it is typed');
  await clickButton(phone, 'Hent tilgangen');
  await waitText(phone, /Fant ingen betaling med den koden/);
  assert.equal(await storedPass(phone), null, 'a wrong code gives nothing');

  await phone.page.$eval(field, (i) => i.select());
  await phone.page.keyboard.press('Backspace');
  // lower case, no dashes, and zeros and ones typed as the letters they look like
  await phone.page.type(field, code.replaceAll('-', '').toLowerCase().replaceAll('0', 'o').replaceAll('1', 'l'));
  assert.equal(await phone.page.$eval(field, (i) => i.value.replace(/[OIL]/g, (c) => ({ O: '0', I: '1', L: '1' })[c])), code);
  await clickButton(phone, 'Hent tilgangen');
  await waitText(phone, /Velkommen tilbake/);
  await phone.page.waitForFunction(() => !document.querySelector('.sheet'));
  const stored = await storedPass(phone);
  assert.equal(stored.code, code);
  const text = await bodyText(phone);
  assert.match(text, /Du har tilgang/);
  assert.doesNotMatch(text, /Allerede kunde/);

  // "Min tilgang" on the start screen: what the phone has, and taking it off takes two taps
  await clickButton(phone, 'Min tilgang');
  await waitText(phone, /Du har tilgang: Livstid/);
  assert.ok((await bodyText(phone)).includes(code));
  await shot(phone, '24-access');
  await clickButton(phone, 'Fjern tilgangen fra denne telefonen');
  await waitText(phone, /Trykk igjen for å fjerne/);
  assert.notEqual(await storedPass(phone), null, 'one tap does not remove it');
  await clickButton(phone, 'Trykk igjen for å fjerne');
  await waitText(phone, /Allerede kunde\?/);
  assert.equal(await storedPass(phone), null);
  t.log('a new phone gets the access back with the code from the receipt (typed loosely), and can take it off again');
}
