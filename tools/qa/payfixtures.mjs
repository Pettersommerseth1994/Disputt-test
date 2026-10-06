// The payment screens, as patches for the page's store, for the QA tools that draw every screen (overlap.mjs, fit.mjs, shots.mjs).
// Each is [key, patch]; a patch with a `view` is that screen on top of a game view (the points of the last free round, which is
// where the host meets the packages).
import { buildFixtures } from './fixtures.mjs';

export const PAY = {
  enabled: true,
  apiUrl: 'http://127.0.0.1:1',
  publicKey: 'qa',
  methods: ['vipps', 'applepay'],
  freeRounds: 2,
  termsUrl: 'https://example.com/vilkar',
  privacyUrl: 'https://example.com/personvern',
};
export const CODE = 'K7M2-9QXD-4TRB';
/** The same, with a Shopify shop: no methods to choose between (the customer chooses in the shop), and the shop that the page knows about. */
export const PAY_SHOP = { enabled: true, provider: 'shopify', apiUrl: 'http://127.0.0.1:1', publicKey: 'qa', methods: ['applepay'], freeRounds: 2, termsUrl: PAY.termsUrl, privacyUrl: PAY.privacyUrl };
export const SHOP_INFO = { shop: 'https://shop.example.test', variants: { evening: '44000000000001', year: '44000000000002', lifetime: '44000000000003' } };

/** What the payment fields of the store go back to between two screens. */
export const PAY_BASE = { payments: null, pass: null, passCode: null, paywall: false, payBusy: false, payWaiting: null, hostAwayUntil: 0 };

const DAY = 86_400_000;
/** A pass as the page keeps it after checking it (pay/pass.js). */
export const passOf = (plan, now = Date.now()) => ({ plan, paidAt: now, issuedAt: now, expiresAt: plan === 'lifetime' ? null : now + (plan === 'year' ? 365 * DAY : 12 * 3600_000) });

export function payScreens(fixtures = buildFixtures()) {
  const atRound2 = (key) => {
    const view = structuredClone(fixtures[key]);
    view.round = 2;
    if (view.summary) view.summary.round = 2;
    return view;
  };
  const host = atRound2('summary-right-host');
  const guest = atRound2('summary-right-guest');
  // the guests are on their way back from the wait: the host's thank-you sheet says whom it is waiting for
  const waiting = structuredClone(host);
  for (const p of waiting.players) if (!p.isHost) p.connected = false;
  return [
    ['pay-home', { payments: PAY }],
    ['pay-home-customer', { payments: PAY, pass: passOf('year'), passCode: CODE }],
    ['pay-gate', { payments: PAY, view: host, paywall: true }],
    ['pay-gate-applepay-only', { payments: { ...PAY, methods: ['applepay'] }, view: host, paywall: true }],
    ['pay-browse', { payments: PAY, paywall: true }],
    ['pay-browse-customer', { payments: PAY, paywall: true, pass: passOf('evening'), passCode: CODE }],
    ['pay-login', { payments: PAY, sheet: 'login' }],
    ['pay-thanks', { payments: PAY, view: host, sheet: 'thanks', pass: passOf('year'), passCode: CODE }],
    ['pay-thanks-waiting', { payments: PAY, view: waiting, sheet: 'thanks', pass: passOf('lifetime'), passCode: CODE }],
    ['pay-access', { payments: PAY, view: host, sheet: 'access', pass: passOf('year'), passCode: CODE }],
    ['pay-access-none', { payments: PAY, view: host, sheet: 'access' }],
    ['pay-host-options', { payments: PAY, view: host, sheet: 'host' }],
    // a guest whose host has gone to pay
    ['pay-guest-host-away', { payments: PAY, view: guest, conn: 'closed', hostAwayUntil: Date.now() + 10 * 60_000 }],
    ['pay-checking', { payments: PAY, view: host, payBusy: true }],
    // the same with a Shopify shop: one button and a box to tick, the host in the shop's tab, and the sheets that say where the code is
    ['pay-gate-shop', { payments: PAY_SHOP, view: host, paywall: true }],
    ['pay-browse-shop', { payments: PAY_SHOP, paywall: true }],
    ['pay-waiting-shop', { payments: PAY_SHOP, view: host, paywall: true, payWaiting: { code: CODE, plan: 'year', url: 'https://shop.example.test/cart/44000000000002:1', at: Date.now() } }],
    ['pay-login-shop', { payments: PAY_SHOP, sheet: 'login' }],
    ['pay-thanks-shop', { payments: PAY_SHOP, view: host, sheet: 'thanks', pass: passOf('year'), passCode: CODE }],
  ];
}
