# Virex Fashion House

Responsive Virex storefront and private store management, hosted at the existing GitHub Pages address. The other three prototype HTML pages are preserved in the deployment.

## Admin access

Use **Page Statistics** at the bottom of the store, or open `admin.html`. Enter an approved admin email, request its numeric email code, then verify the code. The two requested admin addresses are checked by the server. The email screen and API refuse addresses outside the fixed two-admin allowlist. Each login needs a short-lived Virex challenge, and successful verification creates a Virex-specific session grant. A Supabase login issued by another app cannot open Virex admin. Existing admin sessions must sign in again after this update. Admin sessions are stored in session storage and can be signed out from the menu.

## Customer communication and assistant

Public phone and WhatsApp contact links, and the buyer phone field, have been removed. The private order tracking link opens both progress and a two-way conversation. An order ID alone is insufficient to read or send private messages; buyers need the 256-bit tracking secret. Admins use **Order chats**, search by order ID/customer, or open the conversation from an order. Replies are separate message records and never change business statuses. Message submission is idempotent, validated and rate-limited. Open conversations poll every 10 seconds.

**Enquiries** is a separate inbox with individual name/email, subject, topic and message records. Customers get a separate private enquiry link. Admins can respond in that thread, or use **Reply by email** to compose in their own mail app addressed to the supplied email. The mail-app action does not claim that the website sent an email; sending occurs in that app. Enquiry statuses are manually saved.

The **Virex Assistant** is a guided, deterministic store chatbot, without an external model or API bill. It greets, answers common ordering/sizing/payment/delivery questions, uses live catalogue prices, and opens tracking, enquiry, cart and collection shortcuts. Unknown questions offer an enquiry. Repeated questions in the current session create a deduplicated **Bot checks** record with a redacted excerpt (links, email addresses and long numbers removed). Admins can review it and explicitly publish or withdraw a general answer for future exact matching questions.

## Isolated email sender

The shared Supabase SMTP sender and templates remain unchanged because other applications use them. Until a dedicated provider is configured, Virex still delivers numeric codes through that existing sender, which may show PharmWeb3 branding. This branding setup is not complete without a provider credential.

The login form accepts only the two original admin email addresses. Internally, Virex uses fixed `+virex-admin` Gmail identities in Supabase Auth, so requesting a Virex code does not overwrite the game’s OTP for the original email identity. Gmail delivers plus-addressed messages to the same inbox. Server-side identity mapping and the separate Virex session grant are both required; an ordinary login from another application is refused. No existing game account, SMTP setting or template is modified.

**Email settings** supports a Virex-only verified Resend sender and API key. The key is AES-GCM encrypted server-side using a key derived from the Edge secret and never returned to the browser. The mail sender name becomes **Virex**, with the subject **Your Virex admin login code** and a Virex template. Alternatively, set the Edge environment variables `VIREX_RESEND_API_KEY` and `VIREX_EMAIL_FROM`. Dedicated sending binds the exact generated code to its Virex challenge, separate from other apps. Do not put provider credentials in source or client settings files.

## Reset test activity

**Reset** appears immediately below **Back to website**. Nothing is reset merely by opening it. Choose a scope, inspect the counts, tick the deletion acknowledgement and type **RESET VIREX**. The server requires a two-minute, one-use preview tied to the signed-in admin.

- **Test activity** clears orders (and therefore revenue), messages, enquiries, Bot checks, visits and audit history while keeping products/stock/photos and published assistant answers.
- **Full reset** also removes product edits, added products, uploaded product photos and published assistant answers, and restores the exact original eight-product catalogue. Admin access and encrypted email settings are preserved.
- Records created after the preview cutoff are preserved; a catalogue change after a full-reset preview requires a fresh preview. The reset transaction is confined to `public."Virex"`; only a full reset removes older files from `virex-assets/products/`. Other apps are unaffected.
- Both reset scopes were tested in rolled-back database transactions. The existing customer/test order and visit records were retained during development.

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

- The single application table is `public."Virex"`, with typed product, order, message, enquiry, assistant review/FAQ, visit, audit, rate-limit and private settings records. Other application tables are not modified.
- RLS is enabled. Browsers have no direct table read/write grants. Public endpoints return published products or a deliberately limited private-token tracking view.
- Every admin endpoint verifies the Supabase user, the approved email allowlist and an active Virex-specific session grant server-side. A visible login screen or a client-side email check never grants access.
- Only a publishable key is included in the browser. Server credentials are read from the Edge Function's environment.
- Order prices are taken from the server catalogue. Requests are validated and rate-limited; order submission supports idempotent retries.
- Visitor statistics use random browser/session IDs, device/browser type, source and current section. Online counts expire after 65 seconds without a visible-page heartbeat. Preview traffic is excluded.
- Dashboard updates poll every 20 seconds. This refreshes information; it does not transition orders or change inventory.

`supabase/schema.sql`, `supabase/support.sql`, `supabase/seed.sql` and `supabase/functions/virex-api/` contain the deployed backend source. `seed.sql` is insert-only and does not overwrite subsequent admin edits.

## Build and checks

No frontend dependency installation is required:

```bash
npm test
npm run check
node scripts/prepare-site.mjs
```

The GitHub Pages workflow verifies the manual order rules, prepares `dist/`, and deploys it. Backend source, design originals, documentation and local QA fixtures are excluded from the published static bundle. `terms.html` contains the store's terms and order-data information.

The automated checks cover authoritative prices, invalid orders and stock, manual status independence, refunds, private tracking/message redaction, enquiry validation, assistant routing/fallbacks, cross-application session rejection, allowlist gating and image URL validation. Public checkout, private tracking, responsive views and editor controls were also exercised in Chrome. OTP request acceptance was checked for both approved addresses; actual inbox receipt and code entry remain the account holders' step.
