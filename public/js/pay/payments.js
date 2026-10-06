// Payments, seen from the page: is it switched on, what pass does this phone carry, and the calls to the payment server
// (payments/worker.js). Payments are OFF unless the build says where the payment server is and gives its public key (the
// repository variables DISPUTT_PAYMENTS_URL and DISPUTT_PAYMENTS_KEY, see docs/BETALING.md); until then the game is free and
// none of this shows.
// (A file of its own: pages are cached for ten minutes ...)

import { config } from '../settings.js';
import { setStore, store, toast } from '../store.js';
import { announceAway } from './away.js';
import { isActive, normalizeCode, outlasts, verifyPass } from './pass.js';

const PAYING_KEY = 'disputt:paying'; // sessionStorage: the payment this tab sent the host off to, until the pass has been fetched
const PAYING_MAX_MS = 2 * 60 * 60_000; // a payment that was started and never finished is forgotten after two hours
const METHODS = ['vipps', 'applepay'];

/**
 * The pass lives in localStorage, under a key that names the payment server it came from. A test copy and the real site are both on
 * https://<user>.github.io, so they share localStorage; each would otherwise find the other's pass, call it broken, and throw it away.
 */
const passKey = () => `disputt:pass:${store.payments.apiUrl}`;

/** What the page knows about payments, from the build's config. `secure` is the browser's crypto (only on https pages). */
export function paymentSettings(cfg = config.payments, secure = globalThis.crypto?.subtle) {
  if (!cfg?.apiUrl || !cfg?.publicKey || !secure) return { enabled: false, freeRounds: 2, methods: [] };
  const methods = [...new Set((cfg.methods ?? []).filter((m) => METHODS.includes(m)))];
  return {
    enabled: true,
    provider: cfg.provider === 'shopify' ? 'shopify' : 'stripe', // who takes the money: Stripe (payments/worker.js) or a Shopify shop (worker-shopify.js, pay/shop.js)
    apiUrl: String(cfg.apiUrl).replace(/\/+$/, ''),
    publicKey: String(cfg.publicKey),
    methods: methods.length ? methods : ['applepay'],
    freeRounds: Number.isInteger(cfg.freeRounds) && cfg.freeRounds >= 1 ? cfg.freeRounds : 2, // (the first round is always free: the packages come at "Neste runde")
    // (the terms and the privacy statement are pages of the app, vilkar.html and personvern.html, unless the build says otherwise)
    termsUrl: cfg.termsUrl ? String(cfg.termsUrl) : 'vilkar.html',
    privacyUrl: cfg.privacyUrl ? String(cfg.privacyUrl) : 'personvern.html',
  };
}

export class PayError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Worth asking again a little later: the payment server or Stripe is busy, or the line is bad. (Not: refused for good.) */
const isTransient = (err) => ['network', 'server', 'stripe', 'unavailable'].includes(err?.code);
/** The payment may still turn into a pass: not paid yet, or the answer did not come. */
const mayStillCome = (err) => err?.code === 'unpaid' || isTransient(err);

// ---- the pass on this phone ---------------------------------------------------------------------------------------------

function readStored() {
  try {
    const data = JSON.parse(localStorage.getItem(passKey()) ?? 'null');
    return data && typeof data.token === 'string' ? data : null;
  } catch {
    return null;
  }
}

function writeStored(data) {
  try {
    if (data) localStorage.setItem(passKey(), JSON.stringify(data));
    else localStorage.removeItem(passKey());
  } catch {
    /* private mode etc.: the pass then only lasts until the page is closed */
  }
}

// ---- the payment this tab is waiting for

function readPaying() {
  try {
    const data = JSON.parse(sessionStorage.getItem(PAYING_KEY) ?? 'null');
    return data && /^cs_(test|live)_[A-Za-z0-9]+$/.test(data.id) && Date.now() - data.at < PAYING_MAX_MS ? data : null;
  } catch {
    return null;
  }
}

function writePaying(data) {
  try {
    if (data) sessionStorage.setItem(PAYING_KEY, JSON.stringify(data));
    else sessionStorage.removeItem(PAYING_KEY);
  } catch {
    /* the return from Stripe carries the session id anyway */
  }
}

/** Can this tab keep something for a while? (The room of a host who goes to pay is kept there. Some browsers refuse all storage.) */
function tabCanRemember() {
  try {
    const key = 'disputt:probe';
    sessionStorage.setItem(key, '1');
    const ok = sessionStorage.getItem(key) === '1';
    sessionStorage.removeItem(key);
    return ok;
  } catch {
    return false;
  }
}

let ready = Promise.resolve();
/** Resolves when the pass in storage has been checked (a few milliseconds after the page opens). */
export const whenReady = () => ready;

/** Called once when the page starts: reads the settings and checks the stored pass. */
export function initPayments(cfg) {
  const payments = paymentSettings(cfg);
  setStore({ payments });
  if (!payments.enabled) return ready;
  // back in this tab some other way than Stripe's redirect (the back button, a bfcache restore, switching tabs after paying elsewhere)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && checkPaying());
  addEventListener('pageshow', (e) => e.persisted && checkPaying());
  ready = (async () => {
    const stored = readStored();
    if (!stored) return;
    const checked = await verifyPass(stored.token, payments.publicKey, Date.now(), payments.apiUrl);
    if (checked.ok) setStore({ pass: checked.pass, passCode: stored.code ?? null });
    else if (checked.reason === 'expired' || checked.reason === 'signature' || checked.reason === 'format') writeStored(null);
  })();
  return ready;
}

/**
 * A pass from the payment server: checked here too, and kept on this phone. A pass that gives less than the one already there (an
 * older code typed in, a cheaper package bought) changes nothing: the phone keeps the better one, and that is what comes back.
 */
async function acceptPass({ token, code }) {
  const checked = await verifyPass(token, store.payments.publicKey, Date.now(), store.payments.apiUrl);
  if (!checked.ok) throw new PayError('bad_pass', 'Tilgangen kunne ikke kontrolleres. Prøv igjen om litt.');
  writePaying(null); // (whatever this tab was waiting for does not matter any more: a code typed in must not be followed by a late "Takk!")
  if (!outlasts(checked.pass, store.pass)) return store.pass;
  writeStored({ token, code: code ?? null });
  setStore({ pass: checked.pass, passCode: code ?? null });
  return checked.pass;
}

/** Takes the pass off this phone (the customer still has the code). */
export function forgetPass() {
  writeStored(null);
  setStore({ pass: null, passCode: null });
}

export const hasActivePass = () => isActive(store.pass);

// ---- the payment server --------------------------------------------------------------------------------------------------

async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`${store.payments.apiUrl}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'omit',
    });
  } catch {
    throw new PayError('network', 'Fikk ikke kontakt med betalingen. Sjekk nettet og prøv igjen.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new PayError(data.error ?? 'server', data.message ?? 'Noe gikk galt. Prøv igjen om litt.');
  return data;
}

const isLocal = (h) => h === 'localhost' || h === '127.0.0.1' || h === '[::1]';

/**
 * Starts a payment and sends this tab to Stripe's page. The game stays where it is: a host's room is saved to this tab when it
 * leaves (public/js/p2p/host.js), and picked up again when Stripe sends the host back.
 */
export async function startCheckout(plan, method) {
  // (a browser that keeps nothing would lose the room, and the guests would wait for a game that cannot come back)
  if (store.view && !tabCanRemember()) {
    throw new PayError('storage', 'Nettleseren din lar ikke siden huske spillet mens du betaler (står «Blokker alle informasjonskapsler» på?). Slå det av eller bruk en annen nettleser, ellers mister dere spillet.');
  }
  const { url, session } = await api('/checkout', { method: 'POST', body: { plan, method } });
  const target = new URL(url);
  if (target.protocol !== 'https:' && !(target.protocol === 'http:' && isLocal(target.hostname))) throw new PayError('server', 'Fikk en betalingsside vi ikke stoler på.');
  if (typeof session === 'string') writePaying({ id: session, plan, at: Date.now() });
  await announceAway('pay'); // the guests are told that the host is away for a while, so they wait instead of giving up
  location.assign(target.href);
}

/** The host is back from Stripe: asks the payment server whether it was paid, and keeps the pass. */
export async function claimPurchase(sessionId) {
  return acceptPass(await api(`/claim?session_id=${encodeURIComponent(sessionId)}`));
}

/** A customer on a new phone types the code they were given. */
export async function restoreWithCode(typed) {
  const code = normalizeCode(typed);
  if (!code) throw new PayError('bad_request', 'Koden ser ikke riktig ut. Den har tolv tegn, som K7M2-9QXD-4TRB.');
  return acceptPass(await api('/restore', { method: 'POST', body: { code } }));
}

/** Takes ?pay=… out of the address bar, so that a reload does not do the same again. */
function dropPayParams() {
  try {
    const url = new URL(location.href);
    url.searchParams.delete('pay');
    url.searchParams.delete('session_id');
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    /* sandboxed frames etc. */
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let claiming = false; // one check at a time, whoever asks

/**
 * Asks whether `sessionId` was paid and keeps the pass. Stripe can need a moment to say yes, and the line or the payment server can
 * stumble, so it asks again, `tries` times in all, as long as the answer may still turn into a yes.
 */
async function claimWhenPaid(sessionId, tries = 1, everyMs = 2000) {
  for (let i = 1; ; i++) {
    try {
      return await claimPurchase(sessionId);
    } catch (err) {
      if (!mayStillCome(err) || i >= tries) throw err;
      await sleep(everyMs);
    }
  }
}

/** What to say to a host who is back from paying and did not get the pass. */
function trouble(err) {
  if (err.code === 'unpaid') return 'Vi har ikke fått bekreftet betalingen ennå. Den dukker opp av seg selv når den er gjennomført.';
  if (isTransient(err)) return 'Betalingen er gjort, men vi fikk ikke hentet tilgangen din akkurat nå. Åpne siden på nytt om litt, så prøver vi igjen. Koden fra betalingssiden virker også under «Logg inn».';
  if (['refunded', 'expired', 'disputed'].includes(err.code)) return err.message;
  return `${err.message} Har du betalt, står kontaktinformasjonen i kvitteringen fra Stripe.`;
}

/** Stripe sent the host back to the game (…/?pay=success&session_id=…, or ?pay=cancel). `retryMs`: the wait between two questions. */
export async function handlePaymentReturn({ retryMs = 2000 } = {}) {
  const q = new URLSearchParams(location.search);
  const status = q.get('pay');
  const sessionId = q.get('session_id');
  if (status) dropPayParams();
  if (!store.payments?.enabled) return;
  await whenReady();
  if (status === 'cancel') {
    writePaying(null);
    toast('Betalingen ble avbrutt. Du er ikke belastet.', 5000);
    return;
  }
  if (status === 'success' && sessionId && !claiming) {
    // This tab remembers the payment from now on, whatever comes next: a new tab or another browser (Vipps) has no marker from before,
    // and an attempt that fails is tried again when the page is opened again or comes into view.
    if (readPaying()?.id !== sessionId) writePaying({ id: sessionId, plan: null, at: Date.now() });
    claiming = true;
    setStore({ payBusy: true });
    try {
      await claimWhenPaid(sessionId, 12, retryMs);
      setStore({ paywall: false, sheet: 'thanks' });
    } catch (err) {
      if (!mayStillCome(err)) writePaying(null); // it will never become a pass
      toast(trouble(err), 9000);
    } finally {
      claiming = false;
      setStore({ payBusy: false });
    }
    return;
  }
  await checkPaying();
}

/**
 * This tab sent the host off to Stripe and has not had the pass yet: was it paid while the host was away? Silent unless it was.
 * (When Vipps opens another browser, or the host goes back by the back button, nothing says "?pay=success" here.)
 */
export async function checkPaying() {
  const paying = readPaying();
  if (!paying || claiming || !store.payments?.enabled) return;
  claiming = true;
  try {
    await whenReady();
    await claimPurchase(paying.id);
    setStore({ paywall: false, sheet: 'thanks' });
  } catch (err) {
    // not paid yet, or the answer did not come: try again next time. Anything else will never become a pass.
    if (!mayStillCome(err)) writePaying(null);
  } finally {
    claiming = false;
  }
}
