// Things in the style sheets that a picture of one screen will not catch, and that have gone wrong before.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';

const css = (name) => fs.readFileSync(new URL(`../public/css/${name}`, import.meta.url), 'utf8');
/** The declarations of the first rule that starts a line with exactly this selector (so `.dock` is not `.dock::before`). */
const rule = (text, selector) => {
  const found = text.match(new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm'));
  assert.ok(found, `a rule for ${selector}`);
  return found[1];
};

describe('the bar at the bottom of a screen (.dock)', () => {
  const base = css('base.css');

  it('is solid, and has the texture of the page', () => {
    const bar = rule(base, '.dock');
    assert.match(bar, /background:\s*var\(--tex-grain\),\s*var\(--dock-tex\),\s*var\(--page-bg\)\s*;/, 'texture on top of an opaque colour as the last layer');
  });

  it('fades into the page with the bar\'s own texture, through a mask, not with a flat colour gradient', () => {
    // (a plain `linear-gradient(to top, var(--page-bg), transparent)` showed as a smooth strip across the textured page, with a seam
    // where the bar's own texture began)
    const fade = rule(base, '.dock::before');
    assert.match(fade, /background:\s*var\(--tex-grain\),\s*var\(--dock-tex\),\s*var\(--page-bg\)\s*;/, 'the same layers as the bar');
    assert.match(fade, /(?<!-webkit-)mask-image:\s*var\(--fade-mask\)\s*;/);
    assert.match(fade, /-webkit-mask-image:\s*var\(--fade-mask\)\s*;/, 'and for Safari before 15.4');
    assert.doesNotMatch(fade, /linear-gradient/, 'no colour gradient of its own');
    assert.match(fade, /pointer-events:\s*none/, 'a tap goes through to what scrolls under it');
  });

  it('has its mask where the raw values live, and the mask fades out at the top', () => {
    const mask = css('tokens.css').match(/--fade-mask:\s*(linear-gradient\([^;]*\));/)?.[1];
    assert.ok(mask, 'tokens.css defines --fade-mask');
    assert.match(mask, /^linear-gradient\(to top, #000 0%/, 'opaque next to the bar');
    assert.match(mask, /transparent 100%\)$/, 'and gone at the top');
  });
});

describe('the toast', () => {
  const toast = rule(css('components.css'), '.toast');

  it('is centred without a transform, which its animation would replace', () => {
    // (it was once centred with translateX(-50%); the animation sets transform itself and ran every toast off the right edge)
    assert.doesNotMatch(toast, /transform:/);
    assert.match(toast, /left:\s*0\s*;/);
    assert.match(toast, /right:\s*0\s*;/);
    assert.match(toast, /margin:\s*0 auto\s*;/);
    assert.match(toast, /pointer-events:\s*none/, 'and lets taps through');
  });

  it('comes down from above, and the animation it names exists', () => {
    const name = toast.match(/animation:\s*([\w-]+)/)?.[1];
    assert.equal(name, 'drop');
    const base = css('base.css');
    const at = base.indexOf(`@keyframes ${name}`);
    assert.ok(at >= 0, `@keyframes ${name} exists`);
    assert.match(base.slice(at, at + 160), /from\s*\{\s*transform:\s*translateY\(calc\(-100%/, 'it starts above its own place');
  });
});
