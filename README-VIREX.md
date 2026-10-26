# Virex Fashion House

Responsive Virex storefront and private store management, hosted at the existing GitHub Pages address. The other three prototype HTML pages are preserved in the deployment.

## Admin access

Use **Page Statistics** at the bottom of the store, or open `admin.html`. Enter an approved admin email, request its numeric email code, then verify the code. The two requested admin addresses are checked by the server. Authentication uses the project's existing Supabase email configuration. Admin sessions are stored in session storage and can be signed out from the menu.

## Every business transition is manual

- New requests are always **Pending review / Unpaid**, with the triage flag **Review**.
- Open an order, choose the fulfilment status, payment status and triage flag, then click **Save manual changes**. Delivery fee confirmation, refunds and customer-facing notes also require an explicit save.
- Marking Paid does not accept, dispatch or complete an order. Accepting or completing an order does not mark it Paid.
- Order status changes do not deduct stock. Update physical stock in **Inventory** or the product editor.
- Revenue is calculated from orders admins have explicitly marked Paid, less recorded product refunds. Unpaid, awaiting-confirmation and fully refunded orders contribute zero. Delivery fees are excluded. This is a record of admin-confirmed sales, not a payment gateway.
- Changes are recorded in order history. Version checks prevent two admins silently overwriting the same record.

## Catalogue and photos

All eight original items, their prices and the original logo were extracted from the previous `index.html`. Products can be edited, published, drafted or archived. **Remove from storefront** archives a product while preserving its previous orders and sales snapshots. Existing items start as made to order because the previous website supplied no stock quantities.

Each product supports up to 12 photographs. Upload, remove, reorder with the arrows and use **Set cover** to choose the first image. Customers can browse thumbnails, use previous/next controls or swipe on the main product photograph.

Uploads are resized and encoded as WebP in the browser, targeting at most 250 KB. The server and the isolated `virex-assets` bucket enforce a 256 KB maximum. Images are stored as files; the database contains their URLs, never image blobs or base64 image strings. Upload processing avoids a fixed low resolution by first adjusting encoding quality and reducing dimensions only when necessary.

The campaign assets in `assets/campaign/` and the staged Onyx photograph are saved files, with their original generated PNGs in `design/originals/`. Their exact bytes can be reused on every build. `docs/asset-manifest.json` records SHA-256 checksums and `docs/asset-prompts.json` preserves the campaign briefs. Rebuilding the website does not require new image generation.

## Backend and isolation

Supabase project: `vxggjwvompcaxpwpenkw`.

- The single application table is `public."Virex"`, with typed product, order, visit, audit and rate-limit records. Other application tables are not modified.
- RLS is enabled. Browsers have no direct table read/write grants. Public endpoints return published products or a deliberately limited private-token tracking view.
- Every admin endpoint verifies the Supabase user and the approved email allowlist server-side. A visible login screen or a client-side email check never grants access.
- Only a publishable key is included in the browser. Server credentials are read from the Edge Function's environment.
- Order prices are taken from the server catalogue. Requests are validated and rate-limited; order submission supports idempotent retries.
- Visitor statistics use random browser/session IDs, device/browser type, source and current section. Online counts expire after 65 seconds without a visible-page heartbeat. Preview traffic is excluded.
- Dashboard updates poll every 20 seconds. This refreshes information; it does not transition orders or change inventory.

`supabase/schema.sql`, `supabase/seed.sql` and `supabase/functions/virex-api/` contain the deployed backend source. `seed.sql` is insert-only and does not overwrite subsequent admin edits.

## Build and checks

No frontend dependency installation is required:

```bash
npm test
npm run check
node scripts/prepare-site.mjs
```

The GitHub Pages workflow verifies the manual order rules, prepares `dist/`, and deploys it. Backend source, design originals, documentation and local QA fixtures are excluded from the published static bundle. `terms.html` contains the store's terms and order-data information.

Validation covers authoritative prices, invalid orders and stock, manual status independence, refunds, private tracking redaction and image URL validation. Public checkout, private tracking, responsive views and editor controls were also exercised in Chrome. OTP request acceptance was checked for both approved addresses; actual inbox receipt and code entry remain the account holders' step.
