# Betaling med Shopify: slik setter du opp butikken og kobler den til Disputt

> Sist kontrollert mot dokumentasjonen til Shopify og Cloudflare: **6. oktober 2026**. Shopify og Cloudflare flytter på menyer og knapper av og til; menynavnene under står på engelsk, slik de heter i Shopify og Cloudflare når kontoen er på engelsk. Finner du ikke en knapp, søk etter navnet i admin. Dette er teknisk veiledning, ikke juridisk eller skattemessig rådgivning: det som handler om vilkår, angrerett, mva og personvern må du få sjekket av en som kan det.
>
> Bruker du Stripe i stedet, er veilederen [BETALING.md](BETALING.md). Koden for Stripe ligger urørt ved siden av; bare én av de to settes opp.

Innhold: [Kort fortalt](#kort-fortalt) · [1. Slik virker det](#1-slik-virker-det) · [2. Før du begynner](#2-før-du-begynner-virksomhet-skatt-og-jus) · [3. Butikk og domene](#3-shopify-butikk-og-domene) · [4. Betaling](#4-shopify-betaling) · [5. Produktene](#5-shopify-de-tre-produktene) · [6. Kassen og forsiden](#6-shopify-kassen-og-forsiden) · [7. E-posten](#7-shopify-e-postbekreftelsen) · [8. Nøkler](#8-nøkler) · [9. Betalingsserveren](#9-betalingsserveren-cloudflare-worker-og-database) · [10. Webhook](#10-webhook-shopify-sier-fra-når-noe-er-betalt) · [11. Appen på GitHub](#11-koble-til-appen-på-github) · [12. Test alt](#12-test-alt) · [13. Gå live](#13-gå-live) · [14. Drift](#14-drift) · [15. Koden](#15-slik-henger-koden-sammen) · [16. Begrensninger](#16-begrensninger-og-mulige-neste-steg) · [17. Kilder](#17-kilder)

## Kort fortalt

**Det som er laget (i koden):** tre pakker, en betalingsmur etter to gratis runder, betaling i en Shopify-butikk som åpner seg i en **ny fane** (Vipps, Apple Pay og kort), ingen innlogging, og en kode som gir tilgangen tilbake på en ny telefon. Spillet blir stående åpent i fanen bak, så rommet og vennene er der når verten kommer tilbake, og «Takk!» dukker opp av seg selv så snart betalingen er gjennomført. **Alt er av som standard.** Uten to variabler på GitHub vises ingenting om betaling, og spillet er gratis, helt som i dag.

| Pakke | Pris | Varighet |
| --- | --- | --- |
| **En kveld** | 149 kr | 12 timer fra betalingen |
| **For ett år** (mest populær) | 399 kr | 12 måneder fra betalingen |
| **Livstid** (best verdi) | 499 kr | én betaling, ingen utløpsdato |

Alle er engangsbetalinger. Ingenting fornyes av seg selv. Bare **verten** betaler; de andre spiller gratis på sine egne telefoner. Prisene står i Shopify; hvor lenge tilgangen varer står i koden ([del 15](#15-slik-henger-koden-sammen)).

**Det du må gjøre** (tidsbruk er et grovt anslag; ventetid hos andre kommer i tillegg):

| # | Hva | Hvor | Tid |
| --- | --- | --- | --- |
| 1 | Bekreft at Pesom Holding AS kan selge dette, og få vilkårene og e-postene lest av en som kan jus | regnskapsfører, jurist ([del 2](#2-før-du-begynner-virksomhet-skatt-og-jus)) | dager; start først, kan gå parallelt |
| 2 | Lag butikken og koble `shop.disputt.site` til ([del 3](#3-shopify-butikk-og-domene)) | Shopify, Domeneshop | 30 min |
| 3 | **Slå på Shopify Payments og søk om Vipps** ([del 4](#4-shopify-betaling)) | Shopify | 30 min; Vipps kan ta opptil ti virkedager. Søk med en gang. |
| 4 | Lag de tre produktene ([del 5](#5-shopify-de-tre-produktene)) | Shopify | 20 min |
| 5 | Kassen, retningslinjene og forsiden ([del 6](#6-shopify-kassen-og-forsiden)) og e-posten ([del 7](#7-shopify-e-postbekreftelsen)) | Shopify | 40 min |
| 6 | Lag signeringsnøkkelen ([del 8](#8-nøkler)) | Terminal | 10 min |
| 7 | Sett opp betalingsserveren og databasen ([del 9](#9-betalingsserveren-cloudflare-worker-og-database)) og webhooken ([del 10](#10-webhook-shopify-sier-fra-når-noe-er-betalt)) | Cloudflare, Shopify | 45 min |
| 8 | Koble til appen i en test-kopi og test ([del 11](#11-koble-til-appen-på-github) og [12](#12-test-alt)) | GitHub + telefoner | 2–3 timer |
| 9 | Gå live ([del 13](#13-gå-live)) | alle | 1–2 timer |

**Det jeg har antatt** (si fra hvis noe skal være annerledes):

- Alle pakker er **engangskjøp**, ikke abonnement. «For ett år» fornyes ikke av seg selv.
- Butikken er bare en **kasse**: ingen som handler i den, ingen produktsider som folk skal finne. Spillet sender verten rett til kassen med pakken i handlekurven (en vanlig Shopify-handlekurvlenke), så butikken trenger ingen tilpasset tema.
- Betalingsmuren er **myk**: spillmotoren kjører i vertens nettleser og koden er offentlig, så den som kan skrive kode kan fjerne den. Den stopper alle andre, men er ikke et kopibeskyttelsessystem ([del 16](#16-begrensninger-og-mulige-neste-steg)).
- «**Logg inn**» betyr å skrive inn koden du fikk da du betalte.
- Muren kommer når verten trykker «Neste runde» etter **runde to**.
- «En kveld» regnes som 12 timer fra betalingen.

## 1. Slik virker det

### Det verten opplever

1. De to første rundene i hvert spill er gratis.
2. Etter runde 2 trykker verten **Neste runde** og får **pakkene**. De andre spillerne ser det de alltid ser mellom runder: «Venter på at verten starter neste runde».
3. Verten velger pakke, **krysser av** for at tilgangen leveres med en gang (angrerett), og trykker **Gå til betaling**.
4. Butikken åpner seg i en **ny fane**, rett i kassen med pakken valgt. Verten velger Vipps, Apple Pay eller kort og betaler. Spillet står i fanen bak og sier «Venter på betalingen …».
5. Når Shopify har meldt at betalingen er gjennomført, viser spillet **«Takk!»** med tilgangen og en kode, og **lukker butikk-fanen** hvis den fortsatt er åpen. **Start runde 3** fortsetter spillet. Gjestene har vært tilkoblet hele tiden.
6. Har nettleseren lagt spillfanen i dvale mens verten betalte (en telefon gjør det), trykker verten **Fortsett å handle** på Shopifys takkeside. Forsiden i butikken har da en knapp som lukker fanen, og spillet viser «Takk!» så snart verten er tilbake i det. Verten får også en e-post med koden.
7. Neste kveld ligger tilgangen på telefonen. På en ny telefon: **Allerede kunde? Logg inn**, og skriv koden.

### Tre deler

```
 Verten (nettleseren)                Butikken (Shopify)                 Betalingsserveren
 (GitHub Pages)                      shop.disputt.site                  (Cloudflare Worker + D1)
 ────────────────────                ─────────────────                  ─────────────────────────
 «Neste runde» etter runde 2
 → pakkene, avkrysning
 «Gå til betaling»
 lager en kode, åpner en NY fane ──▶ kassen: pakken i handlekurven,
                                     koden og samtykket på ordren
 spillet blir åpent bak              kunden betaler (Vipps / Apple Pay / kort)
                                     ordren er betalt ── webhook (signert) ──▶ skriver ned kode, pakke, tid
 spør «er koden betalt?» ──────────────────────── POST /restore ────────▶
                ◀──────── { token, code }: en signert tilgang ────────────
 «Takk!» · «Start runde 3»
```

| Del | Gjør | Vet og lagrer |
| --- | --- | --- |
| **Telefonen** (appen på GitHub Pages) | viser pakkene, lager koden, åpner butikken, spør om koden er betalt, sjekker tilgangen | tilgangen og koden (`localStorage`), rommet og den pågående betalingen (`sessionStorage`) |
| **Butikken** (Shopify) | tar imot betalingen, sender e-post, holder ordrene, refunderer | ordren, e-posten kunden oppgir, pakken, koden og tidspunktet for samtykket (som merknader på ordren) |
| **Betalingsserveren** (Cloudflare Worker, `payments/worker-shopify.js`, med en D1-database) | tar imot varsler fra Shopify, svarer på «er koden betalt?», signerer tilgangen | bestillingsnummer, koden, pakken, tidspunktet og beløpet. **Ingen navn og ingen e-postadresser.** |

**Hvorfor en betalingsserver, når Shopify gjør jobben?** Det som mangler er budbringeren: Shopify kan ikke si til en side på GitHub Pages at «koden K7M2-9QXD-4TRB er betalt», og kassen kan ikke sende kunden tilbake til spillet. Betalingsserveren tar imot beskjeden fra Shopify (en webhook, signert så ingen andre kan late som), husker den, og gir spillet en signert tilgang når spillet spør. Uten den hadde kunden måttet skrive inn koden for hånd hver gang.

**Hvorfor en database (D1) og ikke bare Shopify?** Apper får bare se de siste 60 dagene av ordrene i en Shopify-butikk, med mindre Shopify godkjenner dem særskilt, og «Livstid» og «For ett år» må kunne hentes igjen etter mer enn 60 dager. Cloudflare D1 er en liten gratis database (SQLite) som er konsistent med en gang: en betaling som er skrevet ned er der i neste spørsmål. (Cloudflare KV kan bruke opptil et minutt på å vise en ny verdi andre steder, og da hadde «Takk!» latt vente på seg.)

**Tilgangen (passet)** er en signert tekst (JWT, ES256) som sier «dette er pakken `year`, betalt på tidspunkt T, gyldig til U». Betalingsserveren signerer den med en privat nøkkel som bare finnes i Cloudflare. Appen har den offentlige nøkkelen (den ligger åpent i `config.js`) og sjekker signaturen i nettleseren. **Hvor lenge tilgangen varer bestemmes i betalingsserveren, ikke i Shopify:** Shopify sier bare hva som er betalt og når, og serveren regner ut slutten (12 timer, ett år, ingen) fra Shopifys tidspunkt på ordren, ikke fra når varselet kommer.

**Koden** (for eksempel `K7M2-9QXD-4TRB`) er tolv tegn (60 bit) som **siden** lager når verten trykker «Gå til betaling». Den følger med i handlekurven (som en handlekurvattributt kalt `kode`), ligger på ordren, står i e-posten, og er det kunden skriver under «Logg inn». Den som kjenner koden og har betalt for den, kan få tilgangen på en ny telefon. Appen er snill med skrivemåten: små bokstaver, mellomrom og bindestreker spiller ingen rolle, og O, I og L regnes som 0, 1 og 1.

**Samtykket** til at tilgangen leveres med en gang (og at angreretten da faller bort) gis i spillet, i boksen over knappen, og tidspunktet følger med på ordren (attributten `samtykke`). **En ordre uten samtykket gir ingen tilgang**: da ender ikke angreretten ved leveringen, så betalingsserveren leverer ingenting før et menneske har sett på ordren ([del 14](#14-drift)). Shopifys vanlige kasse har ikke plass til en avkrysningsboks (det går bare på Plus), så boksen ligger i spillet, før verten forlater det.

## 2. Før du begynner: virksomhet, skatt og jus

Alt i [BETALING.md, del 2](BETALING.md#2-før-du-begynner-virksomhet-skatt-og-jus) gjelder også her: selskapet (Pesom Holding AS), bankkonto, mva (25 %, prisene i appen er «inkl. mva»), e-posten `kontakt@disputt.site`, og vilkårene og personvernerklæringen, som ligger i appen ([`public/vilkar.html`](../public/vilkar.html) og [`public/personvern.html`](../public/personvern.html)). Det som er annerledes med Shopify:

- [ ] **Vilkår og personvern er skrevet om til Shopify** (de nevner Shopify, Shopify Payments og Vipps MobilePay i stedet for Stripe, og at samtykket gis i spillet). Få dem lest av en som kan jus, sammen med spørsmålene i [vedlegget til BETALING.md](BETALING.md#vedlegg-valgene-i-vilkår-og-personvern) og disse:
  - er avkrysningen i spillet (og tidspunktet på ordren) nok som samtykke til at angreretten faller bort, når selve betalingen skjer i en annen fane;
  - er teksten i ordrebekreftelsen (boksen fra [del 7](#7-shopify-e-postbekreftelsen)) en bekreftelse på varig medium, slik loven krever;
  - må butikken, `shop.disputt.site`, ha et banner for informasjonskapsler (Shopify har innstillinger for det under *Settings → Customer privacy*), og hva skal stå i Shopifys egne retningslinjer ([del 6](#6-shopify-kassen-og-forsiden));
  - at Shopify (og betalingsleverandørene deres) er databehandlere, og at Cloudflare lagrer bestillingsnummer, kode, pakke, tid og beløp uten navn.
- [ ] **Merverdiavgift i Shopify.** Prisene skal være **inkl. mva**. Under *Settings → Taxes and duties* (Norge): slå på at prisene inkluderer mva, og at mva legges på digitale produkter (25 %). Spør regnskapsføreren om oppsettet og om hvordan Shopify-salget bokføres.
- [ ] **Selger.** Butikken, kvitteringene og retningslinjene skal si **Pesom Holding AS**, org.nr. 923 729 674 MVA, med adressen fra vilkårene (*Settings → Store details* og *Settings → Policies*).

## 3. Shopify: butikk og domene

Butikken er en egen butikk for Disputt, med egen månedspris. Planen *Basic* holder. (Shopify har hatt tilbud om en billig prøveperiode for nye butikker; se prisene på <https://www.shopify.com/no/pricing> før du velger.)

1. - [ ] Lag butikken, med navnet **Disputt**. Under *Settings → Store details*: selskapets navn og adresse (Pesom Holding AS), og butikkens valuta **NOK**. Under *Settings → Languages*: standardspråk **norsk bokmål**.
2. - [ ] **Koble til domenet** `shop.disputt.site` (uten `www.`; det samme grepet som `shop.efjordextreme.no`):
   1. I Shopify: *Settings → Domains → Connect existing*, skriv `shop.disputt.site`.
   2. Shopify viser hva du skal legge inn. Hos **Domeneshop** (DNS for `disputt.site`): legg til en post av typen **CNAME**, vertsnavn `shop`, data `shops.myshopify.com` (Domeneshop kan ville ha en prikk på slutten). Rør ikke de andre postene: de peker `disputt.site` til GitHub Pages og e-posten.
   3. Tilbake i Shopify: trykk **Verify connection**, og sett `shop.disputt.site` som **primærdomene**. Sertifikatet (https) lages av Shopify og kan ta en stund.
   4. **Du skal se** at `https://shop.disputt.site/` åpner butikken. Sertifikatet må være i orden før noen betaler.
3. - [ ] Under *Online Store → Preferences*: **ingen passordbeskyttelse**. En passordbeskyttet butikk avviser handlekurvlenkene fra spillet.

## 4. Shopify: betaling

*Settings → Payments.*

1. - [ ] **Shopify Payments** (kort og Apple Pay, utbetaling i NOK til norsk bankkonto). Trykk **Activate**, og fyll inn selskapet (Pesom Holding AS), den som signerer for det, og bankkontoen. Shopify kan be om dokumentasjon, og godkjenningen kan ta noen dager. Apple Pay og Google Pay slås på sammen med Shopify Payments (se *Wallets* under *Manage*). Under *Settings → Payments*, nederst, skal *Payment capture method* stå på **Automatically at checkout** (det er standard). Velger du uttrekk først når bestillingen leveres (fulfillment), kommer «Order payment» først da, og for et digitalt produkt kanskje aldri.
2. - [ ] **Vipps.** Shopify Payments har ikke Vipps. Vipps MobilePay har sitt eget tillegg: *Add payment methods* → søk «Vipps» → **Vipps/MobilePay Payments** (laget av Crude for Vipps MobilePay) → *Install*. Du trenger en avtale med Vipps MobilePay for selskapet (salgssted, bankkonto), og onboardingen kan ta opptil ti virkedager. **Søk med en gang**; Apple Pay og kort kan åpne uten. Velg automatisk uttrekk (capture) også der: webhooken «Order payment» kommer når pengene er trukket.
3. - [ ] Du kan teste med Shopify Payments' testmodus og testkort ([del 12](#12-test-alt)); den slås på da.

**Gebyrer.** Shopify Payments tar 2 % + 2 kr på kort på planen Basic. Vipps går som en tredjeparts betalingsmåte: **2 % ekstra** til Shopify på Basic, i tillegg til Vipps' eget gebyr. Hold det opp mot prisene i del 5: på 149 kr er 2 % litt under 3 kr. Planen har dessuten en fast månedspris. Se [Shopifys prisside](https://www.shopify.com/no/pricing) for tallene som gjelder når du leser dette.

## 5. Shopify: de tre produktene

*Products → Add product.* Lag tre produkter, ett for hver pakke. Navnene og prisene skal være akkurat disse, for kassen og e-postene viser dem:

| Tittel | Pris | Beskrivelse (lim inn) |
| --- | --- | --- |
| **Disputt – En kveld (12 timer)** | 149 kr | Tilgang til alle runder i Disputt i 12 timer fra du betaler, til én spillekveld. Én betaling, ingenting fornyes. Bare verten betaler: de andre spiller gratis på sine egne telefoner. Du får en kode på e-post som gir deg tilgangen tilbake på en annen telefon. |
| **Disputt – For ett år (12 måneder)** | 399 kr | Tilgang til alle runder i Disputt i 12 måneder fra du betaler, til faste spillekvelder. Én betaling, og tilgangen fornyes ikke av seg selv. Bare verten betaler: de andre spiller gratis på sine egne telefoner. Du får en kode på e-post som gir deg tilgangen tilbake på en annen telefon. |
| **Disputt – Livstid** | 499 kr | Tilgang til alle runder i Disputt så lenge Disputt tilbys (se vilkårene). Én betaling. Bare verten betaler: de andre spiller gratis på sine egne telefoner. Du får en kode på e-post som gir deg tilgangen tilbake på en annen telefon. |

For hvert produkt:

- [ ] **Pris** som i tabellen, og **Charge tax on this product** på (mva inkludert, del 2).
- [ ] **Inventory:** ta bort haken ved *Track quantity* (ubegrenset).
- [ ] **Shipping:** ta bort haken ved *This is a physical product*. Da blir det ingen frakt og ingen leveringsadresse i kassen.
- [ ] **Status:** *Active*, og tilgjengelig i salgskanalen **Online Store** (uten den kan ikke handlekurvlenken bruke produktet).
- [ ] Ingen varianter. Hvert produkt har én variant.

**Variant-ID-ene.** Betalingsserveren og spillet kjenner pakkene på variant-ID-en (et tall på 14 siffer). Når produktene er publisert, åpner du `https://shop.disputt.site/products.json`: der står hvert produkt med `"variants":[{"id":…`. Skriv ned de tre tallene. (Du kan også sende dem til meg.)

| Pakke | Variant-ID | Skal inn i Cloudflare som |
| --- | --- | --- |
| En kveld | | `VARIANT_EVENING` |
| For ett år | | `VARIANT_YEAR` |
| Livstid | | `VARIANT_LIFETIME` |

> Endrer du **prisen** i Shopify, endres den i kassen med en gang og trenger ikke noe i koden (men teksten på pakkeskjermen står i [`public/js/pay/plans.js`](../public/js/pay/plans.js): endre den også). Rabattkoder du lager i Shopify virker i kassen, og betalingsserveren spør ikke hva som ble betalt: en bestilling med rabatt gir tilgang. Gir du bort tilgang med en rabattkode på 100 %, så prøv det først, siden det er Shopify som bestemmer om en gratis bestilling sender varselet «Order payment». Oppretter du et **nytt** produkt eller en ny variant, får den en ny ID, og da må Cloudflare-variabelen byttes.

## 6. Shopify: kassen og forsiden

**Kassen** (*Settings → Checkout*): kunden skal bare behøve å oppgi e-post.

- [ ] Kontakt: **e-post** (ikke telefon). Navn, firmanavn, adresselinje 2 og telefon: ikke krevd eller skjult, slik at kassen blir så kort som mulig for et digitalt produkt.
- [ ] Kundekontoer: **av** (eller valgfritt). Spillet har ingen kontoer, og koden er innloggingen.
- [ ] Markedsføring: ingen forhåndsavkrysset boks for e-postlister.
- [ ] Utseende (*Customize → Branding*): logoen fra [`public/assets/`](../public/assets/), burgunder bakgrunn (`#6a1428`) og gul knapp (`#fae025`), så kassen ligner spillet.

**Retningslinjene** (*Settings → Policies*): Shopify viser dem som lenker nederst i kassen. Lim inn en kort tekst i hver og lenk til appens egne sider:

- [ ] *Refund policy* og *Terms of service*: «Vilkårene for kjøp av tilgang til Disputt, med angrerett og refusjon, står på https://disputt.site/vilkar.html. Selger: Pesom Holding AS, org.nr. 923 729 674 MVA. Kontakt: kontakt@disputt.site.»
- [ ] *Privacy policy*: «Personvernerklæringen står på https://disputt.site/personvern.html.»
- [ ] *Shipping policy* trengs ikke (digitalt produkt).

**Forsiden** (filen [`shopify/forside.liquid`](../shopify/forside.liquid)): den som havner på `shop.disputt.site` er nesten alltid en kunde som har betalt og trykket **Fortsett å handle** på Shopifys takkeside (den knappen går til butikkens forside, og takkesiden kan ikke endres med Liquid). Forsiden sier «Takk!». Kom verten fra spillet (spillet åpnet butikken i en ny fane), er det en knapp som **lukker fanen**, så spillet ligger der verten forlot det; lar fanen seg ikke lukke, står det at verten må bytte tilbake til fanen med spillet. Kom verten ikke fra spillet (nettleseren åpnet ikke en ny fane, så fanen er spillets egen), er det en **lenke tilbake til spillet**, som åpner det i samme fane med rommet i behold. Lenken står bevisst ikke i den første: den ville åpnet spillet en gang til i butikk-fanen, med en kopi av rommet.

- [ ] *Online Store → Themes → Customize*, åpne **Home page**. Fjern alle seksjonene som står der (og toppen og bunnen, hvis temaet lar deg, så siden fyller hele skjermen). Legg til **Custom Liquid** og lim inn hele innholdet i `shopify/forside.liquid`. Lagre.
- [ ] **Du skal se** at `https://shop.disputt.site/` viser en burgunder side med «Takk!» og to knapper. Knappen lukker bare fanen hvis spillet har åpnet den, og ellers står det at du må lukke den selv.

## 7. Shopify: e-postbekreftelsen

Filen [`shopify/ordrebekreftelse.liquid`](../shopify/ordrebekreftelse.liquid) er en boks som legges inn i ordrebekreftelsen kunden får. Den viser koden fra spillet, forteller hvordan man bruker den på en ny telefon og hvor lenge pakkene varer, og **bekrefter samtykket** til at tilgangen leveres med en gang og at angreretten da faller bort (avsnittet står bare når ordren har samtykket).

1. - [ ] *Settings → Notifications → Customer notifications → Order confirmation → Edit code*.
2. - [ ] Finn teksten som takker for bestillingen, og lim inn hele innholdet i `shopify/ordrebekreftelse.liquid` rett etter den. Lagre.
3. - [ ] Under *Settings → Notifications → Sender email*: bruk `kontakt@disputt.site` som avsender (Shopify ber deg bekrefte adressen), så svar på e-posten når fram til deg.
4. - [ ] **Forhåndsvisningen** i Shopify har ingen handlekurvattributter, så der ser du bare linjen om at kunden skal ta kontakt. Boksen med koden ser du først på en ekte (test)bestilling fra spillet ([del 12](#12-test-alt)).

## 8. Nøkler

Signeringsnøkkelen er den samme som i Stripe-veilederen: følg [BETALING.md, del 7.2](BETALING.md#72-signeringsnøkkel-for-tilgangen). Du får to filer: `privat-nokkel.txt` (går til Cloudflare som hemmeligheten `JWT_PRIVATE_KEY`) og `offentlig-nokkel.txt` (går til GitHub som `DISPUTT_PAYMENTS_KEY`). Lag **ett nøkkelpar per miljø**: ett til test-kopien og et annet til live.

Shopify-nøkkelen ([del 10](#10-webhook-shopify-sier-fra-når-noe-er-betalt)) er en annen: den kommer fra Shopify selv når du lager webhooken. Hemmeligheter limer du inn i Cloudflare **selv**, og de skal ikke sendes til noen.

## 9. Betalingsserveren (Cloudflare Worker og database)

Filen er [`payments/worker-shopify.js`](../payments/worker-shopify.js): ca. 450 linjer, ingen avhengigheter. Du limer den inn i nettleseren, så du trenger ikke Node. Databasen er en tom D1-database; Workeren lager tabellene selv.

1. - [ ] Opprett en konto på <https://dash.cloudflare.com/sign-up> og bekreft e-posten. Gratisplanen holder: 100 000 kall per dag for Workeren, og 5 millioner leste og 100 000 skrevne rader per dag i D1 ([Cloudflare Workers](https://developers.cloudflare.com/workers/platform/pricing/), [D1](https://developers.cloudflare.com/d1/platform/pricing/)).
2. - [ ] **Databasen:** *Storage & databases → D1 SQL database → Create database*. Navn: `disputt-orders-test`. Du trenger ikke gjøre mer med den.
3. - [ ] **Workeren:** *Workers & Pages → Create → Create Worker*. Navn: `disputt-pay-shopify-test`. Trykk **Deploy**, deretter **Edit code**. Slett eksempelkoden, åpne [`payments/worker-shopify.js`](../payments/worker-shopify.js) og lim inn **hele** filen. Trykk **Deploy**.
4. - [ ] **Koble databasen til Workeren:** Workeren → **Settings → Bindings → Add → D1 database**. *Variable name*: **`DB`** (nøyaktig slik). Velg `disputt-orders-test`. Trykk **Deploy**.
5. - [ ] **Variablene:** Workeren → **Settings → Variables and Secrets → Add**. *Secret*-verdier kan ikke leses igjen etter at de er lagret, så ha dem i passordbehandleren.

   | Navn | Type | Verdi |
   | --- | --- | --- |
   | `JWT_PRIVATE_KEY` | **Secret** | innholdet i `privat-nokkel.txt` |
   | `SHOPIFY_WEBHOOK_SECRET` | **Secret** | kommer i [del 10](#10-webhook-shopify-sier-fra-når-noe-er-betalt). **La den stå uten verdi til da.** Aldri en midlertidig verdi: den som kjenner den (og variant-ID-ene, som står åpent i `/shop`) kan lage falske betalinger. Uten verdi, eller med en under 16 tegn, avviser Workeren alt fra Shopify. |
   | `SITE_URL` | Text | adressen til **siden som skal bruke betalingen**, med skråstrek på slutten (live: `https://disputt.site/`; for test-kopien: `https://pettersommerseth1994.github.io/Disputt-test/`, se del 11) |
   | `SHOP_URL` | Text | `https://shop.disputt.site` |
   | `VARIANT_EVENING` | Text | variant-ID for «En kveld» (del 5) |
   | `VARIANT_YEAR` | Text | variant-ID for «For ett år» |
   | `VARIANT_LIFETIME` | Text | variant-ID for «Livstid» |
   | `ACCEPT_TEST_ORDERS` | Text | `true` **bare mens du tester** med Shopifys testmodus. Fjernes før live. |

   Trykk **Deploy** etter at du har lagt dem inn.
6. - [ ] Finn adressen til Workeren (Overview, `https://disputt-pay-shopify-test.<ditt-navn>.workers.dev`). Åpne `…/health` i nettleseren.

   **Du skal se** (omtrent): `{"ok":true,"provider":"shopify","mode":"test","site":"https://…/","shop":"https://shop.disputt.site","set":{"database":true,"webhookSecret":true,"signingKey":true,"shop":true,"evening":true,"year":true,"lifetime":true}}`. Hver del under `set` skal være `true`. `mode` er `test` så lenge `ACCEPT_TEST_ORDERS` er `true`, og `live` ellers. Åpne også `…/shop`: den skal si adressen til butikken og de tre variant-ID-ene.

| Hvis du ser … | er det fordi … |
| --- | --- |
| `"database":false` | databasen er ikke koblet til Workeren, eller bindingen heter noe annet enn `DB`. Gjør del 4 over, og trykk Deploy |
| `"webhookSecret":false` | `SHOPIFY_WEBHOOK_SECRET` mangler |
| `"signingKey":false` | `JWT_PRIVATE_KEY` mangler, er kuttet, har linjeskift midt i, eller er ikke fra BETALING.md del 7.2 |
| `"shop":false` / `Betalingen er ikke satt opp riktig (SHOP_URL …)` | `SHOP_URL` mangler, eller er ikke en https-adresse |
| `"evening":false` (eller `year`, `lifetime`) | variabelen mangler eller er ikke et tall (variant-ID-en er bare siffer) |
| `Betalingen er ikke satt opp riktig (SITE_URL mangler)` | `SITE_URL` mangler eller er ikke en adresse |
| `Denne siden har ikke lov til å bruke betalingen` | adressen som kaller er ikke `SITE_URL` (feil adresse, eller http i stedet for https) |
| `Fikk ikke kontakt med betalingen` i appen | telefonen når ikke betalingsserveren: feil adresse i `DISPUTT_PAYMENTS_URL`, eller Workeren er ikke deployet |
| `Tilgangen kunne ikke kontrolleres` etter en betaling | den offentlige nøkkelen på GitHub (`DISPUTT_PAYMENTS_KEY`) hører ikke til den private i Cloudflare (`JWT_PRIVATE_KEY`). Betalingen er gjort, så rett opp nøkkelen og la kunden trykke «Logg inn» med koden. |

Feil du ikke ser i appen står i Cloudflare under Workeren → **Observability / Logs**.

**To Workere og to databaser.** Lag senere en til, `disputt-pay-shopify` med en egen database `disputt-orders` (live), med live-nøkkelen og adressen til den ekte siden ([del 13](#13-gå-live)). Da kan du fortsette å teste mot den første uten å røre den som tar imot ekte penger.

## 10. Webhook: Shopify sier fra når noe er betalt

Dette er det som gjør at spillet finner betalingen. Shopify kaller Workeren når en ordre er betalt, kansellert eller refundert.

1. - [ ] *Settings → Notifications*, bla ned til **Webhooks** → **Create webhook**.
2. - [ ] Lag disse (format **JSON**, siste stabile *API version*, URL = `https://disputt-pay-shopify-test.<ditt-navn>.workers.dev/shopify/webhook`):

   | Event | Navn i API-et | Hva Workeren gjør |
   | --- | --- | --- |
   | **Order payment** | `orders/paid` | skriver ned koden, pakken og tidspunktet. Dette er den viktige. |
   | **Order cancellation** | `orders/cancelled` | koden slutter å virke |
   | **Refund creation** | `refunds/create` | en full refusjon gjør at koden slutter å virke; en delvis refusjon (en velvilje) endrer ingenting |
   | **Dispute creation** (hvis den står i listen) | `disputes/create` | en bestridt betaling gjør at koden slutter å virke. Står den ikke i listen, får Workeren ikke vite om tvister: se i Shopify (*Orders*) og stopp koden for hånd ([del 14](#14-drift)). |

3. - [ ] Rett under (eller over) listen over webhooks står en tekst om at webhookene **signeres** med en nøkkel (*Your webhooks will be signed with …*). Kopier den. Legg den inn i Cloudflare som hemmeligheten **`SHOPIFY_WEBHOOK_SECRET`** (Workeren → Settings → Variables and Secrets), og trykk Deploy. Send den ikke til noen.
4. - [ ] Åpne `…/health` på nytt: **alt under `set` skal være `true`**.

**Hvis varselet ikke kommer fram.** Shopify svarer ikke på noe, men venter at Workeren svarer innen fem sekunder, og prøver et varsel som ikke blir besvart med «ja» åtte ganger over fire timer. Workeren skriver hver ordre ned bare én gang, så gjentatte forsøk er ikke noe problem. Men: en webhook som lages med Shopifys API slettes automatisk etter åtte mislykkede forsøk på rad, og Shopify sier ikke noe om de du lager for hånd. Regn med at det kan skje. Er Workeren, databasen eller Cloudflares gratis kvote nede i mer enn fire timer (eller signeringsnøkkelen er feil), så **sjekk *Settings → Notifications → Webhooks* etterpå**, lag webhooken på nytt hvis den er borte, og legg inn betalinger som kom mens den manglet for hånd ([del 14](#14-drift)).

## 11. Koble til appen på GitHub

Appen slår betaling på når byggingen får to variabler: adressen til betalingsserveren og den offentlige nøkkelen. En tredje sier at det er Shopify (uten den er det Stripe). Uten dem er alt som før.

> **Slå ikke på betaling på hovedsiden mens du tester.** Alle som åpner siden da får betalingsmuren etter runde 2. Test i en egen kopi.

**Test-kopien** (<https://github.com/Pettersommerseth1994/Disputt-test>, på `https://pettersommerseth1994.github.io/Disputt-test/`):

1. - [ ] Sett `SITE_URL` i **test-Workeren** til `https://pettersommerseth1994.github.io/Disputt-test/` (med skråstrek på slutten) og trykk Deploy. Betalingsserveren svarer bare til den siden.
2. - [ ] Ha to verdier klare: Worker-adressen (`https://disputt-pay-shopify-test.<ditt-navn>.workers.dev`, uten noe på slutten) og innholdet i `offentlig-nokkel.txt`. Ingen av dem er hemmelige. **Send dem til meg**, så setter jeg variablene i test-kopien og kjører bygget. Vil du heller gjøre det selv: <https://github.com/Pettersommerseth1994/Disputt-test/settings/variables/actions> → *New repository variable*:

   | Variabel | Verdi |
   | --- | --- |
   | `DISPUTT_PAYMENTS_URL` | adressen til test-Workeren |
   | `DISPUTT_PAYMENTS_KEY` | innholdet i `offentlig-nokkel.txt` |
   | `DISPUTT_PAYMENTS_PROVIDER` | `shopify` |
   | `DISPUTT_FREE_ROUNDS` | valgfri, fra 1 til 99, standard `2` |
   | `DISPUTT_TERMS_URL`, `DISPUTT_PRIVACY_URL` | valgfri. Uten dem lenker pakkeskjermen til appens egne sider, `vilkar.html` og `personvern.html` |

   (`DISPUTT_PAYMENTS_METHODS` hører til Stripe og brukes ikke her: kunden velger Vipps, Apple Pay eller kort i butikken.)

   Kjør så bygget: **Actions → Pages → Run workflow** i test-kopien.
3. - [ ] Åpne test-kopien på telefonen. **Du skal se:** på forsiden står det **Allerede kunde? Logg inn** der «Slik spiller du» stod. Er det ikke slik, mangler en av variablene, eller byggingen er ikke kjørt etter at du la dem inn.

## 12. Test alt

Test først i test-kopien, med Shopify Payments' testmodus. **Slå på testmodus:** *Settings → Payments → Shopify Payments → Manage → Enable test mode*, og sett `ACCEPT_TEST_ORDERS` = `true` i test-Workeren ([del 9](#9-betalingsserveren-cloudflare-worker-og-database)). Testbestillinger er merket som tester i Shopify og telles av betalingsserveren bare mens `ACCEPT_TEST_ORDERS` er `true`.

**Testkort:** `4242 4242 4242 4242`, en utløpsdato i fremtiden, tre siffer som CVV, og et navn med to ord. Avslag: `4000 0000 0000 0002`. Ingen ekte penger trekkes. (Vipps, Apple Pay og Google Pay kan ikke testes med falske penger på samme måte: Vipps testes med Vipps' testmiljø når du har fått avtalen, og for Apple Pay får du kjøre et lite, ekte kjøp og refundere det, [del 13](#13-gå-live).)

| # | Test | Du skal se |
| --- | --- | --- |
| 1 | Start et spill med to–tre telefoner, spill to runder, trykk **Neste runde** | pakkene. Knappen **Gå til betaling** er grå til du har krysset av. De andre telefonene sier bare «Venter på at verten starter neste runde». |
| 2 | Kryss av og trykk **Gå til betaling** | butikken åpner seg i en **ny fane**, i kassen, med pakken og prisen. Spillet står bak og sier «Venter på betalingen …». Gjestene merker ingenting. |
| 3 | Betal med testkortet | i butikken: takkesiden. I spillet: **Takk!** med kode og pakke, innen få sekunder. Trykk **Start runde 3**. |
| 4 | I Shopify admin, åpne ordren | under merknader (*Additional details*) står `kode: …` og `samtykke: …` |
| 5 | Lukk butikk-fanen før du har betalt (ny pakke, ny runde) | spillet venter fortsatt. **Åpne betalingen igjen** åpner den samme handlekurven. **Avbryt** tar deg tilbake, og avkrysningen må settes igjen. |
| 6 | Betal med spillfanen i front (på en datamaskin, med to vinduer side om side) | spillet viser **Takk!** og lukker butikk-fanen av seg selv |
| 6b | På en telefon: betal, og trykk **Fortsett å handle** på takkesiden i butikken (spillfanen i bakgrunnen) | forsiden med «Takk!» og knappen **Lukk fanen og gå tilbake til spillet**. Den lukker butikk-fanen, og spillet er der du forlot det og viser «Takk!». Skulle det i stedet stå «Tilbake til spillet» som en lenke, åpnet ikke spillet butikken (se punkt 10). |
| 7 | Sjekk e-posten du brukte | ordrebekreftelsen har boksen med koden, og teksten om angreretten |
| 8 | Ny telefon (eller privat fane): **Allerede kunde? Logg inn**, skriv koden (med små bokstaver, uten bindestreker) | «Velkommen tilbake!», og tilgangen ligger på telefonen |
| 9 | Refunder ordren i Shopify (*Orders → ordren → Refund*) | kode som nå brukes under «Logg inn» sier at betalingen er refundert |
| 10 | Bruk en nettleser som ikke åpner nye faner (eller slå av popup-tillatelsen) | fanen du står i går til butikken. Etter betalingen leder **Fortsett å handle** til forsiden, som da har en lenke tilbake til spillet (rommet står der det var). Tilbakeknappen virker også: spillet finner betalingen selv. |
| 11 | Lag en bestilling uten samtykke: ta bort `attributes[samtykke]=…` fra handlekurvlenken i adressefeltet før du betaler | betalingen går gjennom i Shopify, men spillet gir **ingen tilgang**, og Cloudflare-loggen sier «… without the consent to getting the access at once». Dette er med vilje: uten samtykket ender ikke angreretten når tilgangen leveres. Du kan gi tilgangen for hånd ([del 14](#14-drift)) etter å ha snakket med kunden. |

Går noe galt: *Cloudflare → Workeren → Observability / Logs* viser hva Workeren ble spurt om og svarte. `POST /shopify/webhook` med `401` betyr feil signeringsnøkkel (`SHOPIFY_WEBHOOK_SECRET`), og `ignored: no_code` i loggen betyr at en bestilling kom uten kode (kjøpt utenom spillet).

**Automatiske tester.** Disse trenger ingen konto og gjør det samme mot en falsk butikk:

```bash
npm test                        # alle tester, også betalingsserveren og siden mot den
npm run play:pay-shopify        # hele kvelden i en ekte nettleser, mot en falsk Shopify-butikk (ny fane, lukk, åpne igjen, betal)
npm run play:pay-shopify-slow   # det samme, med verten borte i 75 sekunder
npm run qa:fit                  # pakkene må vises uten å rulle på 390×664 og de andre størrelsene
npm run qa:overlap              # ingen tekst oppå annen tekst, heller ikke på betalingsskjermene
```

## 13. Gå live

1. - [ ] Lag den **ekte** Workeren og databasen (`disputt-pay-shopify`, `disputt-orders`) som i [del 9](#9-betalingsserveren-cloudflare-worker-og-database), med et **eget nøkkelpar**, `SITE_URL` = `https://disputt.site/`, **uten** `ACCEPT_TEST_ORDERS`, og lag webhookene på nytt for den adressen ([del 10](#10-webhook-shopify-sier-fra-når-noe-er-betalt)). Shopify-nøkkelen (webhooken) er den samme for butikken, men den nye Workeren skal ha den som sin egen hemmelighet.
2. - [ ] Slå av testmodus i Shopify Payments. Sjekk at Vipps er godkjent og i bruk, og at Apple Pay vises.
3. - [ ] Sjekk at vilkårene og personvernerklæringen er lest, og at `kontakt@disputt.site` virker ([BETALING.md, 2.6](BETALING.md#26-e-post-på-disputtsite)). Står det fortsatt `KONTAKT-EPOST` i sidene, stopper byggingen med betaling på.
4. - [ ] Sett variablene i hovedrepoet <https://github.com/Pettersommerseth1994/Disputt/settings/variables/actions>: `DISPUTT_PAYMENTS_URL` (den ekte Workeren), `DISPUTT_PAYMENTS_KEY` (den ekte offentlige nøkkelen) og `DISPUTT_PAYMENTS_PROVIDER` = `shopify`. Kjør **Actions → Pages → Run workflow**.
5. - [ ] **Ett lite, ekte kjøp.** Kjøp «En kveld» med et ekte kort (eller Apple Pay og Vipps), sjekk at «Takk!» og e-posten kommer, og **refunder** ordren i Shopify. Sjekk at «Logg inn» med koden nå sier at betalingen er refundert.
6. - [ ] Slå av betalingen igjen når som helst ved å slette de to variablene `DISPUTT_PAYMENTS_URL` og `DISPUTT_PAYMENTS_KEY` og kjøre Pages på nytt.

## 14. Drift

- **Ordrene** står i Shopify admin (*Orders*). På hver ordre ligger koden og samtykket som merknader. Kunden har mistet koden? Finn ordren på e-postadressen, og send koden.
- **Databasen** (Cloudflare → *Storage & databases → D1 → disputt-orders → Console*):

  ```sql
  SELECT name, code, plan, datetime(paid_at, 'unixepoch') AS betalt, amount / 100.0 AS kr, state, test FROM orders ORDER BY paid_at DESC LIMIT 20;
  ```

  `state` er `paid`, `refunded`, `cancelled` eller `disputed`. Tabellen inneholder ingen navn eller e-postadresser.
- **Kjøpt utenom spillet.** Noen som kjøper direkte i butikken (en lenke til et produkt) får ordrebekreftelsen, men ingen kode, og linjen i e-posten ber dem ta kontakt. Betalingsserveren skriver «Order #… was paid for a package but has no code» i loggen. Sammen med ordrer uten samtykke (se under) er det de eneste som ikke gir tilgang av seg selv. Gi dem tilgangen ved å sende dem til spillet og refundere kjøpet, eller send en kode du lager selv. Lag en tilfeldig kode i Terminal (`LC_ALL=C tr -dc '0123456789ABCDEFGHJKMNPQRSTVWXYZ' < /dev/urandom | head -c 12`), skriv den som `XXXX-XXXX-XXXX`, legg en rad inn i databasen (bytt `<koden>` og `year`/`evening`/`lifetime`) og gi dem koden, som de skriver under «Logg inn». **Bruk aldri en kode som står i en veiledning, og aldri samme kode to ganger:** den som kjenner den, har tilgangen.

  ```sql
  INSERT INTO orders (order_id, code, plan, paid_at, consented_at, amount, currency, name)
  VALUES ('manuell-1', '<koden>', 'year', strftime('%s','now'), strftime('%s','now'), 0, 'NOK', 'gave');
  ```

  Samme grep legger inn en betaling som Shopify tok imot mens webhooken manglet: ta koden og tidspunktene fra merknadene på ordren i Shopify, bruk ordrenummeret som `order_id` og en `paid_at` i sekunder (`strftime('%s','2026-10-06 08:15:00')`, i UTC), og beløpet i øre.
- **Ordre uten samtykke.** En ordre for en pakke uten attributten `samtykke` gir ingen tilgang, og loggen sier «… without the consent …». Snakk med kunden, og legg den inn for hånd som over (eller refunder).
- **Stoppe en kode for hånd** (en tvist som ikke gav varsel, eller en refusjon som ikke nådde fram): `UPDATE orders SET state = 'disputed' WHERE code = '<koden>';` (`state` kan også være `refunded` eller `cancelled`).
- **En full refusjon** i Shopify gjør at koden slutter å virke på nye telefoner, også mens refusjonen ennå ikke har gått gjennom hos betalingsleverandøren (Vipps). En delvis refusjon endrer ingenting. En tilgang som allerede ligger på en telefon varer til den går ut ([del 16](#16-begrensninger-og-mulige-neste-steg)).
- **Bytte signeringsnøkkel** (mister du den private): lag et nytt par og bytt både `JWT_PRIVATE_KEY` og `DISPUTT_PAYMENTS_KEY`. Alle tilganger på telefonene blir ugyldige, og kundene må trykke «Logg inn» og skrive koden sin én gang. Ingen penger går tapt.
- **Bytte webhook-nøkkel:** Shopify viser en ny når du lager webhookene på nytt; bytt `SHOPIFY_WEBHOOK_SECRET`.

## 15. Slik henger koden sammen

| Fil | Hva |
| --- | --- |
| [`payments/worker-shopify.js`](../payments/worker-shopify.js) | Betalingsserveren for Shopify. Én fil, bare `export default { fetch }`. |
| [`public/js/pay/shop.js`](../public/js/pay/shop.js) | Siden: spør om butikken, lager koden og handlekurvlenken, åpner fanen, spør om koden er betalt |
| [`public/js/screens/shoppay.js`](../public/js/screens/shoppay.js) | Bunnlinjen på pakkeskjermen: avkrysning, «Gå til betaling», og «Venter på betalingen» |
| [`public/js/pay/payments.js`](../public/js/pay/payments.js), [`pass.js`](../public/js/pay/pass.js), [`plans.js`](../public/js/pay/plans.js) | det samme som for Stripe: tilgangen, koden, pakkene |
| [`shopify/forside.liquid`](../shopify/forside.liquid), [`shopify/ordrebekreftelse.liquid`](../shopify/ordrebekreftelse.liquid) | det som limes inn i Shopify |
| [`tools/pages/build.mjs`](../tools/pages/build.mjs) | bygger inn variablene, sjekker dem, og slipper betalingsserveren gjennom CSP-en |
| `tools/qa/fakeshopify.mjs`, `fakedb.mjs`, `shop-stack.mjs`, `shopflow.mjs`, `miniliquid.mjs` | falsk Shopify (ordre og signerte webhooker, en butikk med kasse), falsk D1, hele kjeden i en nettleser, og en liten Liquid-tolk som prøver filene i `shopify/` |
| `test/worker-shopify.test.js`, `test/shop-flow.test.js`, `test/shopify-files.test.js` | betalingsserveren, siden mot den, og filene som limes inn i Shopify |

### Betalingsserverens kall

| Kall | Gjør | Svar |
| --- | --- | --- |
| `GET /shop` | siden spør hvor verten skal sendes | `{ shop, variants: { evening, year, lifetime } }` |
| `POST /restore` `{ code }` | er koden betalt? Siden spør mens verten betaler, og en kunde på ny telefon spør med koden fra e-posten | `{ token, code, plan, paidAt, expiresAt }`, eller `404 not_found` (ikke betalt ennå, eller ukjent kode), `410 refunded` / `cancelled` / `disputed` / `expired`, `400` (koden ser ikke riktig ut) |
| `POST /shopify/webhook` | Shopify sier at en ordre er betalt, kansellert eller refundert. Signert (HMAC-SHA256, `X-Shopify-Hmac-Sha256`) | `{ ok: true }` (eventuelt `ignored: …`), `401` for feil signatur |
| `GET /health` | status, uten hemmeligheter | `{ ok, provider, mode, site, shop, set }` |

### Databasen

| Tabell | Innhold |
| --- | --- |
| `orders` | én rad per betalt ordre: `order_id`, `code`, `plan`, `paid_at` (sekunder, Shopifys tidspunkt), `consented_at` (når verten samtykket, i spillet), `amount` (øre), `currency`, `name` (#1001), `test`, `state`, `refunded` (øre) |
| `refunds` | én rad per refusjon (for å telle hver bare en gang), med beløp og valuta. Bare refusjoner i ordrens egen valuta teller. |
| `stops` | at en ordre er kansellert eller bestridt. Shopify lover ikke å si ting i den rekkefølgen de skjedde, så en kansellering kan komme før ordren er skrevet ned; da stoppes ordren når den kommer. |

### Tilgangen og koden

- **Tilgang:** JWT med `{ iss: "disputt", aud: adressen til betalingsserveren, plan, pa: betalt (s), iat, exp? }`, signert med ES256. `exp` finnes ikke for «Livstid». «For ett år» slutter samme dag og klokkeslett (UTC) neste år; «En kveld» 12 timer etter betalingen. Siden godtar bare tilganger som er laget for betalingsserveren den er satt opp med.
- **Kode:** tolv tegn fra `0123456789ABCDEFGHJKMNPQRSTVWXYZ`, skrevet `XXXX-XXXX-XXXX`, laget av siden. Én kode kan i teori ha mer enn én ordre (en handlekurvlenke som betales to ganger): den som varer lengst gjelder.
- **Hva en ordre gir:** pakken følger av variant-ID-en på ordrelinjen (den beste, hvis en ordre har flere), aldri av noe siden har sagt. Antallet betyr ingenting. Prisen sjekkes ikke: den er det du har satt i Shopify. Ordren må ha koden (`kode`) **og** samtykket (`samtykke`, et tidspunkt) fra spillet; uten dem gir den ingen tilgang. En testbestilling teller bare mens `ACCEPT_TEST_ORDERS` er `true`.
- **På telefonen:** `localStorage['disputt:pass:<adressen til betalingsserveren>']` = `{ token, code }`. `sessionStorage['disputt:shop']` = den pågående betalingen (kode, pakke, adresse, tidspunkt; glemmes etter to timer).
- **Å spørre:** hvert 3. sekund de første tre minuttene, deretter hvert 15., og bare mens fanen er synlig. Kommer verten tilbake til fanen, spør siden med en gang.
- **Protokoll:** meldingen `away` (vert → gjester) sendes når fanen åpnes, så gjestene venter om forbindelsen skulle gå tapt mens verten betaler ([PROTOCOL.md](PROTOCOL.md)).

## 16. Begrensninger og mulige neste steg

- **Myk betalingsmur.** Spillmotoren kjører i vertens nettleser og koden er offentlig. Den som kan JavaScript kan fjerne muren, eller stille klokken tilbake på telefonen for å forlenge «En kveld». For en vennegjeng-app er det greit; vil du ha en hard mur, må spillet flyttes til en server som holder motoren (servermodus finnes, se [DEPLOY.md](DEPLOY.md)) og sjekker tilgangen der.
- **Koden kan deles.** Den som har koden har tilgangen, og kan bruke den på flere telefoner. Vil du begrense det, må betalingsserveren telle hvor mange telefoner en kode er hentet til (databasen er der allerede).
- **Refusjon trekker ikke tilbake en tilgang som allerede ligger på en telefon.** Den hindrer bare at koden brukes på nye telefoner.
- **Gratisrunder per spill.** «Spill igjen» nullstiller rundetellingen. Den som spiller korte spill (to runder eller mindre) spiller derfor gratis.
- **Ingen automatisk retur fra butikken.** Shopifys takkeside kan ikke sende kunden tilbake til spillet. Derfor åpnes butikken i en ny fane, spillet finner betalingen selv, og forsiden i butikken lukker fanen. En nettleser som ikke åpner nye faner sender den fanen verten står i til butikken, og verten går tilbake med tilbakeknappen.
- **Alle kan banke på Workeren.** Adressen er offentlig, og `/shop`, `/restore` og `/health` kan kalles med `curl`. Ingenting kan hentes uten en kode som er betalt (60 bit, så den kan ikke gjettes), men den som sender svært mange spørsmål kan bruke opp den gratis kvoten (100 000 kall om dagen, og 5 millioner leste rader i databasen). Vil du stenge det ute, legg en rate-begrensning foran Workeren (Cloudflare → Security → WAF → Rate limiting rules). Webhooken er signert og tar ikke imot noe uten Shopifys signatur.
- **Bruk bare NOK i butikken** (ikke flere valutaer med Shopify Markets). Workeren regner en refusjon i samme valuta som ordren; en refusjon i en annen valuta stopper ikke koden.
- **Faner som spillet åpner beholder `window.opener`** (det er derfor spillet kan lukke dem igjen). Butikkens egne sider kunne i teorien sendt spillfanen til en annen adresse; i en butikk uten tredjepartsapper på forsiden er det ikke noe problem. Ikke legg apper eller skript på butikkens forside.
- **Kjøp utenom spillet gir ingen kode** ([del 14](#14-drift)). Vil du hindre det, kan produktsidene i temaet fjernes eller stenges.
- **Vipps går som tredjepartsbetaling** i Shopify: ekstra gebyr, og Vipps' hurtigbetaling («express checkout») er ikke støttet. Vipps-tillegget har egen onboarding.
- **Apple Pay vises ikke overalt.** Det avhenger av nettleseren og enheten (Safari med kort i Wallet), ikke av oss. Kort er alltid med.
- **Butikken må være åpen** (uten passord) og produktene må ligge i salgskanalen *Online Store*, ellers virker ikke handlekurvlenkene.
- **Betaling virker bare med peer-to-peer-bygget (GitHub Pages).** Bygget nekter betaling sammen med `DISPUTT_SERVER_URL`.
- **Flere typer innlogging, abonnement, kampanjekoder i spillet, kvitteringer fra appen, statistikk:** ikke bygget.

## 17. Kilder

- [Shopify Payments: land som støttes (Norge)](https://help.shopify.com/en/manual/payments/shopify-payments/supported-countries) · [Test Shopify Payments](https://help.shopify.com/en/manual/payments/shopify-payments/testing-shopify-payments) · [Shopify, priser](https://www.shopify.com/no/pricing)
- [Handlekurvlenker (cart permalinks), med attributter](https://shopify.dev/docs/apps/build/checkout/create-cart-permalinks)
- [Apper og ordrer eldre enn 60 dager (`read_all_orders`)](https://shopify.dev/docs/api/usage/access-scopes)
- [Vipps MobilePay for Shopify](https://developer.vippsmobilepay.com/docs/plugins/shopify/)
- [Cloudflare Workers: priser og grenser](https://developers.cloudflare.com/workers/platform/pricing/) · [Cloudflare D1: priser](https://developers.cloudflare.com/d1/platform/pricing/) · [Cloudflare D1: kom i gang](https://developers.cloudflare.com/d1/get-started/)
- [Veileder om angrerett (Regjeringen)](https://www.regjeringen.no/contentassets/6d6b5195d1ee4133977bf5339d1623d9/veileder-angrerett-2017.pdf)
