# Merich Foods — Signature Gold

A responsive static website matching the approved Signature Gold prototype. All Merich source, assets, retained image originals, design references, tests and documentation live inside this folder. The repository’s shared static preparation script calls `Merich/scripts/prepare.mjs` to include the site at `Merich/` in the existing deployment. Other storefront files are unchanged.

## Ordering

The only contact destination is **+2347085277643**. Customers choose a meal, adjust quantities, review their request and add their name, delivery area and optional notes. **Continue on WhatsApp** opens a draft addressed to Merich Foods; the customer reviews and sends it there. Availability, portions, prices, payment and delivery are confirmed in that conversation. No invented prices, card collection or automatic order confirmations are displayed.

The menu can be edited in `menu.mjs`. Keep IDs unique, update the corresponding HTML product card, and place images in `assets/`. Saved selections use the browser-local `merich_cart_v1` key, which holds only meal IDs and quantities. Customer form values stay in the current page’s memory until included in the user-triggered WhatsApp link. There is no admin page, login, analytics collector, Supabase client, external font dependency or order database.

## Exact visual assets

- `design/approved-prototype.png` retains the selected design.
- `design/ordering-prototype.png` retains the approved ordering-flow preview.
- `design/originals/` contains the generated hero, three menu photographs, kitchen story image and transparent-background original badge.
- `design/asset-prompts.json` retains the image-generation briefs. Existing image bytes are reused on every deployment; no generation happens at build time.
- `assets/` holds the compressed WebP photographs, transparent logo, favicon and JPEG share image. `design/asset-manifest.json` records dimensions, byte sizes and SHA-256 checksums.
- To rebuild image variants from the retained originals, install Pillow in your local Python environment and run `python Merich/scripts/optimise_assets.py` from the repository root. This only resizes and encodes the retained imagery.

The desktop page uses the prototype’s warm charcoal, ivory, restrained gold, serif headlines, three-photo menu, kitchen story and three ordering steps. The phone layout uses a stacked hero, single-column cards, a drawer menu and persistent WhatsApp request button. Icons are inline SVG paths; Georgia and Arial are system fonts, so the design does not depend on a font service.

## Checks and build

From the repository root:

```bash
node --test Merich/tests/*.test.mjs
node --check Merich/app.js
node --check Merich/menu.mjs
node scripts/prepare-site.mjs
```

The static preparer publishes only runtime files and optimized assets. Design originals, prompts, scripts, tests and documentation are excluded from the deployed bundle. Tests cover restored-cart validation, quantity limits, exact WhatsApp destination/encoding and request validation. `terms.html` explains the request and data flow. Chrome checks cover desktop and phone layouts, navigation, selecting several meals, quantity changes, removing items, form validation and the generated WhatsApp draft link.
