import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { findHotShops, topListings, findCategory, createDigitalListing, myListingsReport, updateShopProfile } from './etsy';
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

const PRINT_FOOTER = '\n\nPrinted and shipped by our production partner, Printify. Designed by our shop with the help of AI tools.';

export const SHOP_TOOLS = [
  'shop_guide', 'shop_find_hot_shops', 'shop_top_listings', 'shop_categories', 'shop_make_design', 'shop_publish_digital', 'shop_publish_printify', 'shop_report', 'shop_update_profile',
  'shop_make_artwork', 'shop_make_background', 'shop_backgrounds', 'shop_remake_photos', 'shop_ai_mockup',
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
        const publish = autoPublish() && publishedToday() < dailyLimit();
        const r = await createDigitalListing({ title, description: a.description.trim() + '\n' + DIGITAL_FOOTER(d.kind), tags, price: a.price, taxonomy_id: a.category_id, images: d.images, files: d.files.slice(0, 5), publish });
        record({ at: new Date().toISOString(), channel: 'etsy', kind: d.kind, title, url: r.url, design_id: d.design_id, state: r.state, price: a.price });
        return ok({ ...r, note: publish ? 'Live on Etsy.' : autoPublish() ? `Daily limit of ${dailyLimit()} reached, so it was saved as a draft for the owner.` : 'Saved as a draft for the owner to review.' });
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
