# HTTP security headers audit

Owner: [engineering lead]. Last reviewed: 2026-10-09. Next review: 2027-04-09.

**STATUS.** Audited on 2026-10-09 from the code (not by probing the live site). The API already set most headers; this change adds a Permissions-Policy to the API and a header block to the web app on Vercel. A CSP report endpoint and a stricter CSP are recommendations, not built.

## API (Hono, `packages/api/src/lib/security-headers.ts`, `server.ts`)

`secureHeaders()` is applied to every route, with the Cross-Origin-Resource-Policy left to routes that need `same-site`/`cross-origin` (logos).

| Header | State |
|---|---|
| Strict-Transport-Security | Set by Hono's default (`max-age=15552000; includeSubDomains`). Raise to one year (`31536000`) and consider `preload` once every subdomain is HTTPS-only. |
| X-Content-Type-Options | `nosniff` (default) |
| Referrer-Policy | `no-referrer` (default) |
| X-Frame-Options | `SAMEORIGIN` (default) |
| Cross-Origin-Opener-Policy | `same-origin` (default) |
| Cross-Origin-Resource-Policy | `same-origin` by default; routes may choose another |
| Permissions-Policy | **Added:** `camera=(self), microphone=(self), geolocation=(self)` (test in `security-headers.test.ts`) |
| Content-Security-Policy | Not set globally on purpose: Hono sets headers after the route runs and would overwrite the strict policies that the share page and the HTML error pages set themselves (`default-src 'none'; ... frame-ancestors 'none'`). JSON responses do not need one. |
| CORS | Restricted to `CORS_ORIGINS` |
| Cookies | Not changed here (HttpOnly, Secure, SameSite=Lax per `SECURITY.md`) |

## Web app (Vercel, `apps/web/vercel.json`, `index.html`)

| Header | State |
|---|---|
| Strict-Transport-Security | Added by Vercel for its domains and custom domains with HTTPS. Not set in the file. |
| X-Content-Type-Options | **Added:** `nosniff` (pages only, not the `/api` proxy) |
| Referrer-Policy | **Added:** `strict-origin-when-cross-origin` |
| Permissions-Policy | **Added:** `camera=(self), microphone=(self), geolocation=(self)`. Microphone stays allowed for our own origin because of AI voice input; camera and location for the mobile web check-in. Anything not listed keeps the browser default. |
| Clickjacking (frame-ancestors) | **Added** as a header-level `Content-Security-Policy: frame-ancestors 'self'`. It only restricts who may frame the app; the page's own CSP (below) is unchanged and both apply. The app frames only itself (print iframes use `blob:`) and Razorpay/Turnstile frames live inside our page, so nothing depends on being framed by others. |
| Content-Security-Policy | Already present as a `<meta>` tag built by `vite.config.ts` from `src/lib/csp-hash.ts`: scripts only from self, hashed inline theme script, Cloudflare Turnstile and Razorpay checkout; styles self + Google Fonts; `object-src 'none'`; `base-uri 'self'`. The meta tag cannot carry `frame-ancestors` or reporting, hence the header above. |

Checked by `apps/web/src/__tests__/vercel-headers.test.ts`: the header values, that the `/api` proxy rewrite and SPA fallback are unchanged, and that the header rule does not match `/api/...`.

## Recommendations (not done)

1. **CSP reporting.** Add `Content-Security-Policy-Report-Only` (a copy of the meta policy, plus `report-to`) with a small `/api/csp-report` endpoint that logs violations, run it for two weeks, then tighten. `style-src 'unsafe-inline'` is the weakest part; it is there for the component library and Google Fonts CSS. Only change the policy by editing `csp-hash.ts` so the meta tag and tests stay in step.
2. **HSTS** one year with `preload` on the apex domain after confirming all subdomains serve HTTPS.
3. **COOP/COEP** on the web app are not set; `same-origin` COOP would break popup flows (payment checkouts, Google sign-in if added). Leave off unless tested.
4. **Store app (`apps/store`)**: no `vercel.json` in the repo; if it is deployed on Vercel, give it the same header block.
5. **Probe the live site** with a header scanner after deploy and record the result as calendar evidence.
