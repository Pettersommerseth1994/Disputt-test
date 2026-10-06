// Just enough Liquid to try out the files in shopify/ without a Shopify: {% comment %}, {% if x.y %}…{% else %}…{% endif %}, and
// {{ x.y }} with the filter `escape`. Anything else is an error, so the files stay within what is tried here. (Shopify's own Liquid
// is the real thing: this only catches a tag that is not closed, a name that is not set, and text that would come out wrong.)

const TOKENS = /({%-?[\s\S]*?-?%}|{{-?[\s\S]*?-?}})/;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const lookup = (vars, path) => path.split('.').reduce((value, key) => (value === undefined || value === null ? undefined : value[key]), vars);
/** In Liquid only nil and false are false: an empty text is true. */
const truthy = (value) => value !== undefined && value !== null && value !== false;

export function renderLiquid(source, vars = {}) {
  const tokens = source.split(TOKENS);
  let i = 0;
  /** The text up to the end of the block that `stops` names; returns what stopped it. */
  function block(stops, on = true) {
    let out = '';
    while (i < tokens.length) {
      const token = tokens[i++];
      if (token.startsWith('{{')) {
        const [name, ...filters] = token.replace(/^{{-?|-?}}$/g, '').split('|').map((s) => s.trim());
        for (const f of filters) if (f !== 'escape') throw new Error(`miniliquid: the filter "${f}" is not tried here`);
        if (!/^[a-z_][a-z0-9_.]*$/i.test(name)) throw new Error(`miniliquid: "${name}" is not a name`);
        const value = lookup(vars, name);
        if (on) {
          if (!truthy(value)) throw new Error(`miniliquid: "${name}" is not set`);
          out += filters.includes('escape') ? esc(value) : String(value);
        }
      } else if (token.startsWith('{%')) {
        const tag = token.replace(/^{%-?|-?%}$/g, '').trim();
        const word = tag.split(/\s+/)[0];
        if (stops.includes(word)) return { out, stop: word };
        if (word === 'comment') block(['endcomment'], false);
        else if (word === 'if') {
          const name = tag.slice(2).trim();
          if (!/^[a-z_][a-z0-9_.]*$/i.test(name)) throw new Error(`miniliquid: "{% ${tag} %}" is more than a name`);
          const yes = truthy(lookup(vars, name));
          const first = block(['else', 'endif'], on && yes);
          out += first.out;
          if (first.stop === 'else') {
            const second = block(['endif'], on && !yes);
            if (second.stop !== 'endif') throw new Error('miniliquid: an {% if %} that is never closed');
            out += second.out;
          } else if (first.stop !== 'endif') throw new Error('miniliquid: an {% if %} that is never closed');
        } else throw new Error(`miniliquid: the tag "${word}" is not tried here`);
      } else if (on) out += token;
    }
    if (stops.length) throw new Error(`miniliquid: a block that is never closed (waiting for ${stops.join(' or ')})`);
    return { out, stop: null };
  }
  return block([]).out;
}
