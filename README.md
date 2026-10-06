# Disputt

> **Diskuter, manipuler og vinn.**

Disputt er et sosialt bløff- og diskusjonsspill for **3–10 spillere**. Alle spiller på sin egen telefon, samlet i samme rom. Én av dere er imposter (to hvis dere er seks eller flere) og vet svaret på spørsmålet. De andre må finne ut hva som er riktig, uten å bli lurt.

Spillet er *mobile first*, uten kontoer og uten app: verten åpner nettsiden, de andre skanner en QR-kode (eller får lenken sendt med «Del lenke»).

**Spill nå: https://disputt.site/**

### Test med venner (fra hvilket som helst nett)

1. **Verten** åpner lenken over, trykker *Opprett spill* og går gjennom tre steg: navn og avatar, hvor mange poeng man spiller til, og så invitasjonen. De andre trykker *Bli med i spill* og skriver koden (eller skanner QR-koden).
2. De andre **skanner QR-koden** på vertens skjerm, eller verten trykker *Del lenke* og sender den i en chat. Man kan også gå til siden og skrive den firebokstavers koden.
3. Verten trykker *Start Disputt* når alle er med (minst tre).

Gode råd, fordi siden kjører uten spillserver (se [docs/P2P.md](docs/P2P.md)): **verten er serveren.** Vær vert fra en telefon på Wi-Fi (eller en laptop), og hold siden åpen med skjermen våken. Får en gjest ikke kontakt etter ca. 30 sekunder, står det et råd på skjermen: bytt mellom Wi-Fi og mobildata. Noen mobilnett og bedriftsnett slipper ikke telefoner i direkte kontakt (det finnes ingen TURN-server ennå, se veikartet).

## Slik spilles det

1. **Verten** åpner Disputt og starter et spill. Hen får en QR-kode som de andre skanner.
2. Alle skriver inn **navn** og velger en av ti **avatarer**. Verten gjør det først, velger så hvor mange **poeng** man spiller til (ett poeng tar ca. 6 min, vi anbefaler minst 5) og kommer til invitasjonen: en QR-kode (trykk for å forstørre), koden og «Del lenke», mens spillerne kommer inn. Så trykker verten **Start Disputt**.
3. **Roller:** én tilfeldig spiller blir **imposter** (får se riktig svar, f.eks. «C: Frankrike»), og er dere **seks eller flere, blir to imposterer**, som får vite hvem den andre er. Alle andre er **lojale**. Rollen vises bare mens du holder en finger på knappen («Hold for å se rollen din») og er borte igjen når du slipper, så ingen kan se den over skulderen din. Resten av tiden er skjermen lik på alles telefon. Rolleskjermen varer i 8 sekunder.
4. En tilfeldig spiller (kan også være imposteren) får **spørsmålet** med fire alternativer og leser det høyt. Klokka starter med en gang; hen kan sette den til **2, 6 eller 10 minutter** og legge til tid underveis.
5. Alle **diskuterer**. Imposteren (eller imposterne) prøver å lure de andre til å svare feil. Hvordan man blir enige er opp til gruppa.
6. Spilleren med spørsmålet **krysser av** svaret dere ble enige om og låser det. Så telles det ned **5-4-3-2-1** på alle telefoner, og alle ser hva dere låste.
7. **Imposteren avslører seg.** Telefonene viser ingenting om fasit eller hvem imposteren er. Imposteren (eller imposterne, sammen) sier riktig svar høyt, og dere ser selv om dere hadde rett. Så trykker spilleren med spørsmålet «Det er sagt – vis poengene».
8. **Riktig svar:** alle lojale får 1 poeng. **Feil svar:** bare imposteren får 1 poeng (er det to, får begge 1 poeng hver). Poengskjermen har en liten knapp, «Se fasit», for når dere er uenige om hva som ble sagt. Så en ny runde med nye roller, ny spiller og nytt spørsmål.
9. Først til målet vinner. Poengtavlen kan åpnes når som helst. Verten har et tannhjul ved siden av «Poeng» med vertsvalg: justere poengmålet, hoppe over runden, fjerne frakoblede spillere og avslutte spillet.

### Valg som er tatt (og kan endres)

- **Uavgjort på toppen:** vinneren krones først når noen har nådd målet *og* leder alene. Står flere likt, spiller man videre til én drar fra. Verten kan også avslutte spillet og kåre den som leder.
- **Imposter og spørsmålsstiller er rent tilfeldige** (kryptografisk tilfeldig), uavhengig av hverandre. Samme spiller kan være begge deler, og samme person kan bli imposter flere ganger på rad.
- **To imposterer fra seks spillere.** Antallet regnes ved starten av hver runde, blant spillerne som er med i runden (en telefon som er borte teller ikke). Fra seks er det to ulike imposterer, som begge får vite riktig svar og hvem den andre er; på rolleskjermen står det «Du og Kari», mens lojale ser et «?» på samme sted, så kortene er like store. Poengene gis til alle på vinnersiden: riktig svar gir de lojale 1 poeng hver, feil svar gir begge imposterne 1 poeng hver. Faller én imposter ut midt i en runde (verten fjerner en frakoblet spiller), fortsetter runden med den som er igjen; er ingen igjen, hoppes runden over. Verten ser «to imposterer» i lobbyen når det blir seks tilkoblede.
- **Mobilen er et støtteverktøy, og avsløringen skjer med stemmen.** Telefonen leser opp spørsmålene, trekker imposterne og holder styr på poengene; resten skal dere gjøre sammen, uten å se på skjermen. Derfor står verken fasit, utfall eller hvem imposteren er på noen skjerm før imposteren har sagt det høyt. Alle telefoner viser det samme under nedtellingen og avsløringen.
- **Poengene telles først når spilleren som svarte trykker «Det er sagt – vis poengene»**, så poengtavlen ikke røper utfallet før imposteren har sagt det.
- **Rollen (og imposterens riktige svar) kan sees igjen** under runden ved å holde inne knappen i stripen øverst («Hold for å se»). Det som kommer fram står ved siden av knappen, så fingeren ikke dekker det. Slipper man, skjules det. Stripen, tipset under klokka og vibrasjonen er like for begge roller, så ingenting på skjermen røper hvem som er imposter.
- **Logoen i lobbyen er en knapp** som tar deg tilbake til hjemskjermen, etter en bekreftelse. En gjest forlater spillet (og kan bli med igjen med koden så lenge spillet ikke har startet). Verten av et spill på GitHub Pages avslutter spillet for alle, fordi vertens side *er* spillet.
- **Mistet forbindelsen?** Telefoner som sovner eller laster siden på nytt kommer rett tilbake til samme sted. Har en spiller mistet nettleseren helt, kan hen velge seg selv fra «Spillet har startet»-skjermen. Faller verten ut, overtar en annen spiller vertsrollen (etter 3 minutter under spillet, 10 minutter i lobbyen). Verten kan hoppe over en runde som står fast, eller fjerne en frakoblet spiller.
- **Bare de som er med i runden kan score på den.** Er en spiller borte når runden starter, får hen verken rolle eller poeng for den runden, så ingen kan «vinne» ved å være fraværende.
- **Skjermlås:** på vanlig `http` (f.eks. lokalt Wi‑Fi) kan ikke nettsiden holde skjermen våken. Appen kobler seg til igjen av seg selv når telefonen våkner, men det er smidigere om dere setter skjermlåsen til «Aldri» mens dere spiller. Over `https` (Render, tunnel) holdes skjermen våken automatisk.

## Kom i gang

Det finnes tre måter å kjøre Disputt på. Spillet og skjermene er helt like i alle tre.

**1. På nettet, uten installasjon: GitHub Pages (peer-to-peer).** Åpne lenken over. Siden ligger på GitHub Pages, som bare kan vise filer, så *vertens telefon kjører selve spillet* og de andre kobler seg rett til den (WebRTC). Verten må holde siden åpen mens dere spiller. Fungerer fra alle nett, men noen strenge nett (bedrift, enkelte mobiloperatører) kan blokkere direkte tilkobling. Detaljer, begrensninger og innstillinger: **[docs/P2P.md](docs/P2P.md)**.

**2. Kjør selv på egen maskin (Node + WebSocket).** Du trenger [Node.js](https://nodejs.org) 22 eller nyere.

```bash
npm install
npm start
```

Terminalen skriver ut to adresser. Åpne **adressen merket «På mobilen (Wi‑Fi)»** på telefonen til verten (ikke `localhost`), så peker QR-koden riktig for de andre. Alle må være på samme Wi‑Fi. Macen kan spørre om `node` skal få ta imot innkommende tilkoblinger, svar «Tillat».

**3. Egen server på nett (Render, Fly, Docker).** Mest robust: en server som alltid står, og ingen avhengighet til vertens telefon. Se **[docs/DEPLOY.md](docs/DEPLOY.md)**. GitHub Pages kan også settes til å bruke en slik server.

## Betaling (av som standard)

Spillet er gratis. Koden kan også ta betalt, men det er **slått av** helt til to variabler settes på GitHub: tre pakker bare verten kjøper (**En kveld** 149 kr, **For ett år** 399 kr, **Livstid** 499 kr), en betalingsmur etter to gratis runder, betaling med **Vipps, Apple Pay eller kort** i en Shopify-butikk som åpner seg i en ny fane (eller hos Stripe), ingen innlogging (en kode fra e-posten gir tilgangen tilbake på en ny telefon). Betalingsserveren er én Cloudflare Worker: [`payments/worker-shopify.js`](payments/worker-shopify.js) (med en liten D1-database) for Shopify, og [`payments/worker.js`](payments/worker.js), som ikke lagrer noe, for Stripe. **Oppsettet, steg for steg: [docs/SHOPIFY.md](docs/SHOPIFY.md)** (Stripe: [docs/BETALING.md](docs/BETALING.md)). En test-kopi kan også kjøre en demo av betalingen uten Stripe (`DISPUTT_PAYMENTS_DEMO`, docs/BETALING.md del 9.3).

## Designsystem

Utseendet er surrealistisk og lekent: fargestift/oljepastell på dyp burgunder, med funky overskrifter (Fraunces) og en vanlig serif til brødtekst (Lora).

- **Levende stilguide:** start serveren og åpne [`/design-system/`](http://localhost:3000/design-system/). Farger, typografi, avatarer, komponenter og skjermer, bygget med de samme CSS-filene som spillet.
- **Dokumentasjon:** [docs/DESIGN-SYSTEM.md](docs/DESIGN-SYSTEM.md).
- **Kode:** `public/css/tokens.css` (farger, typografi, rom, former, bevegelse), `components.css` (knapper, felt, avatarer, klokke, svaralternativer …), `screens.css` (skjermene), `legal.css` (vilkårs- og personvernsiden).
- **Illustrasjoner:** de ti avatarene, rolleskjerm-øyne, teksturer og dekor genereres av `tools/art` (`npm run art`). De kan byttes ut 1:1 med håndtegnede SVG-er (samme filnavn, `viewBox 0 0 400 400`).
- **Logo:** `public/assets/logo/` (mørk brun, krem og «øye i i-prikken»), generert fra fonten med `npm run logo`.

## Spørsmål

Spørsmålene ligger i [`shared/questions.js`](shared/questions.js): tekst, fire alternativer og indeksen til riktig svar. Spillet blander kortstokken og viser alle spørsmål før noe gjentas, og aldri samme spørsmål to ganger på rad. Banken har **88 spørsmål**: de fire første testspørsmålene, 12 fra et sett trykte spørsmålskort og resten om norsk og internasjonal allmennkunnskap, helst ting man egentlig vet men har glemt, så gruppa må diskutere seg frem (og imposteren har noe å spille på). Sjekk fakta mot en kilde, og la riktig svar stå på ulike plasser; `test/questions.test.js` passer på formen. Vær ekstra nøye med svar som kan bli utdatert (salgstall, rekorder): formuler dem så de holder, slik som «Hvilket *av disse* selger Vinmonopolet mest av i liter?».

## Struktur

```
server/    Node-serveren (HTTP + WebSocket): index.js og static.js.
shared/    Spillmotoren (game.js = ren tilstandsmaskin, hub.js, questions.js, util.js) og avatar-rosteret.
           Kjører både i Node-serveren og, i peer-to-peer-modus, i vertens nettleser.
public/    Klienten: Preact + htm uten byggesteg (css/, js/, js/p2p/, assets/, design-system/).
payments/  Betalingsserveren (én Cloudflare Worker, for Shopify eller for Stripe). Av som standard, se docs/SHOPIFY.md og docs/BETALING.md.
shopify/   Det som limes inn i Shopify: forsiden i butikken og boksen i ordrebekreftelsen (Liquid).
tools/     Generatorer (art, logo, fonter), byggeverktøy for GitHub Pages (pages/) og QA-verktøy (qa/).
test/      Enhets-, server-, QR-, bygge- og ende-til-ende-tester.
docs/      Protokoll, drift, peer-to-peer, betaling, designsystem.
```

Spillrommene ligger i minnet (ingen database, ingen kontoer). Motoren eier all spillogikk og sender hver spiller *kun det hen skal se*: ingen hemmeligheter (imposterens svar, spørsmålet, fasiten) ligger i andres data. Protokollen er beskrevet i [docs/PROTOCOL.md](docs/PROTOCOL.md).

## Tester og kvalitetssikring

```bash
npm test               # motor, lagring/gjenoppretting, WebSocket-ende-til-ende, QR-koden dekodes, statiske ruter, bygget for Pages, betalingsserveren og sidens betalingsflyt
npm run play           # UI-test: flere "telefoner" i ekte nettleser spiller et helt spill (krever Google Chrome)
npm run play -- 6 3    # …med 6 spillere, til 3 poeng
npm run play:p2p -- 4 2  # det samme over WebRTC (peer-to-peer-bygget + lokal megler, uten internett)
npm run play:live      # det samme mot den publiserte siden på GitHub Pages (ekte megler, ekte tidtakere, ca. 1,5 min)
npm run qa:stuck       # en gjest som ikke får linje til verten får et råd på skjermen (ca. 40 s)
npm run qa:signalling  # kontakten med meglertjenesten faller ut (også midt i et spill), verten våkner, plassvelgeren mister linjen: alt kommer seg
npm run qa:hostile     # tilkoblinger av feil type, tilkoblinger som tier, og en full vert: ekte spillere kommer likevel inn (ca. 30 s)
npm run play:subpath   # hele spillet mot den bygde siden under /Disputt/, som på GitHub Pages
npm run play:pay       # med betaling: pakkene etter runde 2, avbrutt og gjennomført betaling hos en falsk Stripe, runde 3, kjøp fra forsiden og innlogging på en ny telefon
npm run play:pay-slow  # det samme, men verten er borte i 75 s mens han betaler: gjestene må vente på ham
npm run play:pay-demo  # det samme mot demoen av betalingen (en test-kopi uten Stripe, docs/BETALING.md del 9.3)
npm run play:pay-shopify  # med betaling i en falsk Shopify-butikk som åpner seg i en ny fane: lukket og åpnet igjen, avbrutt, sent varsel, gjennomført, kjøp fra forsiden og innlogging på en ny telefon
npm run play:pay-shopify-slow  # det samme, men verten er borte i 75 s
npm run qa:shop-live -- --url=https://pettersommerseth1994.github.io/Disputt-test  # en utlagt kopi mot den ekte butikken, til og med kassen og ikke et skritt lenger: ingenting kjøpes
npm run shots          # skjermbilde av hver skjerm i mobilstørrelse -> tmp/shots/ (VIEWPORT=390x664 for en nettleser med verktøylinjer)
npm run qa:fit         # får skjermene plass uten scrolling på de synlige skjermstørrelsene (390×664, 375×553 …)?
npm run qa:toast       # toastene («Koden er kopiert») står hele øverst på skjermen, midt på bredden, glir ned ovenfra og slipper gjennom trykk, på alle skjermstørrelser (med egen selvtest)
npm run qa:overlap     # alle skjermer, også med ti spillere, de bredeste navnene og 125 % større tekst: ingen tekst oppå annen tekst eller skåret av, bunnlinjer ugjennomsiktige, bare linjer med en knapp frosset
npm run pages:preview  # bygg og vis GitHub Pages-versjonen lokalt (http://localhost:8080)
```

## Personvern

Ingen kontoer, ingen cookies, ingen sporing. Navn og avatar finnes bare i spillets minne (serverens, eller vertens nettleser i peer-to-peer-modus) mens spillet pågår, og identiteten i nettleseren ligger i `sessionStorage` for den ene fanen. I peer-to-peer-modus kobler PeerJS' offentlige meglertjeneste telefonene sammen (den ser ikke spilltrafikken), og slik WebRTC fungerer kan spillerne teknisk se hverandres IP-adresser. Er betaling slått på, kommer ett tillegg: betalingen skjer hos Stripe (vi ser aldri kortnummeret), og tilgangen og koden ligger i nettleserens lokale lagring på vertens telefon. Betalingsserveren lagrer ingenting. Hva som behandles hvor står i [`public/personvern.html`](public/personvern.html), og vilkårene for kjøp i [`public/vilkar.html`](public/vilkar.html); selger og behandlingsansvarlig er Pesom Holding AS.

## Veikart

- En vanlig nettside (forside, regler, kontakt) på disputt.no.
- Flere spørsmål og kategorier, evt. kategorivalg per spill.
- Lyd og haptikk (kun den som svarer), «behold skjermen våken» også uten HTTPS.
- TURN-server for peer-to-peer (de få nettene som blokkerer direkte tilkobling), eller en alltid-på spillserver på Render.
- Håndtegnede avatarer og rolle-illustrasjoner i stedet for de prosedyretegnede.
