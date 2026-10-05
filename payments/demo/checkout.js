// The pretend payment page of the demo: what Stripe's own page would show for a payment, and a button that "pays" it. The payment
// is kept in this browser (payments/demo/state.js); "Betal" marks it as paid and sends the host back to the game, as Stripe does.
//
// Copied to <site>/demo/checkout.js when the build switches the demo on (tools/pages/build.mjs); not part of an ordinary build.
import { loadStripe, saveStripe } from './state.js';

const page = document.getElementById('page');

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

/** The little Markdown the payment server puts in Stripe's texts, **bold** and [text](https://link), as nodes: never as HTML. */
function markdown(text) {
  const out = document.createDocumentFragment();
  for (const part of text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\(https:\/\/[^)\s]+\))/)) {
    const bold = part.match(/^\*\*([^*]+)\*\*$/);
    const link = part.match(/^\[([^\]]+)\]\((https:\/\/[^)\s]+)\)$/);
    if (bold) out.append(el('strong', { textContent: bold[1] }));
    else if (link) out.append(el('a', { textContent: link[1], href: link[2], target: '_blank', rel: 'noopener' }));
    else out.append(part);
  }
  return out;
}

const paragraphs = (text) => String(text ?? '').split(/\n{2,}/).filter(Boolean).map((p) => el('p', {}, markdown(p)));
const METHOD = { vipps: 'Vipps', card: 'kort og Apple Pay' };
const homeLink = (text) => el('p', {}, el('a', { href: '../', textContent: text }));

function show(...nodes) {
  page.replaceChildren(...nodes);
}

function render() {
  let fake;
  try {
    fake = loadStripe(localStorage);
  } catch {
    return show(el('h1', { textContent: 'Demoen får ikke bruke lagring' }), el('p', { textContent: 'Nettleseren lar ikke siden huske noe (privat fane eller blokkerte data?), og da kan ikke demoen følge deg hit og tilbake.' }), homeLink('Til spillet'));
  }
  const id = new URLSearchParams(location.search).get('s');
  const session = id ? fake.sessions.get(id) : undefined;
  if (!session) {
    return show(el('h1', { textContent: 'Fant ikke betalingen' }), el('p', { textContent: 'Demoen husker betalinger bare i nettleseren der de ble startet. Start betalingen på nytt fra spillet.' }), homeLink('Til spillet'));
  }
  if (session.payment_status === 'paid') {
    return show(el('h1', { textContent: 'Betalingen er gjennomført' }), el('p', { textContent: 'Denne betalingen er allerede betalt (demo).' }), el('p', {}, el('a', { id: 'back', href: fake.successUrl(id), textContent: 'Tilbake til spillet' })));
  }

  const methods = [...session.allowed_payment_method_types, ...session.payment_method_types].map((m) => METHOD[m] ?? m).join(', ') || 'alle betalingsmåter';
  const amount = `${(session.amount_total / 100).toFixed(0)} kr`;
  const terms = el('input', { type: 'checkbox', id: 'terms' });
  const pay = el('button', { id: 'pay', type: 'button', textContent: `Betal ${amount}`, disabled: session.consent_collection === 'required' });
  if (session.consent_collection === 'required') {
    terms.addEventListener('change', () => (pay.disabled = !terms.checked));
  }
  pay.addEventListener('click', () => {
    pay.disabled = true;
    const now = loadStripe(localStorage); // (afresh: another tab may have paid it, or changed it)
    if (now.sessions.get(id)?.payment_status !== 'paid') now.pay(id);
    saveStripe(localStorage, now);
    location.assign(now.successUrl(id));
  });

  show(
    el('h1', { id: 'amount', textContent: amount }),
    el('p', { id: 'what', className: 'what', textContent: session.intent.description ?? 'Disputt' }),
    el('p', { id: 'methods', className: 'methods', textContent: `Betaling med ${methods}` }),
    el('div', { id: 'note', className: 'note' }, ...paragraphs(session.custom_text.submit)),
    session.consent_collection === 'required' ? el('label', { className: 'terms' }, terms, el('span', {}, markdown(session.custom_text.terms ?? 'Jeg godtar vilkårene.'))) : '',
    pay,
    el('p', { className: 'cancel' }, el('a', { id: 'cancel', href: session.cancel_url, textContent: 'Avbryt' })),
  );
}

render();
