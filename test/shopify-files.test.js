// The files that go into Shopify (shopify/): tried with the little Liquid that tools/qa/miniliquid.mjs knows, and held to what the page and the
// payment server say about the same things (the name of the cart attribute that carries the code, the address of the game).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { renderLiquid } from '../tools/qa/miniliquid.mjs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const FRONT = read('shopify/forside.liquid');
const MAIL = read('shopify/ordrebekreftelse.liquid');
const text = (html) => html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

describe('the little Liquid that the tests know', () => {
  it('does if, else, comments, names and escape, and says so when it is asked for more', () => {
    assert.equal(renderLiquid('a{% comment %}hidden {{ nope }}{% endcomment %}b', {}), 'ab');
    assert.equal(renderLiquid('{% if x.y %}yes{% else %}no{% endif %}', { x: { y: 'v' } }), 'yes');
    assert.equal(renderLiquid('{% if x.y %}yes{% else %}no{% endif %}', {}), 'no');
    assert.equal(renderLiquid('{% if x %}yes{% endif %}', { x: '' }), 'yes', 'in Liquid an empty text is true');
    assert.equal(renderLiquid('{{ x | escape }}', { x: '<b>"&"</b>' }), '&lt;b&gt;&quot;&amp;&quot;&lt;/b&gt;');
    assert.equal(renderLiquid('{% if a %}{% if b %}1{% else %}2{% endif %}{% else %}3{% endif %}', { a: 1, b: 0 }), '1', 'nested (0 is true in Liquid)');
    assert.throws(() => renderLiquid('{% if x %}never closed', { x: 1 }), /never closed/);
    assert.throws(() => renderLiquid('{{ missing }}', {}), /not set/);
    assert.throws(() => renderLiquid('{% for a in b %}{% endfor %}', {}), /not tried/);
    assert.throws(() => renderLiquid('{{ x | upcase }}', { x: 1 }), /not tried/);
    assert.throws(() => renderLiquid('{% if x == 1 %}a{% endif %}', { x: 1 }), /more than a name/);
  });
});

describe('the box in the order confirmation (shopify/ordrebekreftelse.liquid)', () => {
  const withCode = text(renderLiquid(MAIL, { attributes: { kode: 'K7M2-9QXD-4TRB' } }));

  it('shows the code that the page made up, and how to use it on a new phone', () => {
    assert.match(withCode, /Koden din er K7M2-9QXD-4TRB/);
    assert.match(withCode, /Allerede kunde\? Logg inn/);
    assert.match(withCode, /12 timer fra betalingen/);
    assert.match(withCode, /12 måneder/);
    assert.match(withCode, /Livstid/);
  });

  it('says nothing about a consent that is not on the order, but still shows the code', () => {
    const noConsent = text(renderLiquid(MAIL, { attributes: { kode: 'K7M2-9QXD-4TRB' } }));
    assert.match(noConsent, /Koden din er K7M2-9QXD-4TRB/);
    assert.doesNotMatch(noConsent, /angrerett/i, 'the e-mail does not claim a consent that was never given');
  });

  it('confirms the consent to getting the access at once, and that the right of withdrawal ends, and names the terms', () => {
    const withConsent = text(renderLiquid(MAIL, { attributes: { kode: 'K7M2-9QXD-4TRB', samtykke: '2026-10-06T08:15:00.000Z' } }));
    assert.match(withConsent, /Du ba om at tilgangen skulle leveres med en gang da du betalte, og du forsto at angreretten da bortfaller/);
    assert.match(withConsent, /angrerettloven § 22/);
    assert.match(withConsent, /https:\/\/disputt\.site\/vilkar\.html/);
  });

  it('writes the code out in a way that cannot carry anything else with it', () => {
    const html = renderLiquid(MAIL, { attributes: { kode: '<script>alert(1)</script>' } });
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('&lt;script&gt;'));
  });

  it('says what to do when the order has no code, and does not show an empty box', () => {
    const without = text(renderLiquid(MAIL, { attributes: {} }));
    assert.match(without, /Har du betalt uten å få en kode/);
    assert.match(without, /kontakt@disputt\.site/);
    assert.doesNotMatch(without, /Koden din er|Tilgangen din til Disputt/);
    assert.doesNotMatch(withCode, /uten å få en kode/);
  });
});

describe('the front page of the shop (shopify/forside.liquid)', () => {
  const html = renderLiquid(FRONT, {});

  it('thanks the customer and closes the tab on a tap, for a tab that the game opened', () => {
    assert.match(text(html), /Takk!/);
    assert.match(html, /id="disputt-close"/);
    assert.match(html, /window\.close\(\)/);
    assert.match(text(html), /Fanen lot seg ikke lukke her\. Bytt tilbake til fanen med spillet/);
  });

  it('shows the link to the game only to a tab that the game did not open, and never says "close it yourself and you are back"', () => {
    assert.match(html, /getElementById\(window\.opener \? 'disputt-from-game' : 'disputt-no-game'\)\.hidden = false/);
    assert.match(html, /id="disputt-no-game" hidden>[\s\S]*href="https:\/\/disputt\.site\/"/, 'the link sits in the part that is hidden from a tab with an opener');
    assert.doesNotMatch(html.match(/<div id="disputt-from-game"[\s\S]*?<\/div>/)[0], /href=/, 'a tab that the game opened has no link to the game: it would open the game a second time, with a copy of the room');
    assert.match(html, /<noscript>[\s\S]*href="https:\/\/disputt\.site\/"/, 'and a browser without scripts gets the link');
    assert.doesNotMatch(text(html), /Lukk den selv/);
  });

  it('has nothing in it that depends on Shopify: no tags and no names are left for Liquid', () => {
    assert.ok(!/{%|{{/.test(html));
  });
});

describe('what the files, the page and the payment server agree on', () => {
  it('calls the cart attribute that carries the code "kode" everywhere', () => {
    assert.match(read('public/js/pay/shop.js'), /\?attributes\[kode\]=\$\{encodeURIComponent\(code\)\}/);
    assert.match(read('payments/worker-shopify.js'), /String\(a\?\.name\)\.toLowerCase\(\) === 'kode'/);
    assert.match(MAIL, /attributes\.kode/);
  });

  it('calls the consent "samtykke" in the page and in the shop\'s files', () => {
    assert.match(read('public/js/pay/shop.js'), /&attributes\[samtykke\]=\$\{encodeURIComponent\(at\.toISOString\(\)\)\}/);
    assert.match(read('docs/SHOPIFY.md'), /samtykke/);
  });

  it('points at the terms and the game at addresses that exist in the app', () => {
    const files = ['public/vilkar.html', 'public/index.html'];
    for (const file of files) assert.ok(read(file).length > 0, file);
    assert.ok(MAIL.includes('disputt.site/vilkar.html') && FRONT.includes('https://disputt.site/'));
    assert.match(read('public/js/pay/shop.js'), /attributes\[samtykke\]/);
    assert.match(MAIL, /attributes\.samtykke/);
    assert.match(read('payments/worker-shopify.js'), /=== 'samtykke'/);
  });
});
