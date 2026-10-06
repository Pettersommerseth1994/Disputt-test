# Drift: å få Disputt ut til telefonene

Disputt er **én Node-prosess** som serverer nettsiden *og* spillets WebSocket på samme port. Spillrommene ligger i minnet. Det gir to regler:

1. **Kjør nøyaktig én instans.** Flere instanser deler ikke rom, og spillere ville havnet i hver sin verden.
2. En omstart avslutter pågående spill. Spillerne sendes til forsiden med beskjed om at spillet er borte.

| Miljøvariabel | Standard | Betydning |
| --- | --- | --- |
| `PORT` | `3000` | Port å lytte på. Render, Fly og de fleste plattformer setter denne selv. |
| `HOST` | `0.0.0.0` | Hvilket nettverkskort. `0.0.0.0` lar telefoner på samme nett koble til. |
| `PUBLIC_URL` | – | Valgfri. Adressen QR-koden skal peke på (f.eks. `https://disputt.no`). Uten den brukes adressen verten har åpnet, og LAN-adressen hvis verten sitter på `localhost`. |
| `ALLOWED_ORIGINS` | – | Valgfri, kommaseparert liste med nettadresser som får koble til WebSocket fra en annen side (f.eks. en GitHub Pages-side som bruker denne serveren). |

Helsesjekk: `GET /healthz` svarer `ok`.

## 0. GitHub Pages (peer-to-peer, ingen server)

Repoet bygger og publiserer siden til GitHub Pages ved hver push til `main` ([`.github/workflows/pages.yml`](../.github/workflows/pages.yml)): `https://<bruker>.github.io/Disputt/`. Pages kan ikke kjøre en server, så spillet kjører i **vertens nettleser** og gjestene kobler seg direkte til den. Hvordan det virker, hva som skjer ved avbrudd og begrensningene står i **[P2P.md](P2P.md)**.

Gratis GitHub-kontoer får bare Pages fra *offentlige* repoer.

**Betaling** (tre pakker, Vipps, Apple Pay og kort i en Shopify-butikk, eller hos Stripe) er av som standard og slås på med to variabler til (en tredje, `DISPUTT_PAYMENTS_PROVIDER`, sier at det er Shopify): se [SHOPIFY.md](SHOPIFY.md), eller [BETALING.md](BETALING.md) for Stripe.

### Eget domene: disputt.site

Siden ligger på `https://disputt.site/` (satt opp 5. oktober 2026). Rotdomenet er hovedadressen; `www.disputt.site` og den gamle `https://<bruker>.github.io/Disputt/` sender folk videre dit (301, med sti og `?j=KODE`).

1. **DNS** (hos Domeneshop: Domains → Manage DNS): fire `A`-poster og fire `AAAA`-poster på rotdomenet, og en `CNAME` for `www` til `<bruker>.github.io`. Adressene står i [GitHubs veiledning](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site): `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` og `2606:50c0:8000::153` til `2606:50c0:8003::153`. De gamle postene til parkeringssiden må bort, og e-postpostene (`MX`, `TXT`) røres ikke.
2. **GitHub**: Settings → Pages → Custom domain: `disputt.site` (eller `gh api -X PUT repos/<bruker>/Disputt/pages -f cname=disputt.site`). Sett domenet **først når DNS peker på GitHub**, for fra da av sender GitHub også den gamle github.io-adressen dit. Når sertifikatet er klart (noen minutter), slå på *Enforce HTTPS* (`-F https_enforced=true`). Arbeidsflyten trenger ingen `CNAME`-fil.
3. Kjør **Actions → Pages → Run workflow** (eller push), så siden bygges med riktig rotadresse. `404.html` har en `<base>` for den.
4. Nettleserlagring (tilgang, pågående rom) følger ikke med mellom adresser. En vert som sitter midt i et spill når adressen flyttes, mister rommet.
5. Fjerner du Pages-siden mens DNS fortsatt peker på GitHub, kan andre koble domenet til sine egne sider. Fjern da DNS-postene, eller verifiser domenet på GitHub-kontoen (Settings → Pages → Add a domain).

### Pages + Render (alltid-på server)

Vil du ha en server som alltid står (og slippe at alt henger på vertens telefon), kan Pages-siden bruke Render-serveren:

1. Sett opp Render som under (steg 2).
2. På Render: miljøvariabelen `ALLOWED_ORIGINS=https://<bruker>.github.io` (serveren godtar da nettsider derfra).
3. På GitHub: Settings → Secrets and variables → Actions → Variables → ny variabel `DISPUTT_SERVER_URL` = `wss://<din-render-adresse>/ws`.
4. Actions → **Pages** → *Run workflow*. Siden bruker nå serveren. Slett variabelen for å gå tilbake til peer-to-peer.

## 1. På din egen maskin (samme Wi‑Fi)

```bash
npm install
npm start
```

Åpne adressen merket **«På mobilen (Wi‑Fi)»** på verten sin telefon. Er alle på samme nett, kan resten skanne QR-koden. Spillere på mobildata når deg ikke uten en tunnel (se under).

## 2. Render (anbefalt for å teste med venner)

Gratis, ingen kredittkort for testing, og får en `https://…onrender.com`-adresse som fungerer for alle, uansett nett.

1. Logg inn på [render.com](https://render.com) med GitHub-kontoen.
2. **New + → Blueprint**, velg repoet `Disputt` (gi Render tilgang til repoet hvis det er privat). Render leser [`render.yaml`](../render.yaml).
3. Vent 1–2 minutter på bygget. Åpne adressen på telefonen og trykk **Opprett spill**.

Gode å vite:

- Gratisplanen **sovner etter ~15 min uten trafikk**, og første besøk etterpå tar 30–60 sekunder. Åpne siden et minutt før dere skal spille. Betalt «Starter»-plan er alltid våken.
- WebSockets fungerer uten ekstra oppsett. HTTPS gir også *skjerm våken* på telefonene (Wake Lock krever sikker kontekst).

### Egen adresse: disputt.no

1. Render → tjenesten → **Settings → Custom Domains → Add**: `disputt.no` og `www.disputt.no`.
2. Hos domeneregistraren: følg Renders DNS-instruksjoner (`ALIAS`/`ANAME` eller `A`-poster for rotdomenet, `CNAME` for `www`). Sertifikat (HTTPS) ordnes automatisk.
3. Sett miljøvariabelen `PUBLIC_URL=https://disputt.no` i Render, slik at QR-koden alltid peker dit.

## 3. Fly.io

```bash
fly launch --no-deploy          # oppdager Dockerfile; velg region (f.eks. arn eller ams)
fly scale count 1               # viktig: én instans
fly deploy
```

I `fly.toml`: la `internal_port = 3000`, og sett `min_machines_running = 1` og `auto_stop_machines = "off"` hvis spillet alltid skal være våkent.

## 4. Docker

```bash
docker build -t disputt .
docker run -p 3000:3000 -e PUBLIC_URL=https://disputt.no disputt
```

Legg gjerne en omvendt proxy (Caddy, nginx, Cloudflare) foran for HTTPS. WebSocket-stien er `/ws` og må slippes gjennom (`Upgrade`-header). Eksempel for nginx:

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_set_header Host $host;                 # serveren sjekker at siden og WebSocket kommer fra samme adresse
  proxy_set_header X-Forwarded-Host $host;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_read_timeout 3600s;
}
```

## 5. Tunnel fra egen maskin (spillere på mobildata)

Gir en offentlig `https`-adresse til serveren på maskinen din uten å publisere noe:

```bash
npm start
cloudflared tunnel --url http://localhost:3000   # brew install cloudflared
```

Åpne `https://….trycloudflare.com`-adressen **på verten sin telefon** (ikke localhost), så peker QR-koden dit. Tunnelen forsvinner når du stopper kommandoen.

## Sikkerhet i korte trekk

- Ingen kontoer eller persondata lagres. Alt ligger i minnet og forsvinner når rommet er ferdig (6 timer, eller 30 minutter uten tilkoblede spillere).
- Alle svar fra serveren er skreddersydd per spiller: hemmeligheter (imposterens svar, spørsmålet, fasiten) sendes bare til den som skal se dem.
- WebSocket godtar bare samme opprinnelse (`Origin` må være samme adresse som `Host`, `X-Forwarded-Host` eller `PUBLIC_URL`), meldinger er maks 4 kB og begrenset til ca. 15 per sekund per tilkobling. Én tilkobling kan åpne maks 3 rom, og tomme lobbyer ryddes bort etter 5 minutter.
- Strenge sikkerhetshoder (CSP uten inline-skript, `nosniff`, `frame-ancestors 'none'`) på alle svar.
