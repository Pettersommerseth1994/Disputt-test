# Designsystem

Disputt ser ut som en tegning med fargestifter på burgunder papir: flate krittfarger med strek og korn oppå, blobbete former, hard «kritt-kant» i stedet for skygge, og øyne overalt.

**Se det levende:** kjør `npm start` og åpne `/design-system/`. Siden bruker de samme CSS-filene som spillet og leser fargene rett fra tokens.

## Filer

| Fil | Innhold |
| --- | --- |
| `public/css/tokens.css` | Fonter (`@font-face`), farger, typografiskala, rom, former, skygger, bevegelse. **Eneste sted med råverdier.** |
| `public/css/base.css` | Reset, side, overskrifter, skjermskall (`.screen`, `.dock`), animasjoner (`pop`, `rise`, `wobble`, `float`, `pulse`, …). |
| `public/css/components.css` | Knapper, kort, felt, stepper, segmentert valg, avatar, spillerrutenett, avatarvelger, chips, klokke, svaralternativer, fremdriftsstrek, poengtavle, sheet, toast, banner, logo-klistremerke, rollestripe, konfetti. |
| `public/css/screens.css` | Layout og stemning per skjerm. |
| `public/css/legal.css` | Leselayout for `vilkar.html` og `personvern.html`: en smal kolonne i spillets farger, med selgerkortet øverst. |
| `public/js/hold.js` | `useHold()`: trykk og hold, slik hemmeligheter skjules (rollen vises bare mens en finger holder knappen). |
| `public/js/ui.js` | JS-komponentene (`Avatar`, `Button`, `Timer`, `Sheet`, `Scoreboard`, `QR`, `RoleStrip`, …) som bruker klassene over. |
| `public/js/screens/pay.js`, `screens/shoppay.js`, `public/js/pay/` | Pakkene, «Logg inn», «Takk!», «Min tilgang» og logikken bak (tilgang, kode, kall til betalingsserveren; `shop.js` for Shopify). Av som standard, se [SHOPIFY.md](SHOPIFY.md) og [BETALING.md](BETALING.md). |
| `public/design-system/` | Stilguide-siden. |
| `shared/avatars.mjs` | Avatar-rosteret (id, navn, aksentfarge). |
| `public/config.js`, `public/js/paths.js` | Distribusjonsinnstillinger og stedsuavhengige stier (alle URL-er er relative, så siden virker både på `/` og under `/Disputt/`). |

## Tokens i korte trekk

**Farger:** burgunder (`--burgundy-950…500`, siden er `700`), kritt (`--yellow --lime --orange --coral --pink --violet --blue --blue-light --teal`), papir/blekk (`--cream --ink`) og rollefargene `--red` (imposter) og `--blue` (lojal), som bare brukes som fargen på *ordet* på rollekortet og aldri fyller en hel skjerm. Kritt-fargene er trukket ut av referansetegningene.

**Aldri ren hvit eller svart.** «Hvitt» er en smørkrem (`--cream`, `#f8e6b8`) og «svart» en mørk sjokoladebrun (`--ink`, `#3a2012`): all tekst, logoen, papirkort, kremknapper og QR-koden (brune moduler på kremfarget bunn) bruker dem. Gjennomsiktige varianter lages av kanalene (`rgb(var(--cream-rgb) / .5)`, `--ink-rgb`, og `--shadow-rgb` for de harde kritt-skyggene), så paletten står ett sted. Rollefargene som tekst på kremfarget kort skal holde minst 4,5:1 i kontrast, og det er derfor `--red` og `--blue` er så dype som de er. Stilguiden (`/design-system/`) viser kontrasten for alle fargene.

**Typografi:** ingen tekst står i STORE BOKSTAVER, heller ikke etiketter over felt (`.eyebrow`) eller rolleordet: `text-transform: uppercase` brukes ikke, bortsett fra i feltet der man skriver spillkoden, siden en kode skrives med store bokstaver. `--font-display` (Fraunces, tung kursiv, *soft + wonky*) til overskrifter, knapper, tall og navn på store flater; `--font-text` (Lora) til alt annet. Skala: `--fs-hero --fs-h1 --fs-h2 --fs-h3 --fs-lead --fs-body --fs-small --fs-micro`.

**Rom:** 4 px-rutenett (`--s-1…7`), `--page-x/top/bottom` tar hensyn til hakk og hjemmelinje (`env(safe-area-inset-*)`).

**Former:** `--r-btn --r-card --r-input --r-blob --r-sheet --r-pill`. Alle har ulike radier per hjørne, slik at ingenting er et perfekt rektangel.

**Dybde:** `--shadow-1/2/3` er harde forskyvninger (`0 6px 0 …`), aldri uklare.

**Bevegelse:** `--ease-bounce`, `--ease-out`, `--dur-1/2/3`. `prefers-reduced-motion` slår alt av.

## Kritt-oppskriften

En flate = en flat farge + korn + strek:

```css
.min-flate {
  background: var(--tex-grain), var(--tex-light), var(--yellow); /* øverst = nærmest deg */
  border-radius: var(--r-card);
  box-shadow: var(--shadow-2);
}
```

`--tex-grain`, `--tex-light` og `--tex-dark` er sømløse, gjennomsiktige PNG-fliser (`public/assets/textures/`, laget av `npm run art`). Samme flis gir kritt-look på alle farger.

## Legge til en komponent

1. Bruk kun tokens, ingen hardkodede farger, størrelser eller radier.
2. Gi den en blobbete radius, en kritt-kant (`--shadow-*`) og, hvis den er en flate, tekstur-lagene.
3. Gi den en `:active`-tilstand (synk ned i kanten) og en tydelig `:focus-visible`.
4. Legg et levende eksempel i `public/design-system/index.html`.

## Avatarer og illustrasjoner

- 10 avatarer i `public/assets/avatars/<id>.svg` (`viewBox 0 0 400 400`, gjennomsiktig bakgrunn). Rosteret styres av `shared/avatars.mjs`; legg du til en avatar, legg til både filen og linjen der (serveren validerer mot rosteret og håndhever at hver avatar bare kan velges av én).
- Rolleskjerm-øyne, krone, dekor og teksturer ligger i `public/assets/art` og `public/assets/textures`.
- Alt genereres deterministisk med `npm run art` (kilde i `tools/art`). Vil du bruke håndtegnede illustrasjoner, overskriv SVG-ene med samme filnavn.

## Roller skal ikke synes for andre

En telefon som er rød eller blå, eller som viser et stort «Imposter», røper rollen til alle i rommet. Derfor:

- **Rolleskjermen (8 s) viser ingenting om rollen før en finger holder knappen.** Resten av tiden er den en tom, stiplet plass for kortet, helt lik for lojale og imposter. Kortet (øye, rollens navn i `--red`/`--blue`, riktig svar eller «?») er like stort for begge roller, og forsvinner når fingeren løftes (`public/js/hold.js`). Plassen tar resten av høyden i skjermen, så et høyere kort aldri skyver knappen bort fra under fingeren.
- **Stripen under runden** (`RoleStrip`) er lik for alle («Din rolle · Hold for å se») og viser rollen, og for imposteren svaret, bare mens den holdes. **Det som kommer fram står til venstre for knappen, aldri i den eller under den**, for der dekker fingeren det: knappen endrer ikke tekst og flytter seg ikke når teksten ved siden av vokser. Det samme gjelder rollekortet, som står over knappen. `npm run qa:overlap` sjekker det (regel 6, med selvtest).
- **To imposterer (fra seks spillere):** kortet har en tredje del, «Imposterne». Imposterne ser «Du og Kari» med Karis avatar, de lojale et «?» med «Finn dem sammen», så kortene er like store for begge roller. Stripen får en ekstra linje mens den holdes («Sammen med Kari» / «To av dere er imposterer»). Rundens antall imposterer er ingen hemmelighet og står i `view.turn.impostors`; hvem de er står bare i imposterens egen visning (`you.mates`).
- **Alt annet som ellers kunne røpet rollen er likt:** vibrasjonen ved rolleskjermen, tipset under klokka, og nettleserfargen (`theme-color`). Hele siden skifter aldri farge: det finnes ingen sidetemaer.
- QA kan vise alt som «holdt» uten finger: `setStore({ qaHold: true })` (se `useHold`).

## Mobilen er et støtteverktøy: avsløringen sies høyt

Spillet er til for at folk skal se på, snakke med og diskutere med hverandre, ikke på telefonen. Telefonen leser opp spørsmålet, trekker imposterne og holder styr på poengene. **Nye skjermer skal kreve så få trykk og blikk som mulig.**

- **Fasit, utfall og hvem imposteren er står aldri på en skjerm før imposteren har sagt det høyt.** Etter at svaret er låst telles det ned på alle telefoner («Svaret er låst · 5 · Dere låste B: Japan. Se på hverandre!»), og så viser alle samme skjerm, «Imposteren avslører seg!» (`.stage`: leppene, rollestripen og én linje tekst). Bare den som hadde spørsmålet har en knapp, «Det er sagt – vis poengene». Imposteren kan slå opp svaret i rollestripen (hold) hvis hen har glemt det. Teksten sier ikke at imposteren «må reise seg», for det er opp til dem.
- **Poengene** (`Summary`) er en poengtavle med +1 og én linje om hvordan runden gikk, uten kort som navngir imposteren. Under står en liten tekstknapp, «Uenige? Se fasit», som åpner et ark (`FasitSheet`, `public/js/screens/fasit.js`) med riktig svar, hva dere låste og hvem imposteren var, til når gruppa er uenig om det som ble sagt. Telefonen regner ut poengene selv, så en imposter som lyver høyt får det ikke til å stå på poengtavlen.
- Telefonen kan ikke få en iPhone til å vibrere, så nedtellingen må stå på skjermen.

## Vertens oppsett i tre steg

Verten går gjennom tre steg, ett valg per skjerm: 1 «Hvem er du?» (`Profile` med `wizard`, knappen heter «Neste»), 2 «Hvor lenge skal dere spille?» (`PointsStep`) og 3 «Få med vennene dine» (`Lobby`, der spillet venter på spillerne). Komponentene ligger i `public/js/screens/setup.js`.

- `Steps` viser tre striper, «‹ Tilbake» til venstre (fra steg 2) og «Steg 2 av 3» til høyre. `store.step` husker hvor verten er (1–3). `hostStep` gir steg 1 til en vert uten profil og steg 3 etter en omlasting.
- Invitasjonen har en liten QR-kode (trykk for å forstørre, det eksisterende arket «Bli med»), koden og «Del lenke», og under dem poengmålet med «Endre». **Hvem som er med vises i bunnfeltet** som en rad med overlappende ansikter (`.facepile`) og en kort tekst over Start-knappen, siden spillerlisten ellers havner under bunnfeltet på en 664 px høy skjerm. Listen med navn og fjerning ligger lenger ned.
- Ett poeng tar ca. 6 minutter (`MINUTES_PER_POINT` i `setup.js`). Tallet står også i spillereglene, vertsvalget, README og stilguiden.

## Pakker og betaling

Betaling er av som standard ([SHOPIFY.md](SHOPIFY.md), [BETALING.md](BETALING.md)). Når den er på, kommer tre ting til: pakkene, «Logg inn» og «Takk!». Med Shopify har pakkeskjermen én knapp og en avkrysning for samtykket (som må settes før knappen virker), og bunnlinjen sier «Venter på betalingen …» mens verten betaler i den andre fanen (`public/js/screens/shoppay.js`). Skjermene ligger i `public/js/screens/pay.js`, og tallene og teksten om pakkene i `public/js/pay/plans.js`.

- **Pakkekort** (`.plans`, `.plan`) er radiokort, som svaralternativene: det valgte kortet blir gult, prisen står alltid til høyre, og merkelappen («Mest populær», «Best verdi») sitter på kortets øvre kant, så teksten inni holder seg på to korte linjer. Et kort er en `label` rundt en usynlig radioknapp, så tastatur og skjermleser virker.
- **Pakkeskjermen** (`Paywall`) har tittel, tre kort, en linje om den valgte pakken, «Dette får du» og et bunnfelt med én knapp per betalingsmåte (den første er den store). Kortene og knappene skal vises uten å rulle på 390×664 og 375×553: under 650 px høyde forsvinner setningen under tittelen og luften mellom kortene krymper. `npm run qa:fit` sjekker det (`pay-gate`).
- **Koden** (`.passcode`, `.input--passcode`) står i visningsfonten, i store bokstaver. Innskrivingen setter inn bindestreker mens man skriver, og små bokstaver og O/I/L godtas.
- **«Takk!»** (`ThanksSheet`) viser tilgangen, koden og én knapp som starter runden verten ba om («Start runde 3»). Mens gjestene er på vei tilbake står det «Venter på at … kommer tilbake …».
- **Gjestene** får bannerteksten «Verten betaler – spillet fortsetter straks» i stedet for «Mistet forbindelsen» mens verten er hos Stripe.
- **Forsiden** sier «Allerede kunde? Logg inn» der «Slik spiller du» stod, og «Du har tilgang · Min tilgang» på en telefon som har tilgang.
- Alle betalingsskjermene ligger i `tools/qa/payfixtures.mjs` og er med i `qa:overlap`, `qa:fit` og `shots`.

## Små skjermer

En nettleser sine verktøylinjer tar 150–300 px, så en telefon viser ofte bare ca. 550–660 px høyde, ikke de 844 px skjermen har. Skjermene man skal se på et øyeblikk (startsiden, rolle, nedtelling, fasit, diskusjon) må derfor få plass uten scrolling, og knappen nederst skal ikke dekke tekst. Illustrasjonene skalerer med synlig høyde (`dvh`, og `height: auto` slik at `<img height>` ikke holder av tom plass), og `screens.css` strammer inn avstander på lave skjermer (under 580 px høyde blir slagordet på startsiden, som har tre linjer, litt mindre). `npm run qa:fit` måler det på flere størrelser, også med lengste spørsmål og svar i banken.

## Aldri tekst oppå andre ting, aldri tekst som blir skåret av

`npm run qa:overlap` går gjennom alle skjermer (alle spillvisninger, startsiden, «jeg har en kode», tilkobling, plassvelger, «åpnet et annet sted» og alle ark) på flere telefonstørrelser. Den kjører også med det verste spillet tillater: ti spillere, de bredeste 14-bokstavsnavnene (`WWWWWWWWWWWWWW`), lengste spørsmål og svar, to-sifrede poeng, og med 125 % større tekst. Reglene:

- ingen synlig tekst ligger oppå annen synlig tekst, uansett hvor siden er rullet til
- ingen tekst går ut over kanten av skjermen (appen klipper sidelengs overflyt, så den ville bare blitt skåret av)
- ingen tekst skjules av sin egen boks (et langt navn som kuttes)
- bunnlinjene følger reglene under

`npm run qa:overlap -- --self-test` ødelegger layouten med vilje på tre måter og sjekker at målingen slår ut: en måling som aldri klager beviser ingenting.

**Navn er den ene tingen i en setning som ikke kan brytes ved et mellomrom.** Derfor har overskrifter og avsnitt `overflow-wrap: anywhere` (et langt navn brytes heller enn å gå ut av skjermen), poengtavlens midtkolonne er `minmax(0, 1fr)` slik at et langt navn brytes i stedet for å skyve poengene ut, og lister med en knapp ved siden av navnet (som «Fjern» i vertens ark) lar navnet gi etter mens knappen ikke gjør det.

### Bunnlinjer

To regler (måles av samme verktøy):

1. **Det som er frosset til bunnen av skjermen (`.dock`, `position: sticky`) er skjermens hovedhandling, en knapp**, og har en *ugjennomsiktig* bakgrunn. Ingenting som ruller under skal skinne gjennom tekst eller knapp. (Bakgrunnen er sist i `background`-listen som en vanlig farge. Den gikk en gang tapt på alle vanlige skjermer fordi `--page-bg` pekte på `--theme-bg` uten reserveverdi, og en tom `data-theme` fikk hele deklarasjonen til å bli ugyldig. Derfor har variabelen nå en reserveverdi.) Kanten oppover er en egen fade (`.dock::before`) som ligger over bunnlinjen og ikke er en maske over innholdet. Den har bunnlinjens eget korn og kritt og tones ut med en maske (`--fade-mask`, 2 rem): en flat fargegradient så ut som en glatt stripe med en skjøt mot den teksturerte siden. `test/css.test.js` vokter dette.
2. **Tekst og lenker som ikke trenger å være frosset (venter på verten, «Slik spiller du») er ikke frosset.** De ligger som `.foot` på slutten av siden, nederst på skjermen når innholdet er kort.

Valg som gjelder deg selv (endre navn eller avatar, vis QR-koden, forlat spillet) ligger bak tannhjulet øverst til høyre i lobbyen (`SettingsSheet`), ikke som løse lenker under spillerlisten.

## Logo

`public/assets/logo/`: `disputt-logo.svg` (mørk brun, hovedlogo), `-cream` (for mørke flater), `-eye` (alternativ med øye i i-prikken). Tegnet opp som konturer av Fraunces med `npm run logo` (fargene står øverst i `tools/logo/build.mjs` og må følge `--ink` og `--cream`). På burgunder brukes den mørke logoen alltid i et gult klistremerke (`.logo-sticker`).

**Ikoner:** faviconen (fanen i nettleseren, `public/favicon.svg` og `assets/icons/favicon-32.png`) er limen fra startsiden i gult i stedet for grønt, laget av tegningen `assets/avatars/lime.svg` med `node tools/logo/favicon.mjs` (grønntonene flyttes mot gult, resten beholdes). Hjemskjermikonene (`assets/icons/apple-touch-icon.png`, `icon-*.png`) er den svarte «D»-en på gult, laget med `node tools/logo/icons.mjs`. Nettlesere husker ikon-filer lenge, så adressen til faviconen har `?v=…` bakpå: øk tallet i `index.html` når ikonet byttes.
