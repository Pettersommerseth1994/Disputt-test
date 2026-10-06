# Peer-to-peer-modus (GitHub Pages)

GitHub Pages kan bare vise filer, så der finnes ingen spillserver. Derfor kjører **vertens telefon selve spillet**: den samme motoren som Node-serveren bruker (`shared/`), lastet inn i vertens nettleser. De andre telefonene kobler seg rett til verten over WebRTC. Resten av appen (skjermene, designet, meldingene) er identisk med servermodus.

## Slik henger det sammen

```
 gjest ──WebRTC (kryptert)──▶ vertens telefon  ◀── loopback ── vertens egen skjerm
   │                              │  (motoren: shared/hub.js + game.js)
   └────── megler (PeerJS) ◀──────┘   introduserer telefonene for hverandre; ser ikke spilltrafikken
```

1. Verten trykker **Opprett spill**. Siden velger en spillkode og reserverer den hos PeerJS' gratis, offentlige meglertjeneste (`0.peerjs.com`) som en peer kalt `disputt1-<KODE>`. Er koden tatt, prøves en ny.
2. Gjester åpner `…/?j=KODE` (det er dette QR-koden inneholder) eller skriver koden inn. De ber megleren om å bli koblet til `disputt1-<KODE>`, og får en **direkte, kryptert datakanal** (WebRTC, DTLS) til verten. Megleren hjelper bare med å finne hverandre; spillmeldingene går telefon til telefon.
3. Over datakanalen går de samme JSON-meldingene som over WebSocket (se [PROTOCOL.md](PROTOCOL.md)). Verten bruker en intern «loopback»-kobling til motoren i samme side.
4. Motoren tar vare på rommet i `sessionStorage` etter hver endring ([`public/js/p2p/snapshot.js`](../public/js/p2p/snapshot.js)).

Koden ligger i [`public/js/p2p/`](../public/js/p2p) (`host.js`, `guest.js`, `adapter.js`, `peer.js`) og i `public/js/net.js`, som velger kobling («link») etter modus.

## Hva skjer når …

| Situasjon | Resultat |
| --- | --- |
| Verten laster siden på nytt, eller nettleseren kaster fanen | Rommet gjenopprettes fra `sessionStorage`, samme kode. Gjestene kobler til igjen av seg selv og er tilbake i samme runde. |
| Verten bytter til en annen app en stund (iOS fryser siden) | Spillet står stille til verten kommer tilbake. Skjermen holdes våken mens siden er åpen (Wake Lock, krever HTTPS, som Pages har). |
| Verten lukker fanen for godt | Spillet er over. Gjestene prøver å koble til igjen i ca. ett minutt og får så beskjed om at verten er borte. |
| Verten går til betaling i Shopify-butikken (betalingen er slått på, [SHOPIFY.md](SHOPIFY.md)) | Butikken åpner seg i en **ny fane**, og spillet står åpent i fanen bak: forbindelsen består, og siden spør selv om betalingen er gjennomført. `away` sendes likevel først, hvis nettleseren skulle sove fanen. En nettleser som ikke åpner nye faner sender den fanen verten står i til butikken, som nedenfor. |
| Verten går til betaling hos Stripe (betalingen er slått på, [BETALING.md](BETALING.md)) | Før siden forlates sender verten `away` til gjestene. De viser «Verten betaler – spillet fortsetter straks» og venter i opptil ti minutter (Vipps må godkjennes i appen innen fem minutter). Rommet ligger i `sessionStorage` og kommer tilbake når Stripe sender verten hjem. |
| En gjest mister forbindelsen eller laster siden på nytt | Kommer tilbake automatisk (`resume`), akkurat som med server. |
| En gjest mister nettleserdataene sine | Hen åpner lenken igjen, velger seg selv fra «Spillet har startet» og tar over plassen. |
| En gjest forsvinner brått (batteri, tunnel) | Verten markerer hen som frakoblet etter ca. 35 s uten ping, og plassen kan overtas. |
| En gjest får ikke koblet til (verten er funnet, men nettet slipper ikke telefonene i direkte kontakt) | Hen prøver på nytt hvert femtende sekund. Etter to mislykkede forsøk (ca. 30 s) står det et råd på skjermen: sjekk at verten har siden åpen, og bytt mellom Wi‑Fi og mobildata. |
| Verten låser skjermen en stund, eller bytter mellom Wi‑Fi og mobildata | Når siden er synlig igjen (eller nettleseren sier «online») åpner verten en ny forbindelse til megleren, for den gamle kan være død uten at noen vet det, og da ville nye gjester få «fant ikke spillet». Åpne kanaler til gjestene røres ikke. |
| En gjest er på «Spillet har startet»-skjermen og mister linjen til verten | Siden kobler seg til igjen av seg selv, så trykket på plassen virker når linjen er tilbake. |
| Megleren (`0.peerjs.com`) er nede | Nye spill og innmeldinger feiler. Pågående spill fortsetter (kanalene er direkte). |

## Begrensninger

- **Nettverk.** Direkte tilkobling krever at telefonene finner en vei til hverandre. STUN-serverne fikser det på de fleste hjemmenett og mobilnett, men ikke alle: strenge bedriftsnett og noen mobiloperatører (symmetrisk NAT) slipper ikke gjennom. Da blir en gjest stående på «Blir med …». Det hjelper å legge til en TURN-server (under), bytte til Wi‑Fi, eller bruke servermodus ([DEPLOY.md](DEPLOY.md)).
- **Verten er serveren.** Alt står og faller med vertens telefon og at siden hennes er åpen.
- **Hvem som helst med romkoden kan prøve seg.** Verten avviser kanaler av feil type, lukker tilkoblinger som ikke sier noe i løpet av ca. 15–20 s, og slipper alltid ekte spillere til foran slike tilkoblinger (`public/js/p2p/pool.js`, testet av `npm run qa:hostile`). Den som kjenner koden kan også ta over en *frakoblet* plass fra «Spillet har startet»-skjermen, siden en telefon som har mistet nettleserdataene ikke har noen hemmelighet å vise frem. Alle de andre får et varsel når det skjer, og den som tok over slipper plassen sin fra før. Blir dette et problem i vennegjengen, er neste steg at verten må godkjenne overtakelser.
- **Fusk er mulig.** Verten kan i prinsippet lese alt (spørsmål, hvem som er imposter) med utviklerverktøy, og spørsmålsbanken ligger i den offentlige koden. Det passer for venner, ikke for konkurranser. Servermodus har ikke dette problemet.
- **IP-adresser.** Slik WebRTC fungerer kan spillerne teknisk se hverandres IP-adresser.
- **Samme avhengighet til én tjeneste:** `0.peerjs.com` drives gratis av PeerJS-prosjektet, uten garanti. Den kan byttes ut med en egen megler (under).

## Innstillinger

Siden bygges av [`tools/pages/build.mjs`](../tools/pages/build.mjs), som skriver `config.js`. På GitHub kan det styres uten å endre kode, med **repository variables** (Settings → Secrets and variables → Actions → Variables) som leses av [`.github/workflows/pages.yml`](../.github/workflows/pages.yml):

| Variabel | Betydning |
| --- | --- |
| `DISPUTT_SERVER_URL` | `wss://…/ws` til en Disputt-server. Settes den, snakker siden med den serveren i stedet for å kjøre peer-to-peer. Se «Pages + Render» i [DEPLOY.md](DEPLOY.md). |
| `DISPUTT_ICE_SERVERS` | JSON-liste med WebRTC-servere, f.eks. TURN: `[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.example.com:443?transport=tcp","username":"…","credential":"…"}]`. Erstatter standardlisten, så ta med STUN-serverne også. |
| `DISPUTT_PEER_HOST`, `DISPUTT_PEER_PORT`, `DISPUTT_PEER_PATH`, `DISPUTT_PEER_SECURE` | Egen [PeerJS-megler](https://github.com/peers/peerjs-server) i stedet for `0.peerjs.com`. |

| `DISPUTT_PAYMENTS_URL`, `DISPUTT_PAYMENTS_KEY` (+ `DISPUTT_PAYMENTS_PROVIDER`, `DISPUTT_PAYMENTS_METHODS`, `DISPUTT_FREE_ROUNDS`, `DISPUTT_TERMS_URL`, `DISPUTT_PRIVACY_URL`) | Slår betaling på: adressen til betalingsserveren og den offentlige nøkkelen som sjekker tilgangen. `DISPUTT_PAYMENTS_PROVIDER` = `shopify` for en Shopify-butikk (ellers Stripe). Uten dem er spillet gratis og ingenting om betaling vises. Se [SHOPIFY.md](SHOPIFY.md) og [BETALING.md](BETALING.md). |

Etter å ha satt en variabel: Actions → **Pages** → *Run workflow* (eller push en endring).

Gratis TURN finnes (f.eks. fra Metered eller Cloudflare), men krever en konto hos dem, så det har jeg ikke satt opp.

## Utvikling og testing

```bash
npm run pages:build            # bygger dist/ (som GitHub Pages)
npm run pages:preview          # bygger og serverer dist/ på http://localhost:8080
npm run play:p2p -- 4 2        # UI-test: 4 «telefoner» spiller til 2 poeng over WebRTC
npm run play:live              # samme test mot den publiserte siden (ekte megler og tidtakere)
npm run qa:stuck               # gjest uten linje til verten får rådet «bytt mellom Wi‑Fi og mobildata»
npm run qa:signalling          # kontakten med meglertjenesten faller ut, verten våkner, plassvelgeren mister linjen: alt kommer seg
npm run qa:hostile             # tilkoblinger av feil type, tilkoblinger som tier, og en full vert: ekte spillere kommer likevel inn
npm run play:subpath           # hele spillet mot den bygde siden under /Disputt/, som på GitHub Pages
npm run play:pay               # med betaling: verten møter pakkene etter runde 2, angrer, betaler med «Vipps» hos en falsk Stripe og spiller videre (og et kjøp fra forsiden, med hjemreise via tilbakeknappen)
npm run play:pay-slow          # det samme, men verten er borte i 75 s mens han betaler: gjestene må vente på ham
```

`play:p2p` starter en lokal PeerJS-megler og serverer den *bygde* siden, så hele flyten (bygget, CSP-en og WebRTC) testes uten internett. `play:live` spiller samme spill mot siden på GitHub Pages og den ekte megleren. Alle «telefonene» sitter da på samme maskin og nett, så den viser at siden og megleren virker, ikke at et gitt mobilnett slipper gjennom. Den tester blant annet at verten kan laste siden på nytt midt i en runde, og at en forsvunnet telefons plass kan overtas. Enhetstestene dekker adapteren ([`test/adapter.test.js`](../test/adapter.test.js)), lagring og gjenoppretting av rom ([`test/game.test.js`](../test/game.test.js)) og selve byggeresultatet ([`test/pages-build.test.js`](../test/pages-build.test.js)).

Lokale testlenker kan overstyre innstillingene (bare på `localhost` og private nett): `?mode=p2p&peerHost=127.0.0.1&peerPort=9000`.
