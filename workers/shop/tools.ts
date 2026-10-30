import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { findHotShops, topListings, findCategory, createDigitalListing, myListingsReport, updateShopProfile, shopListings, listingDetails, updateListingFields, updateListingPrice, replaceListingImages, replaceListingFiles, type ListingState } from './etsy';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createProduct } from './printify';
import { makeDesign, checkSvg, KINDS, FONTS, SHOP_DIR, ARTWORK_DIR, BACKGROUNDS_DIR, listBackgrounds, remakePhotos, addPhoto, renderPng, withArtwork, type Kind } from './design';
import { generateImage, imageReady, imagesToday, imageLimit, extFor, type Aspect } from './imagegen';
import { brandProblems, cleanListing } from './guard';
import { record, publishedToday, dailyLimit, autoPublish, readLedger } from './ledger';

/**
 * The tools AI Enterprizes agents get for running the Etsy shop.
 * Each one is a plain function the agent can call; errors come back as text so the agent can fix and retry.
 */
const ok = (data: unknown) => ({ content: [{ type: 'text' as const, text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] });
const fail = (msg: string) => ({ content: [{ type: 'text' as const, text: `Didn't work: ${msg}` }], isError: true });
const safe = <A,>(fn: (a: A) => Promise<ReturnType<typeof ok>>) => async (a: A) => { try { return await fn(a); } catch (e) { return fail((e as Error).message); } };

function design(id: string) {
  const file = join(SHOP_DIR, 'designs', id, 'meta.json');
  if (!existsSync(file)) throw new Error(`No design called "${id}". Use the design_id that shop_make_design returned.`);
  return JSON.parse(readFileSync(file, 'utf8')) as { design_id: string; kind: Kind; title: string; files: { path: string; name: string }[]; images: { path: string; name: string }[] };
}
const svgOf = (id: string) => readFileSync(join(SHOP_DIR, 'designs', id, 'design.svg'), 'utf8');
const visibleText = (svg: string) => [...svg.matchAll(/>([^<>]+)</g)].map((m) => m[1]).join(' ');

const DIGITAL_FOOTER = (kind: Kind) => {
  const k = KINDS[kind];
  return [
    '',
    '━━━━━━━━━━━━━━━━━━',
    'WHAT YOU GET',
    '• Editable PDF: open it in Canva (a free account works) to change any text or color',
    ...k.png.map((p) => `• High-resolution PNG, ${p.w} × ${p.h} px (300 dpi)`),
    ...(k.svgFile ? ['• SVG cut file for Cricut, Silhouette and other cutting machines'] : []),
    '',
    'HOW TO EDIT IN CANVA',
    '1. Download your files from Etsy (Purchases and reviews > Download files).',
    '2. In Canva, click Create > Import file and choose the PDF.',
    '3. Click any text or shape to change it, then download as PDF Print or PNG.',
    '',
    'PLEASE NOTE',
    '• This is a digital download. Nothing will be shipped.',
    '• Colors can look slightly different on screens and printers.',
    '• For personal use. Please don’t resell or share the files.',
    '• Designed by our shop with the help of AI tools. Not affiliated with Canva.',
  ].join('\n');
};
/** Until the owner turns it off, digital listings need real-photo listing photos (not the drawn ones) before they go live. */
const needPhotos = () => (process.env.SHOP_REQUIRE_PHOTO_MOCKUPS ?? 'true').toLowerCase() !== 'false';
const NO_TEXT = 'Absolutely no text, letters, numbers, words, signatures, logos or watermarks anywhere in the image.';
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'image';
const stamp = () => new Date().toISOString().slice(0, 10);
const rand = () => Math.random().toString(36).slice(2, 6);

/** Every edit is logged with what it was before, so the owner can see and undo changes (output/shop/Edit log.md, also in Drive). */
const SEP = '━━━━━━━━━━━━━━━━━━';
function logEdit(e: { listing_id: number; title: string; by: string; changes: Record<string, { before: unknown; after: unknown }>; reason: string }) {
  mkdirSync(SHOP_DIR, { recursive: true });
  const jsonFile = join(SHOP_DIR, 'edits.json');
  const all = existsSync(jsonFile) ? JSON.parse(readFileSync(jsonFile, 'utf8')) : [];
  all.push({ at: new Date().toISOString(), ...e });
  writeFileSync(jsonFile, JSON.stringify(all, null, 2));
  const show = (v: unknown) => (Array.isArray(v) ? v.join(', ') : String(v ?? '')).replace(/\n+/g, ' ').slice(0, 300);
  const md = ['# Etsy edit log', '', 'Every change the agents made to live listings, newest first, with what it was before.', '',
    ...all.slice().reverse().flatMap((x: any) => [
      `## ${x.at.slice(0, 16).replace('T', ' ')} · ${x.title}`, `[Listing ${x.listing_id}](https://www.etsy.com/listing/${x.listing_id}) · by ${x.by} · ${x.reason}`, '',
      ...Object.entries(x.changes).map(([k, v]: [string, any]) => `- **${k}:** ${show(v.before)} → ${show(v.after)}`), '']),
  ].join('\n');
  writeFileSync(join(SHOP_DIR, 'Edit log.md'), md);
}

const PRINT_FOOTER = '\n\nPrinted and shipped by our production partner, Printify. Designed by our shop with the help of AI tools.';

export const SHOP_TOOLS = [
  'shop_guide', 'shop_find_hot_shops', 'shop_top_listings', 'shop_categories', 'shop_make_design', 'shop_publish_digital', 'shop_publish_printify', 'shop_report', 'shop_update_profile',
  'shop_make_artwork', 'shop_make_background', 'shop_backgrounds', 'shop_remake_photos', 'shop_ai_mockup',
  'shop_listings', 'shop_get_listing', 'shop_edit_listing', 'shop_update_listing_media',
].map((n) => `mcp__shop__${n}`);

export const shopServer = () => createSdkMcpServer({
  name: 'shop',
  version: '1.0.0',
  instructions: 'Tools for the AI Enterprizes Etsy shop. Call shop_guide first to see product types, sizes, fonts and the rules.',
  tools: [
    tool('shop_guide', 'Product types with their exact SVG sizes, the fonts you may use, and the shop rules. Read this before designing.', {}, safe(async () => ok({
      product_types: Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, { what: v.label, svg_viewBox: `0 0 ${v.w} ${v.h}`, transparent_background: v.transparent, sold_as: v.branding ? 'shop branding: the owner uploads it to Etsy' : v.digital ? 'digital download on Etsy (with Canva-editable PDF)' : 'physical product via Printify', tips: v.hint }])),
      fonts: Object.fromEntries(Object.entries(FONTS).map(([f, v]) => [f, v.use])),
      svg_rules: [
        'Vector shapes and <text>, plus AI artwork from shop_make_artwork as <image href="artwork:ARTWORK_ID" x=".." y=".." width=".." height=".." preserveAspectRatio="xMidYMid slice"/>. No other images, outside links or web fonts.',
        'Set fonts as attributes on each text element: font-family="Montserrat" font-weight="700" (font-style="italic" only for Playfair Display).',
        'Keep words as real <text> (not paths) so buyers can edit them in Canva.',
        'Leave a safe margin of about 6% around the edges.',
      ],
      artwork_and_photos: imageReady() ? [
        'For illustrated designs (watercolor, gouache, hand-drawn food, florals, table scenes): 1) shop_make_artwork with a detailed art prompt and NO words in it, 2) Read the image, 3) build the SVG with the artwork as an <image> layer and ALL words as real <text> on top (so buyers edit them in Canva), 4) shop_make_design.',
        'Leave space in the artwork for the text: describe where (e.g. "illustration in the bottom half, plain cream paper in the top half").',
        'Listing photos: pass 2–4 backgrounds (see shop_backgrounds; make new ones with shop_make_background) to shop_make_design, or use shop_remake_photos on an existing design. shop_ai_mockup makes a lifestyle photo (e.g. a hand holding the card): always Read it and compare every word with the design; if anything changed, run shop_remake_photos to drop it.',
        `Images cost money: ${imagesToday()}/${imageLimit()} used today. Make each prompt count; reuse backgrounds across listings.`,
        ...(needPhotos() ? ['Digital listings can only go live with real-photo listing photos (backgrounds or an AI mockup).'] : []),
      ] : ['AI artwork isn’t set up yet (the owner needs to add GEMINI_API_KEY). Use vector shapes and text.'],
      shop_rules: [
        'Designs must be original. Learn from what sells (niche, style, colors, wording, price), never copy another shop’s design or wording.',
        'No brands, characters, celebrities, sports teams, or song and movie quotes.',
        'Listings automatically say the design was made with AI help, and that Printify makes physical products.',
        'Editing: shop_listings shows what is live, draft or deactivated right now; shop_get_listing shows one in full; shop_edit_listing changes title, description, tags, price or live/off; shop_update_listing_media swaps photos or files. Every edit is logged. Listings can’t be deleted.',
        `Publishing: ${autoPublish() ? `automatic, up to ${dailyLimit()} new listings a day; after that they are saved as drafts` : 'saved as drafts for the owner to publish'}. Published today: ${publishedToday()}.`,
      ],
    }))),

    tool('shop_find_hot_shops',
      'Find young Etsy shops with lots of sales that sell what you search for, using Etsy’s official data. Returns each shop’s total sales, opening date, sales per month and matching listings.',
      {
        phrases: z.array(z.string()).min(1).max(12).describe('Search phrases, like "printable wall art boho" or "teacher svg"'),
        min_sales: z.number().int().default(1000),
        max_months_open: z.number().int().default(18).describe('Only shops opened within this many months'),
        listings_per_phrase: z.number().int().min(25).max(300).default(100),
      },
      safe(async (a) => {
        const shops = await findHotShops(a.phrases, { minSales: a.min_sales, maxMonths: a.max_months_open, perPhrase: a.listings_per_phrase });
        return ok(shops.length ? shops.slice(0, 40) : 'No shops matched. Try broader phrases, or a lower min_sales or a higher max_months_open.');
      })),

    tool('shop_top_listings', 'A shop’s most-favorited active listings: titles, prices, tags, favorites and type. Use it to learn what sells, not to copy.',
      { shop_id: z.number().int(), limit: z.number().int().min(5).max(50).default(25) },
      safe(async (a) => ok(await topListings(a.shop_id, a.limit)))),

    tool('shop_categories', 'Search Etsy’s category list for the category_id a listing needs (for example "wall decor prints", "clip art", "planners").',
      { query: z.string() }, safe(async (a) => ok(await findCategory(a.query)))),

    tool('shop_make_design',
      'Turn your SVG into a finished product: print files, a Canva-editable PDF, an SVG cut file (where it fits) and Etsy listing photos. Returns a design_id and a preview image path. Always look at the preview (Read the PNG) and fix the design if anything is off.',
      {
        name: z.string().describe('Short design name, like "Boho Sun Quote"'),
        kind: z.enum(['wall_art', 'printable', 'svg_cut_file', 'sticker', 'tshirt', 'mug', 'shop_banner', 'shop_icon']),
        svg: z.string().describe('The full SVG, with the viewBox for this product type'),
        title: z.string().optional().describe('Listing title, used on the listing photos'),
        backgrounds: z.array(z.string()).max(4).optional().describe('2–4 photo backgrounds from shop_backgrounds for real-photo listing photos'),
      },
      safe(async (a) => {
        const badBg = (a.backgrounds ?? []).filter((b) => !listBackgrounds().some((n) => n === b || n.replace(/\.(png|jpe?g)$/i, '') === b.replace(/\.(png|jpe?g)$/i, '')));
        if (badBg.length) return fail(`No background called ${badBg.map((b) => `"${b}"`).join(', ')}. Available: ${listBackgrounds().join(', ') || 'none yet (make one with shop_make_background)'}.`);
        const problems = [...checkSvg(a.svg, a.kind), ...brandProblems(a.name, a.title ?? '', visibleText(a.svg)).map((w) => `Remove "${w}": brands and characters aren’t allowed.`)];
        if (problems.length) return fail('Fix these and try again:\n- ' + problems.join('\n- '));
        const r = await makeDesign(a);
        return ok({
          design_id: r.design_id, preview: r.preview, listing_photos: r.images.map((i) => i.path), files: r.files.map((f) => f.name),
          next: KINDS[a.kind].branding
            ? `Look at ${r.preview} with Read. Etsy doesn’t let apps upload banners or icons, so tell the owner the file is ready at ${r.files[0].path} and that they can upload it in Etsy: Shop Manager > Settings > Info & Appearance.`
            : `Look at ${r.preview} (and the listing photos) with Read. If it looks right, publish it with ${KINDS[a.kind].digital ? 'shop_publish_digital' : 'shop_publish_printify'}.`,
        });
      })),

    tool('shop_publish_digital',
      'List a digital design on Etsy as an instant download (Canva-editable PDF + print files), with the listing photos. A "what you get" and Canva how-to section is added to your description automatically.',
      {
        design_id: z.string(),
        title: z.string().describe('Up to 140 characters; lead with what it is and the main search words'),
        description: z.string().describe('2–4 short paragraphs: what it is, who it’s for, sizes and how to use it'),
        tags: z.array(z.string()).describe('13 search phrases, 20 characters max each'),
        price: z.number().min(1).max(100).describe('US dollars'),
        category_id: z.number().int().describe('From shop_categories'),
        draft: z.boolean().default(false).describe('true = save it as a draft in Etsy for the owner to review instead of going live'),
      },
      safe(async (a) => {
        const d = design(a.design_id);
        if (KINDS[d.kind].branding) return fail('Banners and icons aren’t listings: the owner uploads them in Shop Manager > Settings > Info & Appearance.');
        if (!KINDS[d.kind].digital) return fail(`${d.kind} designs are physical products: use shop_publish_printify.`);
        const brand = brandProblems(a.title, a.description, a.tags.join(' '), visibleText(svgOf(a.design_id)));
        if (brand.length) return fail(`Remove ${brand.map((b) => `"${b}"`).join(', ')}: brands and characters aren’t allowed.`);
        if (needPhotos() && !JSON.parse(readFileSync(join(SHOP_DIR, 'designs', a.design_id, 'meta.json'), 'utf8')).photo_mockups)
          return fail('This design still has the old drawn listing photos. Give it real-photo ones first with shop_remake_photos (backgrounds from shop_backgrounds) or shop_ai_mockup, then publish.');
        const { title, tags } = cleanListing(a.title, a.tags);
        const publish = !a.draft && autoPublish() && publishedToday() < dailyLimit();
        const r = await createDigitalListing({ title, description: a.description.trim() + '\n' + DIGITAL_FOOTER(d.kind), tags, price: a.price, taxonomy_id: a.category_id, images: d.images, files: d.files.slice(0, 5), publish });
        record({ at: new Date().toISOString(), channel: 'etsy', kind: d.kind, title, url: r.url, design_id: d.design_id, state: r.state, price: a.price });
        return ok({ ...r, note: publish ? 'Live on Etsy.' : a.draft ? 'Saved as a draft in Etsy (Shop Manager > Listings > Drafts).' : autoPublish() ? `Daily limit of ${dailyLimit()} reached, so it was saved as a draft for the owner.` : 'Saved as a draft for the owner to review.' });
      })),

    tool('shop_publish_printify',
      'Make a T-shirt or mug from a tshirt/mug design with Printify and publish it to the Etsy shop. Printify makes the product photos; prices are raised automatically if they wouldn’t make a profit.',
      {
        design_id: z.string(),
        title: z.string(), description: z.string(), tags: z.array(z.string()),
        price: z.number().min(10).max(80).describe('US dollars for the base size'),
        colors: z.array(z.string()).min(1).max(6).default(['White']).describe('Shirt or mug colors, like White, Black, Natural, Heather Grey, Sand'),
      },
      safe(async (a) => {
        const d = design(a.design_id);
        if (d.kind !== 'tshirt' && d.kind !== 'mug') return fail('Only tshirt and mug designs go to Printify. Digital designs use shop_publish_digital.');
        const brand = brandProblems(a.title, a.description, a.tags.join(' '), visibleText(svgOf(a.design_id)));
        if (brand.length) return fail(`Remove ${brand.map((b) => `"${b}"`).join(', ')}: brands and characters aren’t allowed.`);
        const { title, tags } = cleanListing(a.title, a.tags);
        const publish = autoPublish() && publishedToday() < dailyLimit();
        const r = await createProduct({ kind: d.kind, title, description: a.description.trim() + PRINT_FOOTER, tags, price: a.price, colors: a.colors, printPng: d.files[0].path, publish });
        record({ at: new Date().toISOString(), channel: 'printify', kind: d.kind, title, url: r.printify_url, design_id: d.design_id, state: publish ? 'active' : 'draft', price: a.price });
        return ok(r);
      })),

    tool('shop_make_artwork',
      'Generate an AI illustration for a design (watercolor, gouache, hand-drawn, etc.). It never contains words: you add all text yourself as <text> in the SVG. Returns an artwork_id and the image path; Read it before using it. Costs money, so be specific.',
      {
        name: z.string().describe('Short name, like "friendsgiving table watercolor"'),
        prompt: z.string().min(30).max(2000).describe('Subject, style, palette, composition and where to leave empty space for text. Example: "Warm watercolor illustration of a Friendsgiving table with pumpkin pie, candles and small pumpkins, rust, sage and cream palette, illustration fills the bottom 55%, top 45% is plain cream paper texture."'),
        aspect: z.enum(['3:4', '4:5', '2:3', '1:1', '4:3', '3:2', '5:4']).default('3:4').describe('Match the product: printable/invitation 3:4, wall_art 4:5, sticker 1:1'),
      },
      safe(async (a) => {
        const brand = brandProblems(a.name, a.prompt);
        if (brand.length) return fail(`Remove ${brand.map((b) => `"${b}"`).join(', ')}: brands and characters aren’t allowed.`);
        const img = await generateImage({ prompt: `${a.prompt}\n\nHigh-quality print illustration for a stationery product. ${NO_TEXT}`, aspect: a.aspect as Aspect, size: '2K' });
        const id = `${stamp()}-${slugify(a.name)}-${rand()}`;
        mkdirSync(ARTWORK_DIR, { recursive: true });
        const path = join(ARTWORK_DIR, id + extFor(img.mime));
        writeFileSync(path, img.data);
        return ok({ artwork_id: id, image: path, images_today: `${img.used_today}/${img.limit}`,
          use_it: `Read ${path}. If good, put it in your SVG as <image href="artwork:${id}" x="0" y="0" width="(design width)" height="(design height)" preserveAspectRatio="xMidYMid slice"/> and put all words on top as <text>. If any letters appear in the art, cover or crop them, or generate again.` });
      })),

    tool('shop_make_background',
      'Generate a styled photo background for listing photos: a flat-lay scene with an empty space in the middle where the design gets placed. Saved for reuse across many listings.',
      {
        name: z.string().describe('Short name, like "thanksgiving-wood-table"'),
        scene: z.string().min(20).max(1000).describe('The props, surface, colors and mood, e.g. "rustic wooden table, small pumpkins, dried autumn leaves, linen napkin, warm candlelight, rust and cream tones"'),
      },
      safe(async (a) => {
        const prompt = `Professional overhead flat-lay product photograph for an Etsy listing, shot from directly above, soft natural window light, shallow realistic shadows. Scene: ${a.scene}. IMPORTANT: the middle of the frame (about 45% of the width and 75% of the height, centered) must be completely EMPTY, plain surface with no objects, so a printed card can be placed there later; arrange all props around the edges and corners. No paper, cards, frames or screens. Photorealistic. ${NO_TEXT}`;
        const img = await generateImage({ prompt, aspect: '4:3', size: '2K' });
        mkdirSync(BACKGROUNDS_DIR, { recursive: true });
        let file = `${slugify(a.name)}${extFor(img.mime)}`;
        if (listBackgrounds().includes(file)) file = `${slugify(a.name)}-${rand()}${extFor(img.mime)}`;
        writeFileSync(join(BACKGROUNDS_DIR, file), img.data);
        return ok({ background: file, image: join(BACKGROUNDS_DIR, file), images_today: `${img.used_today}/${img.limit}`, next: 'Read it. If the middle is clear, use its name in shop_make_design backgrounds or shop_remake_photos.' });
      })),

    tool('shop_backgrounds', 'List the photo backgrounds available for listing photos (the owner’s own and generated ones).', {},
      safe(async () => ok({ backgrounds: listBackgrounds(), folder: BACKGROUNDS_DIR, note: 'Read one to see it. The owner can add their own photos to this folder.' }))),

    tool('shop_remake_photos', 'Re-make an existing design’s listing photos on real photo backgrounds (use this for designs made before backgrounds existed).',
      { design_id: z.string(), backgrounds: z.array(z.string()).min(1).max(4) },
      safe(async (a) => {
        design(a.design_id);
        const images = remakePhotos(a.design_id, a.backgrounds);
        return ok({ design_id: a.design_id, listing_photos: images.map((i) => i.path), next: 'Read the first photo to check it, then publish.' });
      })),

    tool('shop_ai_mockup',
      'Make a lifestyle listing photo of a finished design with AI (for example a hand holding the printed card on a cozy Thanksgiving table). It becomes the first listing photo. AI can alter words: Read it and compare every word with the design.',
      {
        design_id: z.string(),
        scene: z.string().min(20).max(800).describe('e.g. "held in a woman’s hand over a rustic Thanksgiving table with pumpkins and candles, warm evening light"'),
      },
      safe(async (a) => {
        const d = design(a.design_id);
        const art = renderPng(withArtwork(svgOf(a.design_id)), 1400, { background: '#ffffff' });
        const img = await generateImage({
          prompt: `Create a photorealistic Etsy listing photo of the attached printed design as a physical printed card, ${a.scene}. Use the attached design EXACTLY as it is: do not change, redraw, translate, add or remove any words, letters, numbers or artwork on it; keep every word identical and readable. The card is the clear focus and fills most of the frame. Natural light, realistic paper texture and shadows. No other text anywhere in the photo.`,
          aspect: '4:3', size: '2K', refs: [{ data: art, mime: 'image/png' }],
        });
        const path = join(SHOP_DIR, 'designs', a.design_id, 'listing-photos', `ai-photo-${rand()}${extFor(img.mime)}`);
        writeFileSync(path, img.data);
        addPhoto(a.design_id, path);
        return ok({ photo: path, images_today: `${img.used_today}/${img.limit}`, check: `Read ${path} and compare every word with the design (${d.title}). If anything changed or looks wrong, run shop_remake_photos to drop it and use backgrounds instead.` });
      })),

    tool('shop_listings', 'All the shop’s listings straight from Etsy, by state (live, drafts, deactivated...). Use this, not shop_report, to see what is actually live right now.',
      { state: z.enum(['active', 'draft', 'inactive', 'expired', 'sold_out', 'all']).default('all'), limit: z.number().int().min(1).max(300).default(100) },
      safe(async (a) => {
        const states: ListingState[] = a.state === 'all' ? ['active', 'draft', 'inactive', 'expired', 'sold_out'] : [a.state];
        const out: Record<string, unknown> = {};
        for (const st of states) { const l = await shopListings(st, a.limit); if (l.length || a.state !== 'all') out[st] = l; }
        return ok(out);
      })),

    tool('shop_get_listing', 'One listing in full: title, description, tags, price, state, photos and download files.', { listing_id: z.number().int() },
      safe(async (a) => ok(await listingDetails(a.listing_id)))),

    tool('shop_edit_listing',
      'Edit an existing listing: title, description, tags, price, or switch it live/off. Only include what you change. The "what you get / how to edit in Canva" section at the end of the description is kept automatically. Every edit is logged with the old values.',
      {
        listing_id: z.number().int(),
        title: z.string().min(10).max(140).optional(),
        description: z.string().min(40).max(8000).optional().describe('The main description only; the standard footer is kept'),
        tags: z.array(z.string()).min(1).max(13).optional().describe('All tags to keep (replaces the list), 20 characters max each'),
        price: z.number().min(1).max(200).optional().describe('US dollars'),
        state: z.enum(['active', 'inactive']).optional().describe('active = live, inactive = deactivated (hidden, can be turned back on)'),
        reason: z.string().min(5).max(300).describe('Why: shown in the edit log for the owner'),
      },
      safe(async (a) => {
        if (!a.title && !a.description && !a.tags && a.price === undefined && !a.state) return fail('Include at least one thing to change.');
        const cur = await listingDetails(a.listing_id);
        const brand = brandProblems(a.title ?? '', a.description ?? '', (a.tags ?? []).join(' '));
        if (brand.length) return fail(`Remove ${brand.map((b) => `"${b}"`).join(', ')}: brands and characters aren’t allowed.`);
        if (a.state === 'active' && cur.state !== 'active') {
          if (!autoPublish()) return fail('Auto-publish is off, so only the owner can make listings live. Leave it as is and tell the owner.');
          if (publishedToday() >= dailyLimit()) return fail(`Today’s limit of ${dailyLimit()} new live listings is reached. Try tomorrow.`);
          const d = readLedger().find((p) => p.url.includes(String(a.listing_id)));
          if (needPhotos() && d) {
            const metaFile = join(SHOP_DIR, 'designs', d.design_id, 'meta.json');
            if (existsSync(metaFile) && !JSON.parse(readFileSync(metaFile, 'utf8')).photo_mockups)
              return fail('This listing still has the old drawn photos. Give it real-photo ones first (shop_remake_photos on its design, then shop_update_listing_media), then make it live.');
          }
        }
        const fields: { title?: string; description?: string; tags?: string[]; state?: 'active' | 'inactive' } = {};
        if (a.title || a.tags) {
          const c = cleanListing(a.title ?? cur.title, a.tags ?? cur.tags);
          if (a.title) fields.title = c.title;
          if (a.tags) fields.tags = c.tags;
        }
        if (a.description) {
          const i = cur.description.indexOf(SEP);
          fields.description = a.description.trim() + (i >= 0 ? '\n\n' + cur.description.slice(i) : '');
        }
        if (a.state) fields.state = a.state;
        if (Object.keys(fields).length) await updateListingFields(a.listing_id, fields);
        if (a.price !== undefined) await updateListingPrice(a.listing_id, a.price);
        const changes: Record<string, { before: unknown; after: unknown }> = {};
        if (fields.title) changes.title = { before: cur.title, after: fields.title };
        if (fields.tags) changes.tags = { before: cur.tags, after: fields.tags };
        if (fields.description) changes.description = { before: cur.description.split(SEP)[0].trim(), after: a.description };
        if (a.price !== undefined) changes.price = { before: cur.price, after: `${a.price.toFixed(2)} USD` };
        if (fields.state) changes.state = { before: cur.state, after: fields.state };
        if (fields.state === 'active' && cur.state !== 'active') record({ at: new Date().toISOString(), channel: 'etsy', kind: 'edit', title: fields.title ?? cur.title, url: cur.url, design_id: '', state: 'active', price: a.price ?? 0 });
        logEdit({ listing_id: a.listing_id, title: fields.title ?? cur.title, by: 'agent', changes, reason: a.reason });
        return ok({ updated: a.listing_id, url: cur.url, changed: Object.keys(changes), note: 'Logged in Etsy shop > Edit log.' });
      })),

    tool('shop_update_listing_media',
      'Replace a listing’s photos and/or download files with a design’s (e.g. after shop_remake_photos gave it real-photo mockups, or after fixing the design).',
      { listing_id: z.number().int(), design_id: z.string(), photos: z.boolean().default(true), files: z.boolean().default(false), reason: z.string().min(5).max(300) },
      safe(async (a) => {
        if (!a.photos && !a.files) return fail('Choose photos, files or both.');
        const d = design(a.design_id);
        const meta = JSON.parse(readFileSync(join(SHOP_DIR, 'designs', a.design_id, 'meta.json'), 'utf8'));
        if (a.photos && needPhotos() && !meta.photo_mockups) return fail('This design only has the old drawn photos. Run shop_remake_photos on it first.');
        const cur = await listingDetails(a.listing_id);
        const changes: Record<string, { before: unknown; after: unknown }> = {};
        if (a.photos) { const n = await replaceListingImages(a.listing_id, d.images); changes.photos = { before: `${cur.images.length} photos`, after: `${n} photos from ${a.design_id}` }; }
        if (a.files) {
          if (cur.type !== 'download' && cur.files.length === 0) return fail('This isn’t a digital-download listing.');
          const n = await replaceListingFiles(a.listing_id, d.files.slice(0, 5)); changes.files = { before: cur.files.map((f) => f.name), after: `${n} files from ${a.design_id}` };
        }
        logEdit({ listing_id: a.listing_id, title: cur.title, by: 'agent', changes, reason: a.reason });
        return ok({ updated: a.listing_id, url: cur.url, changed: Object.keys(changes) });
      })),

    tool('shop_update_profile',
      'Update the shop’s headline (title, up to 55 characters), announcement (shown at the top of the shop), the message sent to buyers after a purchase, and the message for digital-download buyers. Only include the fields you want to change. The shop name can only be changed by the owner.',
      {
        title: z.string().max(55).optional().describe('The headline under the shop name'),
        announcement: z.string().max(5000).optional(),
        sale_message: z.string().max(5000).optional().describe('Sent to buyers after they order'),
        digital_sale_message: z.string().max(5000).optional().describe('Sent to buyers of digital downloads; say how to download and how to edit in Canva'),
      },
      safe(async (a) => {
        const fields = Object.fromEntries(Object.entries(a).filter(([, v]) => typeof v === 'string' && v.trim())) as Record<string, string>;
        if (!Object.keys(fields).length) return fail('Include at least one field to change.');
        const brand = brandProblems(...Object.values(fields));
        if (brand.length) return fail(`Remove ${brand.map((b) => `"${b}"`).join(', ')}: brands and characters aren’t allowed.`);
        if (!autoPublish()) {
          // The owner reviews changes first: save them as a proposal instead.
          mkdirSync(join(SHOP_DIR, 'branding'), { recursive: true });
          const file = join(SHOP_DIR, 'branding', 'profile-proposal.md');
          writeFileSync(file, `# Proposed shop profile changes\n\n${Object.entries(fields).map(([k, v]) => `## ${k}\n\n${v}`).join('\n\n')}\n\nTo apply them: copy into Etsy (Shop Manager > Settings > Info & Appearance), or set SHOP_AUTO_PUBLISH=true and ask the agent again.\n`);
          return ok({ note: `Auto-publish is off, so the changes were saved for the owner to review in ${file} instead of going live.` });
        }
        return ok({ ...(await updateShopProfile(fields)), note: 'Shop profile updated on Etsy.' });
      })),

    tool('shop_report', 'How the shop is doing: total sales, each live listing’s views and favorites, and what the agents published recently.', {},
      safe(async () => {
        const recent = readLedger().slice(-30).reverse();
        try { return ok({ ...(await myListingsReport()), published_by_agents: recent }); }
        catch (e) { return ok({ note: (e as Error).message, published_by_agents: recent }); }
      })),
  ],
});
