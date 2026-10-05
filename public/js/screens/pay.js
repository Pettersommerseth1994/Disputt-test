// The screens of the paid part: the packages (shown when the host has to pay to go on), "Logg inn" (a code from a receipt gets
// the pass back on a new phone), "Takk!" (after paying) and "Min tilgang" (in the host's options).
// (A file of its own: pages are cached for ten minutes ...)

import { html, useEffect, useRef, useState } from '../vendor/htm-preact.js';
import { setStore, toast, useStore } from '../store.js';
import { Button, Sheet } from '../ui.js';
import { joinNames } from '../impostors.js';
import { cx } from '../util.js';
import { formatCodeInput, isActive, normalizeCode } from '../pay/pass.js';
import { requestNextRound } from '../pay/gate.js';
import { forgetPass, restoreWithCode, startCheckout } from '../pay/payments.js';
import { DEFAULT_PLAN, PERKS, PLANS, describeValidity, formatPrice, planById } from '../pay/plans.js';

const close = () => setStore({ sheet: null });
const COUNT = ['ingen', 'én', 'to', 'tre', 'fire', 'fem'];
const rounds = (n) => `${COUNT[n] ?? n} ${n === 1 ? 'runde' : 'runder'}`;
/** "De to første rundene i hvert spill er gratis." */
const freeLine = (n) => (n === 1 ? 'Den første runden i hvert spill er gratis.' : `De ${COUNT[n] ?? n} første rundene i hvert spill er gratis.`);

async function copyCode(code) {
  try {
    await navigator.clipboard.writeText(code);
    return toast('Koden er kopiert.');
  } catch {
    /* fall through to the old way */
  }
  const area = document.createElement('textarea');
  area.value = code;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.append(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    /* not allowed either */
  }
  area.remove();
  toast(ok ? 'Koden er kopiert.' : `Skriv ned koden: ${code}`, ok ? 3500 : 12000);
}

const Check = () => html`<svg class="perk__check" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>`;

// ------------------------------------------------------------------------------------------------ the packages

function PlanCard({ plan, selected, onSelect }) {
  return html`<label class=${cx('plan', selected && 'is-selected')}>
    <input type="radio" name="plan" value=${plan.id} checked=${selected} onChange=${() => onSelect(plan.id)} />
    <span class="plan__radio" aria-hidden="true"></span>
    <span class="plan__main">
      <span class="plan__name">${plan.name}</span>
      <span class="plan__sub">${plan.length}</span>
    </span>
    <span class="plan__price">${formatPrice(plan.price)}</span>
    ${plan.badge && html`<span class="plan__badge">${plan.badge}</span>`}
  </label>`;
}

/**
 * The packages and the way to pay. Opened when the host presses "Neste runde" after the free rounds (`gate`), and from
 * "Min tilgang" and "Logg inn" (then it is only a list of what there is to buy).
 */
export function Paywall({ view = null }) {
  const s = useStore();
  const pay = s.payments;
  const [plan, setPlan] = useState(DEFAULT_PLAN);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  // coming back with the back button must not leave the buttons waiting for a page that never opens
  useEffect(() => {
    const reset = () => setBusy(null);
    addEventListener('pageshow', reset);
    return () => removeEventListener('pageshow', reset);
  }, []);
  const chosen = planById(plan);
  const have = isActive(s.pass);
  const gate = Boolean(view?.you?.isHost) && view.round >= pay.freeRounds && !have;
  const go = async (method) => {
    setBusy(method);
    setError('');
    try {
      await startCheckout(plan, method);
    } catch (err) {
      setError(err.message);
      setBusy(null);
    }
  };
  const label = { vipps: 'Vipps', applepay: 'Apple Pay' };
  const terms = [pay.termsUrl && ['Vilkår', pay.termsUrl], pay.privacyUrl && ['Personvern', pay.privacyUrl]].filter(Boolean);

  return html`<main class="screen paywall">
    <div class="paywall__top"><${Button} variant="text" onClick=${() => setStore({ paywall: false })}>‹ Tilbake</${Button}></div>
    <header class="stack stack--tight">
      <p class="eyebrow">${gate ? `Dere har spilt ${rounds(view.round)}${view.round <= pay.freeRounds ? ' gratis' : ''}` : 'For verter'}</p>
      <h1 class="setup__title rise-in">${gate ? 'Fortsett kvelden' : 'Pakker'}</h1>
      <p class="lead muted">${gate ? 'Verten betaler én gang, så kan alle spille videre.' : `Bare verten betaler. ${freeLine(pay.freeRounds)}`}</p>
    </header>

    ${have && html`<p class="chip chip--yellow paywall__have" role="status">Du har tilgang: ${planById(s.pass.plan)?.name} · ${describeValidity(s.pass)}</p>`}

    <div class="plans" role="radiogroup" aria-label="Velg pakke">
      ${PLANS.map((p) => html`<${PlanCard} key=${p.id} plan=${p} selected=${plan === p.id} onSelect=${setPlan} />`)}
    </div>
    <p class="small muted center plans__detail" aria-live="polite">${chosen.detail}</p>

    <section class="card stack stack--tight perks">
      <h3>Dette får du</h3>
      <ul class="perks__list">
        ${PERKS.map(([title, text]) => html`<li key=${title}><${Check} /><span><strong>${title}</strong><small>${text}</small></span></li>`)}
      </ul>
    </section>

    <p class="small muted center paywall__fine">
      Engangsbetaling inkl. mva, ingen abonnement. Du betaler hos Stripe, så vi får aldri se kortnummeret ditt.${terms.length > 0 && ' '}
      ${terms.map(([name, href], i) => html`${i > 0 && ' · '}<a href=${href} target="_blank" rel="noopener">${name}</a>`)}
    </p>
    <p class="center"><span class="muted">Allerede kunde?</span> <${Button} variant="text" onClick=${() => setStore({ sheet: 'login' })}>Logg inn</${Button}></p>

    <div class="dock">
      ${error && html`<p class="field__error center" role="alert">${error}</p>`}
      ${pay.methods.map(
        (m, i) => html`<${Button} key=${m} block variant=${i === 0 ? undefined : 'cream'} disabled=${busy !== null} onClick=${() => go(m)}>
          ${busy === m ? 'Åpner betalingen …' : `Betal med ${label[m]}`}
        </${Button}>`,
      )}
    </div>
  </main>`;
}

// ------------------------------------------------------------------------------------------------ "Logg inn"

/** A customer with a code from a receipt gets their pass back. There are no accounts: the code is the login. */
export function LoginSheet() {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const field = useRef(null);
  useEffect(() => field.current?.focus(), []);
  const valid = normalizeCode(typed) !== null;
  const submit = async (e) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError('');
    try {
      const pass = await restoreWithCode(typed);
      setStore({ sheet: null, paywall: false }); // (opened from the packages: back to the game, where the next round can start now)
      toast(`Velkommen tilbake! ${planById(pass.plan)?.name}: ${describeValidity(pass).toLowerCase()}.`, 6000);
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };
  return html`<${Sheet} title="Logg inn" onClose=${close}>
    <form class="stack" onSubmit=${submit}>
      <p class="muted">Skriv inn koden du fikk da du betalte, så får du tilgangen din tilbake på denne telefonen.</p>
      <div class="field">
        <label class="sr-only" for="pass-code">Koden fra kvitteringen</label>
        <input
          id="pass-code"
          ref=${field}
          class="input input--passcode"
          value=${typed}
          onInput=${(e) => {
            const v = formatCodeInput(e.currentTarget.value);
            e.currentTarget.value = v; // a re-render alone would not undo a rejected character
            setTyped(v);
            setError('');
          }}
          maxlength="14"
          autocomplete="off"
          autocapitalize="characters"
          autocorrect="off"
          spellcheck="false"
          enterkeyhint="go"
          placeholder="K7M2-9QXD-4TRB"
          aria-describedby="pass-code-error"
        />
        ${error && html`<span class="field__error" id="pass-code-error" role="alert">${error}</span>`}
      </div>
      <${Button} block type="submit" disabled=${!valid || busy}>${busy ? 'Sjekker …' : 'Hent tilgangen'}</${Button}>
      <p class="small muted">Koden gjelder uansett om du betalte med Vipps eller Apple Pay. Du fikk den da du betalte («Takk!»-siden), og den står under Vertsvalg › Min tilgang på telefonen du betalte med.</p>
      <p class="center"><${Button} variant="text" onClick=${() => setStore({ sheet: null, paywall: true })}>Har du ikke kjøpt ennå? Se pakkene</${Button}></p>
    </form>
  </${Sheet}>`;
}

// ------------------------------------------------------------------------------------------------ "Takk!" and "Min tilgang"

function CodeCard({ code }) {
  return html`<article class="card card--paper center stack stack--tight accesscode">
    <p class="eyebrow">Koden din</p>
    <p class="passcode display" aria-label=${`Koden din er ${code.split('').join(' ')}`}>${code}</p>
    <${Button} variant="cream" size="small" onClick=${() => copyCode(code)}>Kopier koden</${Button}>
  </article>`;
}

/** Shown when the host is back from Stripe. The code is the way back in on another phone, so it is shown here, big. */
export function ThanksSheet() {
  const s = useStore();
  const plan = s.pass && planById(s.pass.plan);
  const view = s.view;
  // the host pressed "Neste runde" and got the packages instead: now that it is paid, the round is one tap away
  const next = Boolean(view?.you?.isHost) && view.phase === 'summary';
  const away = next ? view.players.filter((p) => !p.connected && !p.isHost).map((p) => p.name) : []; // still on their way back from the wait
  const go = () => {
    close();
    if (next) requestNextRound(view);
  };
  return html`<${Sheet} title="Takk!" onClose=${close}>
    <div class="stack">
      <p class="lead">Du har tilgang${plan && html`: <strong>${plan.name}</strong>`}. ${s.pass && describeValidity(s.pass)}.</p>
      ${s.passCode && html`<${CodeCard} code=${s.passCode} />`}
      <p class="small muted">Ta vare på koden, for eksempel med et skjermbilde. Med den får du tilgangen tilbake på en ny telefon, uten konto.</p>
      ${away.length > 0 && html`<p class="small center" role="status">Venter på at ${joinNames(away)} kommer tilbake …</p>`}
      <${Button} block variant="lime" onClick=${go}>${next ? `Start runde ${view.round + 1}` : 'Fortsett spillet'}</${Button}>
    </div>
  </${Sheet}>`;
}

/** In the host's options: what this phone has, the code, and the way to buy or to take the pass off the phone. */
export function AccessSheet() {
  const s = useStore();
  const [armed, setArmed] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const have = isActive(s.pass);
  const plan = have && planById(s.pass.plan);
  const forget = () => {
    if (armed) return forgetPass();
    setArmed(true);
    timer.current = setTimeout(() => setArmed(false), 3500);
  };
  return html`<${Sheet} title="Min tilgang" onClose=${close}>
    <div class="stack">
      ${have
        ? html`<p class="lead">Du har tilgang: <strong>${plan?.name}</strong>. ${describeValidity(s.pass)}.</p>
            ${s.passCode && html`<${CodeCard} code=${s.passCode} />`}
            <p class="small muted">Bare verten trenger tilgang. Koden gir deg den tilbake på en annen telefon. Fjerner du tilgangen her, fjernes koden fra denne telefonen også, så skriv den ned først.</p>
            ${s.pass.expiresAt !== null && html`<${Button} block variant="cream" onClick=${() => setStore({ sheet: null, paywall: true })}>Se pakkene</${Button}>`}
            <${Button} block variant="ghost" onClick=${forget}>${armed ? 'Trykk igjen for å fjerne' : 'Fjern tilgangen fra denne telefonen'}</${Button}>`
        : html`<p class="lead">Du har ikke tilgang ennå.</p>
            <p class="muted">${freeLine(s.payments.freeRounds)} Vil dere spille lenger, betaler verten én gang.</p>
            <${Button} block onClick=${() => setStore({ sheet: null, paywall: true })}>Se pakkene</${Button}>
            <p class="center"><span class="muted">Allerede kunde?</span> <${Button} variant="text" onClick=${() => setStore({ sheet: 'login' })}>Logg inn</${Button}></p>`}
    </div>
  </${Sheet}>`;
}
