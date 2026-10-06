// Paying through Shopify, seen from the page: the host taps "Gå til betaling", the shop opens in a NEW tab with the package in the
// cart (a cart link that carries a code this page has made up), and this page, which stays open behind it, asks the payment server
// (payments/worker-shopify.js) now and then whether that code has been paid. When it has, the pass comes back and "Takk!" shows.
// The shop's address and the variants come from the payment server, so they are set in one place only (its settings).
// (A file of its own: pages are cached for ten minutes ...)

import { setStore, store, toast } from '../store.js';
import { announceAway } from './away.js';
import { CODE_ALPHABET } from './pass.js';
import { PayError, restoreWithCode } from './payments.js';

const WAITING_KEY = 'disputt:shop'; // sessionStorage: the payment this tab sent the host to make, until the pass has been fetched
const WAITING_MAX_MS = 2 * 60 * 60_000; // a payment that was started and never finished is forgotten after two hours
const PLAN_IDS = ['evening', 'year', 'lifetime'];
/** How often to ask: every few seconds for the first minutes (the host is paying right now), then now and then. */
export const POLL = { fastMs: 3000, fastForMs: 3 * 60_000, slowMs: 15_000 };

// ---- the shop ----------------------------------------------------------------------------------------------------------

const isLocal = (h) => h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
let shopInfo = null;
let shopAsk = null;

/** What the payment server says about the shop: { shop: 'https://…', variants: { evening, year, lifetime } }. Asked once. */
export function loadShop() {
  if (shopInfo) return Promise.resolve(shopInfo);
  shopAsk ??= (async () => {
    let res;
    try {
      res = await fetch(`${store.payments.apiUrl}/shop`, { credentials: 'omit' });
    } catch {
      throw new PayError('network', 'Fikk ikke kontakt med betalingen. Sjekk nettet og prøv igjen.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new PayError(data.error ?? 'server', data.message ?? 'Noe gikk galt. Prøv igjen om litt.');
    let target = null;
    try {
      target = new URL(data.shop);
    } catch {
      /* refused below */
    }
    const variants = Object.fromEntries(PLAN_IDS.map((plan) => [plan, String(data.variants?.[plan] ?? '')]));
    // (a page that does not get a proper address is not sent anywhere)
    if (!target || (target.protocol !== 'https:' && !(target.protocol === 'http:' && isLocal(target.hostname))) || PLAN_IDS.some((plan) => !/^\d{5,20}$/.test(variants[plan]))) {
      throw new PayError('server', 'Fikk en betalingsside vi ikke stoler på.');
    }
    return (shopInfo = { shop: target.origin, variants });
  })().finally(() => (shopAsk = null));
  return shopAsk;
}

/** The shop, if it has been asked for. */
export const knownShop = () => shopInfo;

/** For the QA tools, which draw the packages without a payment server to ask (main.js hands it out with the other debug hooks). */
export function setKnownShop(info) {
  shopInfo = info;
}

/** A new code: 12 characters, 60 bits, written XXXX-XXXX-XXXX (the kind that pay/pass.js writes and reads). */
export function newPayCode() {
  const raw = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => CODE_ALPHABET[b & 31]).join('');
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
}

/**
 * The cart link: the package in the cart and straight on to the checkout. The code goes along as a cart attribute ("kode"), and
 * so does the time of the host's consent to getting the access at once ("samtykke"): both end up on the order, where the owner sees them.
 */
export function cartLink(shop, variant, code, at = new Date()) {
  // (the brackets are written as they are in Shopify's documentation of cart links, not as %5B and %5D)
  return `${new URL(`/cart/${variant}:1`, shop).href}?attributes[kode]=${encodeURIComponent(code)}&attributes[samtykke]=${encodeURIComponent(at.toISOString())}`;
}

// ---- the payment this tab is waiting for ------------------------------------------------------------------------------------

function readWaiting() {
  try {
    const data = JSON.parse(sessionStorage.getItem(WAITING_KEY) ?? 'null');
    const ok = data && /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(data.code) && PLAN_IDS.includes(data.plan) && typeof data.url === 'string' && Date.now() - data.at < WAITING_MAX_MS;
    return ok ? data : null;
  } catch {
    return null;
  }
}

function writeWaiting(data) {
  try {
    if (data) sessionStorage.setItem(WAITING_KEY, JSON.stringify(data));
    else sessionStorage.removeItem(WAITING_KEY);
  } catch {
    /* a browser that keeps nothing: the page asks while it is open, and the host can type the code from the e-mail */
  }
}

/** Can this tab keep something for a while? (The room of a host whose tab goes to the shop is kept there.) */
function tabCanRemember() {
  try {
    sessionStorage.setItem('disputt:probe', '1');
    const ok = sessionStorage.getItem('disputt:probe') === '1';
    sessionStorage.removeItem('disputt:probe');
    return ok;
  } catch {
    return false;
  }
}

const openTabs = []; // the tabs this page has opened for the shop: they are closed again when the payment has been found

/**
 * Opens the shop in a new tab, or returns null if the browser will not. The tab keeps its `opener` on purpose: a tab that is cut loose
 * (noopener, or opener = null) cannot be closed by the game when "Takk!" shows, nor by the button on the shop's front page, and
 * `window.open` hands back nothing at all for noopener, so a blocked pop-up could not be told from an open one.
 */
function openShopTab(url) {
  const tab = window.open(url, '_blank');
  if (tab) openTabs.push(tab);
  return tab;
}

/** The shop's tabs are no use once the payment is in; a script may close a tab it opened, also on another site. */
function closeShopTabs() {
  for (const tab of openTabs.splice(0)) {
    try {
      tab.close();
    } catch {
      /* already gone */
    }
  }
}

/**
 * The host chose a package and tapped: the shop opens in a new tab. This runs inside the tap on purpose, with nothing waited for
 * before the tab opens (the shop's address was asked for when the packages came on screen): a tab that is opened later is taken for a pop-up.
 */
export function startShopCheckout(plan) {
  // A second tap before the bar has changed (a double tap) does nothing, and a later one opens the same cart again: it must not make a
  // second code, because the code that is waited for is the one in the first cart, and a host who pays in the second would never be found.
  if (store.payWaiting) {
    if (Date.now() - store.payWaiting.at < 1500) return undefined;
    return reopenShop();
  }
  const info = shopInfo;
  const variant = info?.variants[plan];
  if (!variant) throw new PayError('unavailable', 'Betalingen er ikke klar ennå. Prøv igjen om et øyeblikk.');
  const waiting = { code: newPayCode(), plan, at: Date.now() };
  waiting.url = cartLink(info.shop, variant, waiting.code, new Date(waiting.at));
  const told = announceAway('pay'); // (the guests are told before anything else: this tab may sleep once the shop is on top of it)
  const tab = openShopTab(waiting.url);
  // A browser that does not open a new tab sends this one to the shop, like the Stripe edition does: the room is kept in the tab,
  // and the page finds the payment when the host comes back. A browser that keeps nothing would lose the room.
  if (!tab && store.view && !tabCanRemember()) {
    throw new PayError('storage', 'Nettleseren din åpner ikke en ny fane og lar ikke siden huske spillet mens du betaler (står «Blokker alle informasjonskapsler» på?). Slå det av eller bruk en annen nettleser, ellers mister dere spillet.');
  }
  writeWaiting(waiting);
  setStore({ payWaiting: waiting });
  if (tab) schedule();
  else told.then(() => location.assign(waiting.url)); // (not before the guests have been told: the page is gone as soon as it is sent)
}

/** The shop once more, for a host who closed the tab or lost it. */
export function reopenShop() {
  const waiting = store.payWaiting;
  if (!waiting) return;
  if (!openShopTab(waiting.url)) location.assign(waiting.url);
}

/** The host will not pay after all. (A payment that is made later is not lost: the code from the e-mail still works under "Logg inn".) */
export function cancelShopPayment() {
  clearTimeout(timer);
  writeWaiting(null);
  setStore({ payWaiting: null });
}

// ---- asking whether it was paid ---------------------------------------------------------------------------------------------

let timer = 0;
let asking = false;
/** Not paid yet, or the answer did not come: worth asking again. Anything else will never become a pass. */
const mayStillCome = (err) => ['not_found', 'network', 'server', 'unavailable'].includes(err?.code);

function trouble(err) {
  if (['refunded', 'expired', 'disputed', 'cancelled'].includes(err.code)) return err.message;
  return `${err.message} Har du betalt, står kontaktinformasjonen i e-posten du fikk fra butikken.`;
}

function schedule() {
  clearTimeout(timer);
  const waiting = store.payWaiting;
  // (a tab nobody looks at does not ask: it asks the moment it is looked at again; and a payment that has not come in two hours is given up)
  if (!waiting || document.visibilityState !== 'visible' || Date.now() - waiting.at >= WAITING_MAX_MS) return;
  timer = setTimeout(check, Date.now() - waiting.at < POLL.fastForMs ? POLL.fastMs : POLL.slowMs);
}

/** Asks whether the code was paid. If it was, the pass is kept on this phone and "Takk!" shows. */
export async function check() {
  const waiting = store.payWaiting;
  if (!waiting || asking) return;
  asking = true;
  try {
    await restoreWithCode(waiting.code);
    writeWaiting(null);
    setStore({ payWaiting: null, paywall: false, sheet: 'thanks' });
    closeShopTabs();
  } catch (err) {
    if (!mayStillCome(err)) {
      writeWaiting(null);
      setStore({ payWaiting: null });
      toast(trouble(err), 9000);
    }
  } finally {
    asking = false;
    schedule();
  }
}

let started = false;
/** Called once when the page starts, after the payment settings have been read: takes up a payment this tab was waiting for. */
export function initShop() {
  if (started || store.payments?.provider !== 'shopify') return;
  started = true;
  document.addEventListener('visibilitychange', () => (document.visibilityState === 'visible' ? check() : clearTimeout(timer)));
  addEventListener('pageshow', (e) => e.persisted && check());
  const waiting = readWaiting();
  if (waiting) {
    setStore({ payWaiting: waiting });
    check();
  }
}
