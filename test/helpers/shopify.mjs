// Loads payments/worker-shopify.js for the tests. The file that is deployed has only a default export (a Worker is pasted into
// Cloudflare as it is), so the tests load a copy of the same text that also exposes the inside.
import { readFileSync } from 'node:fs';
import { createFakeD1 } from '../../tools/qa/fakedb.mjs';
import { SECRET, SHOP, VARIANTS, order, webhookRequest } from '../../tools/qa/fakeshopify.mjs';
import { ORIGIN, SITE, WORKER, makeKeys } from './worker.mjs';

const source = readFileSync(new URL('../../payments/worker-shopify.js', import.meta.url), 'utf8');
if (source.split('export default {').length !== 2) throw new Error('payments/worker-shopify.js must have exactly one "export default {"');
const exposed = `${source.replace('export default {', 'const worker = {')}\nexport { worker, PLANS, normalizeCode, signPass, bytesToB64url };\n`;
export const mod = await import(`data:text/javascript;base64,${Buffer.from(exposed).toString('base64')}`);
export { ORIGIN, SECRET, SHOP, SITE, VARIANTS, WORKER };

/** A Worker environment with everything set, a pretend database, and a way to call the Worker like the browser and like Shopify do. */
export async function setupShopify(overrides = {}) {
  const keys = await makeKeys();
  const db = createFakeD1();
  const env = {
    DB: db,
    SHOPIFY_WEBHOOK_SECRET: SECRET,
    JWT_PRIVATE_KEY: keys.privateKey,
    SITE_URL: SITE,
    SHOP_URL: `${SHOP}/`,
    VARIANT_EVENING: VARIANTS.evening,
    VARIANT_YEAR: VARIANTS.year,
    VARIANT_LIFETIME: VARIANTS.lifetime,
    ...overrides,
  };
  const call = (path, { method = 'GET', body, origin = ORIGIN } = {}) =>
    mod.worker.fetch(
      new Request(`${WORKER}${path}`, {
        method,
        headers: { ...(origin ? { Origin: origin } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env,
    );
  /** Shopify calls the webhook: no Origin, a signature, a topic. */
  const deliver = async (topic, payload, options) => mod.worker.fetch(await webhookRequest(`${WORKER}/shopify/webhook`, topic, payload, options), env);
  /** A paid order, delivered; returns the order and what the Worker answered. */
  const pay = async (options) => {
    const o = order(options);
    return { order: o, res: await deliver('orders/paid', o) };
  };
  return { env, db, keys, call, deliver, pay };
}
