import 'dotenv/config';
import { readFileSync } from 'node:fs';

/**
 * Printify: turns a design into a real product (shirt, mug) that Printify prints and ships,
 * and publishes it to your Etsy shop through Printify's Etsy connection.
 *
 * .env:
 *   PRINTIFY_API_TOKEN=a personal access token from Printify > My account > Connections
 *   PRINTIFY_SHOP_ID=optional; otherwise the shop connected to Etsy is used
 */
const API = 'https://api.printify.com/v1';

function token() {
  const t = process.env.PRINTIFY_API_TOKEN?.trim();
  if (!t) throw new Error('Printify isn’t set up yet: add PRINTIFY_API_TOKEN to .env (see README, "AI Enterprizes Etsy shop").');
  return t;
}

async function pfy<T = any>(method: string, path: string, json?: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(API + path, {
      method,
      headers: { Authorization: `Bearer ${token()}`, 'User-Agent': 'SlaveBase/1.0', ...(json ? { 'Content-Type': 'application/json' } : {}) },
      body: json ? JSON.stringify(json) : undefined,
    });
    if (res.status === 429 && attempt < 3) { await new Promise((r) => setTimeout(r, 4000 * (attempt + 1))); continue; }
    const text = await res.text();
    if (!res.ok) throw new Error(`Printify ${method} ${path} failed (${res.status}): ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : {}) as T;
  }
}

let shopId: number | null = null;
async function shop() {
  if (shopId) return shopId;
  if (process.env.PRINTIFY_SHOP_ID) return (shopId = Number(process.env.PRINTIFY_SHOP_ID));
  const shops = await pfy<{ id: number; title: string; sales_channel: string }[]>('GET', '/shops.json');
  const etsy = shops.find((s) => s.sales_channel === 'etsy');
  if (!etsy) throw new Error('Connect your Etsy shop in Printify first (Printify > My stores > Add new store > Etsy).');
  return (shopId = etsy.id);
}

/**
 * Product presets: which Printify catalog item to use and which variants to turn on.
 * The catalog is searched by name, so this keeps working if Printify renumbers things.
 */
const PRESETS = {
  tshirt: { find: [/unisex.*jersey.*short sleeve tee/i, /unisex.*heavy cotton tee/i], sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL'], min: 22, position: 'front' },
  mug: { find: [/ceramic mug.*11/i, /mug.*11\s?oz/i, /^mug/i], sizes: [] as string[], min: 16, position: 'front' },
} as const;
export type PrintifyProduct = keyof typeof PRESETS;

async function catalogItem(kind: PrintifyProduct, colors: string[]) {
  const p = PRESETS[kind];
  const blueprints = await pfy<{ id: number; title: string }[]>('GET', '/catalog/blueprints.json');
  const bp = p.find.map((re) => blueprints.find((b) => re.test(b.title))).find(Boolean);
  if (!bp) throw new Error(`Couldn’t find a ${kind} in Printify’s catalog.`);
  const providers = await pfy<{ id: number; title: string }[]>('GET', `/catalog/blueprints/${bp.id}/print_providers.json`);
  // Try providers until one has the colors we want.
  for (const pp of providers.slice(0, 6)) {
    const v = await pfy<{ variants: { id: number; title: string; options: Record<string, string> }[] }>('GET', `/catalog/blueprints/${bp.id}/print_providers/${pp.id}/variants.json`);
    const want = colors.map((c) => c.toLowerCase());
    const picked = v.variants.filter((x) => {
      const color = (x.options.color ?? '').toLowerCase(), size = x.options.size ?? '';
      const colorOk = !want.length || want.includes(color);
      const sizeOk = !p.sizes.length || (p.sizes as readonly string[]).includes(size);
      return colorOk && sizeOk;
    });
    if (picked.length) return { blueprint: bp, provider: pp, variants: picked.slice(0, 100) };
  }
  throw new Error(`No ${kind} print provider has those colors (${colors.join(', ')}). Try common ones like White, Black, Natural, Heather Grey.`);
}

export async function createProduct(o: {
  kind: PrintifyProduct; title: string; description: string; tags: string[]; price: number; colors: string[]; printPng: string; publish: boolean;
}) {
  const s = await shop();
  const item = await catalogItem(o.kind, o.colors);
  const upload = await pfy<{ id: string }>('POST', '/uploads/images.json', { file_name: o.printPng.split('/').pop(), contents: readFileSync(o.printPng).toString('base64') });
  const cents = Math.round(Math.max(o.price, PRESETS[o.kind].min) * 100);
  const ids = item.variants.map((v) => v.id);
  const product = await pfy<{ id: string; variants: { id: number; cost: number; price: number; is_enabled: boolean }[] }>('POST', `/shops/${s}/products.json`, {
    title: o.title, description: o.description, tags: o.tags,
    blueprint_id: item.blueprint.id, print_provider_id: item.provider.id,
    variants: ids.map((id) => ({ id, price: cents, is_enabled: true })),
    print_areas: [{ variant_ids: ids, placeholders: [{ position: PRESETS[o.kind].position, images: [{ id: upload.id, x: 0.5, y: 0.5, scale: 1, angle: 0 }] }] }],
  });
  // Make sure every size still makes money after Printify's cost and Etsy's ~10% in fees.
  const full = await pfy<{ variants: { id: number; cost: number; price: number; is_enabled: boolean }[] }>('GET', `/shops/${s}/products/${product.id}.json`);
  const fixed = full.variants.filter((v) => v.is_enabled).map((v) => ({ id: v.id, price: Math.max(v.price, Math.ceil((v.cost * 1.35 + 45) / 100) * 100 - 1), is_enabled: true }));
  if (fixed.some((f, i) => f.price !== full.variants.filter((v) => v.is_enabled)[i].price)) {
    await pfy('PUT', `/shops/${s}/products/${product.id}.json`, { variants: fixed });
  }
  if (o.publish) {
    await pfy('POST', `/shops/${s}/products/${product.id}/publish.json`, { title: true, description: true, images: true, variants: true, tags: true, keyFeatures: true, shipping_template: true });
  }
  const prices = fixed.map((f) => f.price / 100);
  return {
    product_id: product.id, provider: item.provider.title, blueprint: item.blueprint.title, variants: fixed.length,
    price_range: `$${Math.min(...prices).toFixed(2)}–$${Math.max(...prices).toFixed(2)}`,
    state: o.publish ? 'publishing to Etsy (shows up in a few minutes)' : 'saved in Printify, not published',
    printify_url: `https://printify.com/app/store/products/${product.id}`,
  };
}
