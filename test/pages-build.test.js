// The static (GitHub Pages) build must work from any sub-path: no absolute URLs, no missing modules, the right config.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { PLANS } from '../public/js/pay/plans.js';
import { build, buildConfig, contentSecurityPolicy } from '../tools/pages/build.mjs';

let out;
let result;
before(async () => {
  out = fs.mkdtempSync(path.join(os.tmpdir(), 'disputt-pages-'));
  result = await build(['--out', out, '--base', '/Disputt/'], {});
});
after(() => fs.rmSync(out, { recursive: true, force: true }));

const files = (dir, test) => {
  const found = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) found.push(...files(p, test));
    else if (test(p)) found.push(p);
  }
  return found;
};
const isVendor = (p) => p.includes(`${path.sep}vendor${path.sep}`);
const rel = (p) => path.relative(out, p);

describe('static build', () => {
  it('produces a peer-to-peer site with the engine and the question bank next to the roster', () => {
    assert.equal(result.config.mode, 'p2p');
    for (const f of ['index.html', '404.html', 'config.js', '.nojekyll', 'manifest.webmanifest', 'shared/avatars.mjs', 'shared/game.js', 'shared/hub.js', 'shared/questions.js', 'shared/util.js', 'js/vendor/peerjs.min.js', 'js/p2p/host.js', 'design-system/index.html']) {
      assert.ok(fs.existsSync(path.join(out, f)), `${f} exists`);
    }
    const config = fs.readFileSync(path.join(out, 'config.js'), 'utf8');
    assert.match(config, /"mode": "p2p"/);
    assert.match(config, /stun:/);
  });

  it('contains no absolute URLs: it must work under /Disputt/ as well as at the root', () => {
    const offenders = [];
    const patterns = [
      /(?:src|href|content)="\/(?!\/)/,
      /url\(\s*['"]?\/(?!\/)/,
      /^\s*(?:import|export)\b[^;\n]*\bfrom\s+['"]\//m,
      /import\(\s*['"]\//,
      /new URL\(\s*['"]\//,
      // paths written as JavaScript strings: they would send a Pages visitor to github.io/… instead of github.io/Disputt/…
      /\bfetch\(\s*['"`]\/(?!\/)/,
      /\b(?:replaceState|pushState)\([^)]*,\s*['"`]\/(?!\/)/,
      /\blocation(?:\.href|\.pathname)?\s*=\s*['"`]\/(?!\/)/,
      /\blocation\.(?:assign|replace)\(\s*['"`]\/(?!\/)/,
      /\bnew (?:Worker|EventSource|SharedWorker)\(\s*['"`]\/(?!\/)/,
    ];
    for (const f of files(out, (p) => /\.(html|css|js|mjs|webmanifest)$/.test(p) && !isVendor(p))) {
      // (404.html's <base href="/Disputt/"> is absolute on purpose: it is what makes the relative URLs work there)
      const text = fs.readFileSync(f, 'utf8').replace(/<base\s[^>]*>/g, '');
      for (const re of patterns) if (re.test(text)) offenders.push(`${rel(f)} matches ${re}`);
    }
    assert.deepEqual(offenders, []);
  });

  it('every module import resolves to a file in the build', () => {
    const missing = [];
    const importRe = /(?:from\s+|import\s*\(\s*|import\s+)['"](\.{1,2}\/[^'"]+)['"]/g;
    for (const f of files(out, (p) => /\.m?js$/.test(p) && !isVendor(p))) {
      const text = fs.readFileSync(f, 'utf8');
      for (const m of text.matchAll(importRe)) {
        const target = path.resolve(path.dirname(f), m[1]);
        if (!fs.existsSync(target)) missing.push(`${rel(f)} -> ${m[1]}`);
      }
    }
    assert.deepEqual(missing, []);
  });

  it('every page carries a strict Content-Security-Policy that allows the signalling server and nothing else', () => {
    const pages = files(out, (p) => p.endsWith('.html'));
    assert.ok(pages.length >= 3);
    for (const page of pages) {
      const html = fs.readFileSync(page, 'utf8');
      const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)?.[1];
      assert.ok(csp, `${rel(page)} has a CSP`);
      assert.match(csp, /script-src 'self'(;|$)/);
      assert.match(csp, /connect-src 'self' wss:\/\/0\.peerjs\.com https:\/\/0\.peerjs\.com(;|$)/);
      assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, `${rel(page)} has no inline scripts`);
    }
  });

  it('serves legacy /j/ABCD links on static hosts through 404.html with the right <base>', () => {
    const html = fs.readFileSync(path.join(out, '404.html'), 'utf8');
    assert.match(html, /<base href="\/Disputt\/">/);
    assert.doesNotMatch(fs.readFileSync(path.join(out, 'index.html'), 'utf8'), /<base /);
  });
});

describe('the terms and the privacy statement', () => {
  const PAGES = ['vilkar.html', 'personvern.html'];
  const PLACEHOLDER = 'KONTAKT-EPOST';
  const page = (name) => fs.readFileSync(path.join(out, name), 'utf8');

  it('are pages of the site that name the seller, and every local link in them leads to a file in the build', () => {
    let local = 0;
    for (const name of PAGES) {
      const html = page(name);
      assert.match(html, /<html lang="nb">/);
      assert.match(html, /Pesom Holding AS/, `${name} names the seller`);
      assert.match(html, /923 729 674/, `${name} gives the organisation number`);
      assert.match(html, /Content-Security-Policy/, `${name} gets the CSP like every other page`);
      for (const [, url] of html.matchAll(/(?:href|src)="([^"#?]+)(?:[?#][^"]*)?"/g)) {
        if (/^(?:https?:|mailto:)/.test(url)) continue;
        local++;
        assert.ok(fs.existsSync(path.join(out, url)), `${name} links to ${url}, which is not in the build`);
      }
    }
    assert.ok(local >= 20, `the link check looked at ${local} local links: has the markup changed so that it sees none?`);
    assert.match(page('vilkar.html'), /href="personvern\.html"/);
    assert.match(page('personvern.html'), /href="vilkar\.html"/);
  });

  it('list the packages and prices the payment server sells', () => {
    const items = [...page('vilkar.html').matchAll(/<li><strong>([^<]+)<\/strong><span>([^<]+)<\/span><\/li>/g)];
    assert.deepEqual(items.map((m) => m[1]), PLANS.map((p) => p.name), 'the same packages as plans.js, in the same order');
    PLANS.forEach((p, i) => {
      assert.ok(items[i][2].startsWith(`${p.price} kr`), `${p.name}: the terms say "${items[i][2]}", plans.js says ${p.price} kr (prices live in four places, see docs/BETALING.md, "Endre priser")`);
      if (p.id !== 'lifetime') assert.ok(items[i][2].includes(p.length), `${p.name}: the terms must say ${p.length}`);
    });
  });

  it('give one contact address: filled in, or the placeholder the Pages workflow refuses to go live with', () => {
    const addresses = PAGES.map((name) => {
      const m = page(name).match(/E-post: <a href="mailto:([^"]+)">([^<]+)<\/a>/);
      assert.ok(m, `${name} has a contact line`);
      assert.equal(m[1], m[2], `${name}: the link and the text show the same address`);
      assert.ok(m[1] === PLACEHOLDER || /^[^@\s<>"]+@[^@\s<>"]+\.[a-z]{2,}$/i.test(m[1]), `${name}: "${m[1]}" is neither an e-mail address nor ${PLACEHOLDER}`);
      return m[1];
    });
    assert.equal(addresses[0], addresses[1], 'both pages give the same address');
    assert.match(fs.readFileSync(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8'), /grep -n 'KONTAKT-EPOST' public\/vilkar\.html public\/personvern\.html/, 'the workflow looks for the placeholder in both pages');
    assert.ok(fs.readFileSync(new URL('../docs/BETALING.md', import.meta.url), 'utf8').includes(`\`${PLACEHOLDER}\``), 'the plan tells the owner about the placeholder');
  });
});

describe('build configuration', () => {
  it('lets a remote server, a self-hosted signalling server and TURN servers be configured', async () => {
    const remote = await buildConfig({ mode: 'server', serverUrl: 'wss://disputt.example/ws' });
    assert.equal(remote.mode, 'server');
    assert.match(contentSecurityPolicy(remote), /connect-src 'self' wss:\/\/disputt\.example(;|$)/);

    const selfHosted = await buildConfig({ mode: 'p2p', peerHost: 'peers.example', peerPort: '443', peerPath: '/peerjs', peerSecure: '1' });
    assert.deepEqual(selfHosted.peer, { host: 'peers.example', port: 443, path: '/peerjs', secure: true });
    assert.match(contentSecurityPolicy(selfHosted), /wss:\/\/peers\.example:443 https:\/\/peers\.example:443/);

    const turn = await buildConfig({ mode: 'p2p', iceServers: JSON.stringify([{ urls: 'turn:t.example', username: 'u', credential: 'c' }]) });
    assert.equal(turn.iceServers[0].urls, 'turn:t.example');
    await assert.rejects(buildConfig({ mode: 'p2p', iceServers: '{"not":"an array"}' }), /JSON array/);
    await assert.rejects(buildConfig({ mode: 'server' }), /--server-url/);
  });
});

describe('payments in the build', () => {
  const KEY = 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE' + 'A'.repeat(86) + '=='; // (the shape of a P-256 public key; only the shape is checked here)

  it('are off unless the payment server and its key are both given, and then only add that server to the CSP', async () => {
    const off = await buildConfig({ mode: 'p2p' });
    assert.equal(off.payments, null);
    assert.doesNotMatch(contentSecurityPolicy(off), /workers\.dev/);

    const on = await buildConfig({ mode: 'p2p', paymentsUrl: 'https://disputt-pay.example.workers.dev', paymentsKey: KEY });
    assert.deepEqual(on.payments, { apiUrl: 'https://disputt-pay.example.workers.dev', publicKey: KEY, methods: ['applepay'], freeRounds: 2 });
    assert.match(contentSecurityPolicy(on), /connect-src 'self' wss:\/\/0\.peerjs\.com https:\/\/0\.peerjs\.com https:\/\/disputt-pay\.example\.workers\.dev(;|$)/);
    assert.match(contentSecurityPolicy(on), /script-src 'self'(;|$)/);

    const more = await buildConfig({ mode: 'p2p', paymentsUrl: 'https://pay.example.com/', paymentsKey: KEY, paymentsMethods: 'vipps,applepay', freeRounds: '3', termsUrl: 'https://example.com/vilkar', privacyUrl: 'https://example.com/personvern' });
    assert.deepEqual(more.payments, { apiUrl: 'https://pay.example.com', publicKey: KEY, methods: ['vipps', 'applepay'], freeRounds: 3, termsUrl: 'https://example.com/vilkar', privacyUrl: 'https://example.com/personvern' });
  });

  it('refuse half a set-up and anything that could break out of the CSP', async () => {
    await assert.rejects(buildConfig({ mode: 'p2p', paymentsUrl: 'https://pay.example.com' }), /both/);
    await assert.rejects(buildConfig({ mode: 'p2p', paymentsKey: KEY }), /both/);
    for (const bad of [
      { paymentsUrl: 'http://pay.example.com' }, // not https (only localhost may be plain http)
      { paymentsUrl: 'https://pay.example.com/path' },
      { paymentsUrl: 'https://pay.example.com/?x=1' },
      { paymentsUrl: 'https://user:pw@pay.example.com' },
      { paymentsUrl: 'https://pay.example.com; script-src *' },
      { paymentsUrl: 'https://pa"y.example.com' },
      { paymentsKey: 'not base64!' },
      { paymentsKey: 'abc' },
      { paymentsMethods: 'vipps,bitcoin' },
      { paymentsMethods: 'vipps;applepay' },
      { freeRounds: '-1' },
      { freeRounds: 'two' },
      { freeRounds: '0' }, // (the packages come at "Neste runde", so the first round is free whatever is set)
      { freeRounds: '100' },
      { termsUrl: 'http://example.com/vilkar' },
      { termsUrl: 'javascript:alert(1)' },
      { privacyUrl: 'https://example.com/"onmouseover=x' },
    ]) {
      await assert.rejects(buildConfig({ mode: 'p2p', paymentsUrl: 'https://pay.example.com', paymentsKey: KEY, ...bad }), Error, `should refuse ${JSON.stringify(bad)}`);
    }
    // the same method twice is one button, not two
    const twice = await buildConfig({ mode: 'p2p', paymentsUrl: 'https://pay.example.com', paymentsKey: KEY, paymentsMethods: 'vipps,vipps,applepay' });
    assert.deepEqual(twice.payments.methods, ['vipps', 'applepay']);
    // and not with a Disputt server, where a host who leaves for a few minutes is replaced
    await assert.rejects(buildConfig({ mode: 'server', serverUrl: 'wss://disputt.example/ws', paymentsUrl: 'https://pay.example.com', paymentsKey: KEY }), /peer-to-peer/);
    // a payment server on localhost may be plain http (the tests use one)
    const local = await buildConfig({ mode: 'p2p', paymentsUrl: 'http://127.0.0.1:8787', paymentsKey: KEY });
    assert.equal(local.payments.apiUrl, 'http://127.0.0.1:8787');
  });

  it('can come from the environment, like the other settings, and is written to config.js', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'disputt-pay-'));
    try {
      await build(['--out', dir, '--base', '/Disputt/'], { DISPUTT_PAYMENTS_URL: 'https://pay.example.com', DISPUTT_PAYMENTS_KEY: KEY, DISPUTT_PAYMENTS_METHODS: 'vipps,applepay' });
      const config = fs.readFileSync(path.join(dir, 'config.js'), 'utf8');
      assert.match(config, /"payments": \{/);
      assert.match(config, /"apiUrl": "https:\/\/pay\.example\.com"/);
      assert.match(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), /connect-src [^;"]*https:\/\/pay\.example\.com/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the payment demo in the build', () => {
  const KEY = 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE' + 'A'.repeat(86) + '==';

  it('is not in an ordinary build', () => {
    assert.ok(!fs.existsSync(path.join(out, 'demo')), 'no demo folder');
    assert.doesNotMatch(fs.readFileSync(path.join(out, 'config.js'), 'utf8'), /demo/);
  });

  it('is off unless asked for, and then needs no payment server', async () => {
    assert.equal((await buildConfig({ mode: 'p2p' })).payments, null);
    for (const on of [true, '1', 'true', 'TRUE', 'yes', 'on']) {
      assert.deepEqual((await buildConfig({ mode: 'p2p', paymentsDemo: on })).payments, { demo: true, methods: ['applepay'], freeRounds: 2 }, `on for ${JSON.stringify(on)}`);
    }
    for (const off of ['0', 'false', 'no', 'off', undefined]) {
      assert.equal((await buildConfig({ mode: 'p2p', paymentsDemo: off })).payments, null, `off for ${JSON.stringify(off)}`);
    }
    const more = await buildConfig({ mode: 'p2p', paymentsDemo: '1', paymentsMethods: 'vipps,applepay', freeRounds: '3' });
    assert.deepEqual(more.payments, { demo: true, methods: ['vipps', 'applepay'], freeRounds: 3 });
  });

  it('does not go with a real payment server, a Disputt server, or values that do not belong', async () => {
    await assert.rejects(buildConfig({ mode: 'p2p', paymentsDemo: '1', paymentsUrl: 'https://pay.example.com', paymentsKey: KEY }), /cannot be combined/);
    await assert.rejects(buildConfig({ mode: 'p2p', paymentsDemo: '1', paymentsKey: KEY }), /cannot be combined/);
    await assert.rejects(buildConfig({ mode: 'server', serverUrl: 'wss://disputt.example/ws', paymentsDemo: '1' }), /peer-to-peer/);
    await assert.rejects(buildConfig({ mode: 'p2p', paymentsDemo: 'maybe' }), /payments demo/);
    await assert.rejects(buildConfig({ mode: 'p2p', paymentsDemo: '1', paymentsMethods: 'bitcoin' }), Error);
    await assert.rejects(buildConfig({ mode: 'p2p', paymentsDemo: '1', freeRounds: '0' }), Error);
  });

  it('can come from the environment, and every module of the demo finds what it imports', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'disputt-demo-env-'));
    try {
      await build(['--out', dir, '--base', '/Disputt-test/'], { DISPUTT_PAYMENTS_DEMO: '1', DISPUTT_PAYMENTS_METHODS: 'vipps,applepay' });
      assert.match(fs.readFileSync(path.join(dir, 'config.js'), 'utf8'), /"demo": true/);
      const importRe = /(?:from\s+|import\s*\(\s*|import\s+)['"](\.{1,2}\/[^'"]+)['"]/g;
      let seen = 0;
      for (const f of files(path.join(dir, 'demo'), (p) => /\.js$/.test(p))) {
        for (const m of fs.readFileSync(f, 'utf8').matchAll(importRe)) {
          seen++;
          assert.ok(fs.existsSync(path.resolve(path.dirname(f), m[1])), `${path.relative(dir, f)} imports ${m[1]}`);
        }
      }
      assert.ok(seen >= 4, `looked at ${seen} imports of the demo`);
      // (a repository variable that is not set reaches the build as an empty text: that is off)
      await build(['--out', dir, '--base', '/Disputt-test/'], { DISPUTT_PAYMENTS_DEMO: '' });
      assert.ok(!fs.existsSync(path.join(dir, 'demo')), 'an empty variable is not a demo');
      // the page loads the demo through a path that is worked out when it runs, so it is looked for here
      assert.match(fs.readFileSync(path.join(dir, 'js', 'main.js'), 'utf8'), /new URL\('\.\.\/demo\/demo\.js', import\.meta\.url\)/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('build settings from repository variables are checked, not trusted', () => {
  const attempt = (argv, env = {}) => build(['--out', path.join(os.tmpdir(), `disputt-bad-${process.pid}`), ...argv], env);

  it('refuses values that could break out of the HTML attributes or the CSP', async () => {
    for (const bad of [
      ['--peer-host', 'peer.example.com"><script>alert(1)</script>'],
      ['--peer-host', "peer.example.com; script-src *"],
      ['--peer-host', 'peer example.com'],
      ['--peer-port', '443; img-src *'],
      ['--peer-port', '70000'],
      ['--peer-path', '/peerjs"'],
      ['--base', '/Disputt"><script>x</script>/'],
      ['--base', '/Disputt'], // must end with a slash
      ['--base', 'https://evil.example/'],
      ['--mode', 'server', '--server-url', 'https://example.com/ws'], // not a WebSocket address
      ['--mode', 'server', '--server-url', 'wss://exa"mple.com/ws'],
    ]) {
      await assert.rejects(attempt(bad), Error, `should refuse ${JSON.stringify(bad)}`);
    }
    await assert.rejects(attempt(['--peer-host', 'x'], { DISPUTT_PEER_PORT: '1 2' }), Error, 'the same checks apply to environment variables');
  });

  it('accepts ordinary values and puts them in the CSP', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'disputt-ok-'));
    try {
      const r = await build(['--out', dir, '--base', '/Disputt/', '--peer-host', 'peer.example.com', '--peer-port', '9000', '--peer-path', '/peerjs', '--peer-secure', '1'], {});
      const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
      assert.match(html, /connect-src 'self' wss:\/\/peer\.example\.com:9000 https:\/\/peer\.example\.com:9000/);
      assert.equal(r.config.peer.host, 'peer.example.com');
      assert.match(fs.readFileSync(path.join(dir, '404.html'), 'utf8'), /<base href="\/Disputt\/">/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
