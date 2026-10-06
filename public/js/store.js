// Tiny global store: one mutable state object, components subscribe through `useStore()`.

import { useEffect, useRef, useState } from './vendor/htm-preact.js';

const SESSION_KEY = 'disputt:session';

/** The player's identity in a room lives in sessionStorage: per tab, survives reloads and phone sleep. */
export function loadSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    const s = raw && JSON.parse(raw);
    return s && s.code && s.playerId && s.token ? s : null;
  } catch {
    return null;
  }
}

export function saveSession(session) {
  try {
    if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* private mode etc. – the game still works, it just can't resume after a reload */
  }
}

/** Join links look like <site>/?j=ABCD (works on any static host). Older <site>/j/ABCD links still work on the Node server. */
export function parseRoute(loc = window.location) {
  const q = new URLSearchParams(loc.search).get('j');
  if (q && /^[A-Za-z]{4}$/.test(q)) return { page: 'join', code: q.toUpperCase() };
  const m = loc.pathname.match(/\/j\/([A-Za-z]{4})\/?$/);
  return m ? { page: 'join', code: m[1].toUpperCase() } : { page: 'home' };
}

export const store = {
  conn: 'connecting', // connecting | open | closed
  everOpened: false,
  view: null, // latest per-player view from the server
  session: loadSession(),
  route: parseRoute(),
  joining: null, // room code we are trying to join
  creating: false, // p2p: the host is being set up (reserving a room code with the signalling server)
  stuck: 0, // p2p: how many connection attempts in a row failed without ever finding a line to the host
  hostAwayUntil: 0, // p2p guest: the host said it was going away (to pay) and is expected back before this time (ms since 1970)
  wakeLockDenied: false, // the browser refused to keep the screen awake (low-power mode, home-screen app …): tell players to turn auto-lock off
  seats: null, // { code, seats } when the game has already started and a seat can be claimed
  notice: null, // message shown on the home screen (e.g. "game is gone")
  toast: null, // transient error/info
  sheet: null, // 'scores' | 'rules' | 'host' | 'qr' | 'settings' | 'home' | 'fasit' | 'login' | 'thanks' | 'access' | null
  editing: false, // lobby: changing name/avatar
  step: null, // the host's set-up: 1 profile, 2 points, 3 invitation (null: see hostStep in screens/setup.js)
  payments: null, // what the page knows about payments (pay/payments.js): { enabled, apiUrl, publicKey, methods, freeRounds }
  pass: null, // the verified access pass on this phone (pay/pass.js), or null
  passCode: null, // the restore code that goes with it
  paywall: false, // the packages are on screen (screens/pay.js)
  payBusy: false, // a payment is being checked after Stripe sent the host back
  payWaiting: null, // Shopify: the payment this tab is waiting for while the host pays in the other tab, { code, plan, url, at } (pay/shop.js)
  replaced: false, // the same player opened the game in another tab
  info: null, // /api/info (LAN urls etc.)
};

const listeners = new Set();
let version = 0;

export function setStore(patch) {
  Object.assign(store, patch);
  version++;
  for (const l of listeners) l();
}

export function useStore() {
  const [, force] = useState(0);
  const renderedAt = useRef(version);
  renderedAt.current = version;
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    // The store may have changed between this render and the subscription (e.g. the socket opened); catch up.
    if (version !== renderedAt.current) l();
    return () => listeners.delete(l);
  }, []);
  return store;
}

let toastTimer;
export function toast(message, ms = 3500) {
  clearTimeout(toastTimer);
  setStore({ toast: message });
  toastTimer = setTimeout(() => setStore({ toast: null }), ms);
}
