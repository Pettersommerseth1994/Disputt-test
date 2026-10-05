// What the payment demo remembers: the keys that sign the passes, and the pretend Stripe's sessions and payments. They are kept in
// the browser (localStorage) and read afresh for every call, because the host leaves the game for the pretend payment page and
// comes back to a page that starts from nothing, and because a second tab may have paid in the meantime.
//
// Copied to <site>/demo/state.js when the build switches the demo on (tools/pages/build.mjs); not part of an ordinary build.
import { createFakeStripe } from './fakestripe.js';

const KEYS = 'disputt:demo:keys';
const STRIPE = 'disputt:demo:stripe';
const KEEP = 40; // sessions and payments kept; the oldest are dropped

/** What the pretend Stripe calls its payment page. The demo sends the browser to its own page (demo/checkout.html) instead. */
export const CHECKOUT_BASE = 'https://checkout.stripe.demo.invalid';

/** Can this browser keep something? (Without it the demo cannot follow the host to the payment page and back.) */
export function storageWorks(storage) {
  try {
    storage.setItem('disputt:demo:probe', '1');
    const ok = storage.getItem('disputt:demo:probe') === '1';
    storage.removeItem('disputt:demo:probe');
    return ok;
  } catch {
    return false;
  }
}

const toB64 = (buffer) => btoa(String.fromCharCode(...new Uint8Array(buffer)));

/** The key pair of this browser's pretend payment server: made once, kept. { privateKey: PKCS#8, publicKey: SPKI }, both base64. */
export async function loadKeys(storage) {
  try {
    const kept = JSON.parse(storage.getItem(KEYS) ?? 'null');
    if (typeof kept?.privateKey === 'string' && typeof kept?.publicKey === 'string') return kept;
  } catch {
    /* made again below */
  }
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const keys = {
    privateKey: toB64(await crypto.subtle.exportKey('pkcs8', pair.privateKey)),
    publicKey: toB64(await crypto.subtle.exportKey('spki', pair.publicKey)),
  };
  storage.setItem(KEYS, JSON.stringify(keys));
  return keys;
}

/** A pretend Stripe holding what this browser has kept. */
export function loadStripe(storage) {
  const fake = createFakeStripe({ checkoutBase: CHECKOUT_BASE });
  try {
    const kept = JSON.parse(storage.getItem(STRIPE) ?? 'null');
    for (const [id, session] of kept?.sessions ?? []) fake.sessions.set(id, session);
    for (const [id, payment] of kept?.payments ?? []) fake.payments.set(id, payment);
  } catch {
    /* nothing kept, or unreadable: start empty */
  }
  return fake;
}

/** Keeps what the pretend Stripe holds now (the newest sessions, and the payments that belong to them). */
export function saveStripe(storage, fake) {
  const sessions = [...fake.sessions].slice(-KEEP);
  const paid = new Set(sessions.map(([, session]) => session.payment_intent).filter(Boolean));
  storage.setItem(STRIPE, JSON.stringify({ sessions, payments: [...fake.payments].filter(([id]) => paid.has(id)) }));
}
