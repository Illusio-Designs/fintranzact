# @fintranzact/store

The public-facing online storefront for Fintranzact businesses. A lightweight React 19 SPA that customers visit to browse a business's catalog and place orders — no login required.

[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Tailwind CSS v4](https://img.shields.io/badge/Tailwind_CSS-v4-38BDF8?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)

---

## What this app does

Every Fintranzact business can enable a public storefront at `store.fintranzact.com/<slug>`. The store app reads the business slug from the URL path, fetches the catalog from the API, and renders a mobile-first product listing with cart and checkout.

When a customer places an order, the API creates an unfulfilled invoice in the business's Fintranzact account. The business owner then fulfills and marks it from the web dashboard.

**Features:**
- Product catalog with category grouping and custom sort order
- Item variants and alternate unit support (e.g., order by kg or by packet)
- Cart with quantity controls and real-time total calculation in INR
- Phone-number-verified checkout with Cloudflare Turnstile bot protection
- Minimum order amount enforcement
- WhatsApp notification to the business owner on new orders
- Pay online (UPI, cards, net banking on Razorpay's hosted page, straight to the business's own Razorpay account) and/or Cash on Delivery, as the business has switched them on; subtotal, delivery charge (or "Free delivery" / "Add X more for free delivery"), GST and total shown before paying; an order page with Pay now / Pay again
- Business-defined accent color, tagline, and delivery notes
- Five policy pages (Terms & Conditions, Refund & Cancellation, Shipping & Delivery, Contact Us, Privacy Policy) at `/<slug>/policies/<page>`, filled from the business details and editable in Settings → Online Store, linked in the footer and at checkout
- Mobile-first, no-dependency design

---

## Running locally

```bash
# From monorepo root
pnpm --filter @fintranzact/store dev

# Or from this directory
pnpm dev
```

The store dev server starts at `http://localhost:5174`. To test with a real business, you need a running API and a business with the store enabled and a `storeSlug` set. Navigate to `http://localhost:5174/<your-store-slug>`.

To enable a business's store, go to **Settings > Online Store** in the web dashboard and toggle it on.

---

## Building

```bash
pnpm --filter @fintranzact/store build
# Output: apps/store/dist/
```

---

## Deployment

The store is a static SPA deployed to Vercel:

| Setting | Value |
|---|---|
| Build command | `pnpm --filter @fintranzact/store build` |
| Output directory | `apps/store/dist` |
| Node.js version | 20 |

Set this environment variable in Vercel:

| Variable | Description |
|---|---|
| `API_URL` | Base URL of the API server (e.g., `https://api.yourdomain.com`) |
| `VITE_TURNSTILE_SITE_KEY` | Cloudflare Turnstile site key for order form bot protection |

The store runs on its own subdomain (e.g., `store.fintranzact.com`). Customer-facing URLs are clean: `store.fintranzact.com/my-bakery` — no `/store/` prefix.

The backend API endpoints still use the `/store/` prefix internally (`/store/<slug>/catalog.json`, `/store/<slug>/order`). In dev, the Vite proxy rewrites `/<slug>/catalog.json` → `/store/<slug>/catalog.json`. In production, `API_URL` points to the API server directly.

---

## How it works

### Catalog fetch

On load, the app reads the slug from the first URL path segment (`/<slug>`) and fetches the catalog from the API. This returns the business's public store config: name, accent color, tagline, items grouped by category, store policies, and store settings.

```typescript
// apps/store/src/api.ts
const catalog = await fetchCatalog(slug);
// catalog.items, catalog.categories, catalog.config, ...
```

If the slug is not found or the store is disabled, the API returns 404 and the app shows a "Store not found" page.

### Order placement

The checkout form collects the customer's name, phone, optional email, and delivery address. On submission, the app sends a POST request to `/store/<slug>/order` with the cart contents and a Cloudflare Turnstile verification token.

The API validates the token, creates an unfulfilled invoice in the business database, and (if configured) sends a WhatsApp message to the business's `storeWhatsappNumber`.

### Online payments

`catalog.json` carries `business.payments = { online, cod }`. The checkout shows a "How would you like to pay?" choice built from it (`components/PaymentChoice.tsx`): **Pay online** only when the business has switched it on and its Razorpay connection is ready, **Cash on Delivery** only when switched on; with one way there is nothing to choose. An older API that sends no `payments` is treated as Cash on Delivery only. The order summary shows subtotal, delivery, GST and total before paying; the amount actually charged is always computed by the API from the order, never sent by the browser. `catalog.json` also carries `business.deliveryFee` and `business.freeDeliveryAbove` (display only; `pricing.ts` mirrors the server's rule: flat fee, free at or above the threshold, GST on the fee at the highest rate in the cart). The cart, checkout, order-placed screen and the order page all show the delivery line; the minimum order amount is judged on the goods, not on delivery.

For an online order, `placeOrder` sends `paymentMethod: "online"` and the API answers with `paymentUrl`, Razorpay's hosted payment page for that order. The app saves the order (cart cleared) and `window.location.assign`s to it, so no Razorpay script is loaded here. Razorpay returns the shopper to `/<slug>/order/<orderId>` (`components/OrderStatus.tsx`, which needs the API's `STORE_URL` to be set), which loads `GET /store/<slug>/order/<orderId>` and shows the payment state. The return parameters in the address bar are only a hint to poll for a short while: the order is marked paid only when the business's signed Razorpay webhook reaches the API. An unpaid order shows **Pay now** / **Pay again** (`components/PayNowButton.tsx`, `POST /store/<slug>/order/<orderId>/pay`), which reuses the live payment page or makes a fresh one. If the payment page cannot be made at checkout, the order is still saved and the confirmation page offers Pay now.

In dev, the Vite proxy sends the order status fetch and the pay POST to the API; a browser navigation to `/<slug>/order/<id>` (Accept: text/html) is served by the app.

### Variants and alternate units

Items with `itemMode: "variants"` display a variant selector (e.g., size, colour). Items with `itemMode: "alt_units"` let customers choose between measurement units — the price and quantity are converted automatically using the item's `conversionFactor`.

---

## Project structure

```
apps/store/
├── src/
│   ├── components/   # Header, ItemCard, CartDrawer, Checkout, PaymentChoice, OrderStatus, PayNowButton, PolicyPage, etc.
│   ├── App.tsx       # Root component — slug routing, catalog fetch, cart state
│   ├── api.ts        # fetchCatalog(), placeOrder(), fetchOrder() and payOrder() REST calls
│   ├── types.ts      # StoreConfig, CartItem, OrderResult types
│   └── styles.css    # Tailwind v4 base styles + accent color CSS variable
├── index.html
└── vite.config.ts
```

The store has no dependency on `@fintranzact/api` or tRPC. It uses plain `fetch` calls to the REST endpoints. Types in `src/types.ts` are manually maintained to match the API response shapes — if you change the catalog or order endpoint in the API, update these types.
