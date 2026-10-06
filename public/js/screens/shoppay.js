// The bar at the bottom of the packages when the shop is Shopify's: the box to tick, the button that opens the shop in a new tab,
// and what the bar says while the host pays there (screens/pay.js has the rest of the packages screen).
// (A file of its own: pages are cached for ten minutes ...)

import { html, useEffect, useState } from '../vendor/htm-preact.js';
import { useStore } from '../store.js';
import { Button } from '../ui.js';
import { cancelShopPayment, knownShop, loadShop, reopenShop, startShopCheckout } from '../pay/shop.js';

export function ShopDock({ plan }) {
  const s = useStore();
  const pay = s.payments;
  const [agreed, setAgreed] = useState(false);
  const [shop, setShop] = useState(knownShop());
  const [error, setError] = useState('');
  const [tries, setTries] = useState(0);
  // the shop's address is asked for as soon as the packages are on screen, so that the tap can open the tab at once
  useEffect(() => {
    if (shop) return undefined;
    let live = true;
    loadShop()
      .then((info) => live && (setError(''), setShop(info)))
      .catch((err) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, [shop, tries]);
  const go = () => {
    setError('');
    try {
      startShopCheckout(plan); // (inside the tap: nothing is waited for before the tab opens)
      setAgreed(false); // (the consent is for this purchase: a new try has to be agreed to again)
    } catch (err) {
      setError(err.message);
    }
  };

  if (s.payWaiting) {
    return html`
      <div class="paywait" role="status">
        <p class="paywait__title">Venter på betalingen …</p>
        <p class="small">Fullfør betalingen i den andre fanen. Siden her henter tilgangen selv når den er gjennomført. Har du allerede betalt, kommer den om et øyeblikk.</p>
      </div>
      <${Button} block variant="cream" onClick=${reopenShop}>Åpne betalingen igjen</${Button}>
      <${Button} block variant="text" onClick=${cancelShopPayment}>Avbryt</${Button}>`;
  }
  return html`
    ${error && html`<p class="field__error center" role="alert">${error}</p>`}
    ${error && !shop && html`<${Button} block variant="cream" onClick=${() => setTries(tries + 1)}>Prøv igjen</${Button}>`}
    <label class="consent">
      <input type="checkbox" checked=${agreed} onChange=${(e) => setAgreed(e.currentTarget.checked)} />
      <span class="consent__box" aria-hidden="true"></span>
      <span>Jeg godtar <a href=${pay.termsUrl} target="_blank" rel="noopener">vilkårene</a>, ber om at tilgangen leveres med en gang, og forstår at jeg da mister angreretten.</span>
    </label>
    <${Button} block disabled=${!agreed || !shop} onClick=${go}>Gå til betaling</${Button}>`;
}
