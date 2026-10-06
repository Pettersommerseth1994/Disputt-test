// A pretend Shopify, for the tests and the QA tools: what Shopify sends to the payment server (payments/worker-shopify.js) when an
// order is paid, cancelled or refunded, signed the way Shopify signs it. The fields are the ones of the REST order that webhooks
// carry (https://shopify.dev/docs/api/admin-rest/latest/resources/order); the Worker reads a few of them and ignores the rest.
export const SECRET = 'shpss_qa_signing_secret';
export const SHOP = 'https://shop.example.test';
/** Like the real ones: numbers of 14 digits. */
export const VARIANTS = { evening: '44000000000001', year: '44000000000002', lifetime: '44000000000003' };
export const PRICES = { evening: '149.00', year: '399.00', lifetime: '499.00' };
export const CODE = 'K7M2-9QXD-4TRB';

let nextOrder = 1001;
let nextId = 5_800_000_000_000;

/**
 * An order as Shopify sends it with the topic orders/paid. Everything can be overridden, and `lines` replaces the one product that
 * `plan` stands for (a list of { plan | variant_id, quantity }).
 */
export function order({ plan = 'year', code = CODE, consent = true, id, name, test = false, status = 'paid', paidAt = new Date(), currency = 'NOK', price, attributes, lines, cancelledAt = null } = {}) {
  const number = nextOrder++;
  const items = (lines ?? [{ plan }]).map((l, i) => ({
    id: nextId + i,
    variant_id: l.variant_id === undefined ? Number(VARIANTS[l.plan]) : l.variant_id,
    product_id: 7_700_000_000_000,
    title: `Disputt – ${l.plan ?? 'annet'}`,
    quantity: l.quantity ?? 1,
    price: PRICES[l.plan] ?? '10.00',
  }));
  const total = price ?? items.reduce((sum, l) => sum + Number(l.price) * l.quantity, 0).toFixed(2);
  return {
    id: id ?? 5_800_000_000_000 + number,
    name: name ?? `#${number}`,
    created_at: new Date(+paidAt).toISOString().replace('Z', '+00:00'),
    processed_at: new Date(+paidAt).toISOString().replace('Z', '+00:00'),
    currency,
    total_price: total,
    current_total_price: total,
    financial_status: status,
    cancelled_at: cancelledAt,
    test,
    // (what the page puts in the cart: the code, and the time the host agreed to getting the access at once)
    note_attributes: attributes ?? [...(code ? [{ name: 'kode', value: code }] : []), ...(consent ? [{ name: 'samtykke', value: new Date(+paidAt - 20_000).toISOString() }] : [])],
    line_items: items,
    // (what a real order also carries, and the Worker must not need or keep)
    email: 'kunde@example.com',
    customer: { first_name: 'Kari', last_name: 'Nordmann' },
  };
}

/** A refund (the topic refunds/create): `amount` in kroner as text, like Shopify. */
export const refund = (orderId, amount, { id, kind = 'refund', status = 'success', currency = 'NOK' } = {}) => ({
  id: id ?? nextId++,
  order_id: orderId,
  transactions: amount === null ? [] : [{ id: nextId++, order_id: orderId, amount, kind, status, currency }],
});

/** A chargeback (the topic disputes/create). */
export const dispute = (orderId, { id } = {}) => ({ id: id ?? nextId++, order_id: orderId, type: 'chargeback', amount: '399.00', currency: 'NOK', status: 'needs_response' });

/** Shopify's signature: HMAC-SHA256 of the body with the signing secret, in base64. */
export async function sign(body, secret = SECRET) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  return Buffer.from(await crypto.subtle.sign('HMAC', key, bytes)).toString('base64');
}

/** The request Shopify makes to a webhook address (a POST with the topic, the shop and the signature in headers). */
export async function webhookRequest(url, topic, payload, { secret = SECRET, signature, headers = {} } = {}) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return new Request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Topic': topic,
      'X-Shopify-Shop-Domain': 'disputt-test.myshopify.com',
      'X-Shopify-Hmac-Sha256': signature ?? (await sign(body, secret)),
      'X-Shopify-API-Version': '2025-07',
      ...headers,
    },
    body,
  });
}

/** The address of the cart link the page opens for a package (what a real Shopify turns into a checkout), as a URL object. */
export const cartLink = (plan, attributes = {}) => {
  const url = new URL(`${SHOP}/cart/${VARIANTS[plan]}:1`);
  for (const [k, v] of Object.entries(attributes)) url.searchParams.set(`attributes[${k}]`, v);
  return url;
};
