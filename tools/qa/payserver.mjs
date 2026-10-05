// How the paid-evening test (payflow.mjs) looks at the payment side, as a handful of questions, so that the same test can be played
// against the payment server with a pretend Stripe in this process (tools/qa/payments-stack.mjs, `play.mjs --pay`) and against the
// payment demo, where both live in the host's browser (payments/demo/, `play.mjs --pay-demo`).
//
// `p` is a phone ({ name, page }): in the demo the payments are in the localStorage of the phone that pays, in the other case it does
// not matter which phone asks.

const CODE = '[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}';

/** The payment server of tools/qa/payments-stack.mjs, with its pretend Stripe. */
export const realServer = (stack) => ({
  name: 'payment server with a pretend Stripe',
  sessionCount: async () => stack.fake.sessions.size,
  lastSession: async () => [...stack.fake.sessions.values()].at(-1),
  lastPayment: async () => [...stack.fake.payments.values()].at(-1),
  // (the pretend page keeps Stripe's own text, with the code in **bold** Markdown)
  codeOnThePage: (note) => note.match(new RegExp(`\\*\\*(${CODE})\\*\\*`))?.[1],
  onCheckoutPage: (p) => p.page.waitForFunction(() => location.pathname.startsWith('/pay/'), { timeout: 20000 }),
  confirm: (p) => p.page.click('#pay'),
  payBehindTheBack: async (_p, session) => stack.fake.pay(session.id),
});

/** The demo: the pretend Stripe's sessions and payments are kept in the browser (payments/demo/state.js). */
export const demoServer = () => {
  const NAVIGATING = /detached Frame|Execution context was destroyed|Cannot find context/i;
  const state = async (p) => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await p.page.evaluate(() => JSON.parse(localStorage.getItem('disputt:demo:stripe') ?? '{"sessions":[],"payments":[]}'));
      } catch (err) {
        if (attempt >= 5 || !NAVIGATING.test(String(err?.message))) throw err;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  };
  return {
    name: 'payment demo',
    sessionCount: async (p) => (await state(p)).sessions.length,
    lastSession: async (p) => (await state(p)).sessions.at(-1)?.[1],
    lastPayment: async (p) => (await state(p)).payments.at(-1)?.[1],
    // (the demo page shows the Markdown as it should look: the code in bold)
    codeOnThePage: (note) => note.match(new RegExp(`(${CODE})`))?.[1],
    onCheckoutPage: (p) => p.page.waitForFunction(() => location.pathname.endsWith('/demo/checkout.html') && document.querySelector('#pay'), { timeout: 20000 }),
    confirm: async (p) => {
      if (await p.page.$('#terms')) await p.page.click('#terms'); // (the box about the right of withdrawal has to be ticked first)
      await p.page.click('#pay');
    },
    // the customer pays in the Vipps app, not on this page: the demo's own page code does it, behind the page's back
    payBehindTheBack: (p, session) =>
      p.page.evaluate(async (id) => {
        const state = await import(new URL('state.js', location.href).href);
        const fake = state.loadStripe(localStorage);
        fake.pay(id);
        state.saveStripe(localStorage, fake);
      }, session.id),
  };
};
