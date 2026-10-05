import type { EndpointGroup } from "./types";
import { API_BASE_URL } from "./api-base";

export const shareEndpoints: EndpointGroup = {
  id: "share-links",
  title: "Share Links",
  description: "Public links to a single sales-side document (invoice, quotation, proforma, delivery challan, credit/debit note, return) that a customer can open without signing in. The web app serves the page at `<APP_URL>/i/<token>` and reads the public REST endpoints in this group (document, PDF, logo, and Pay now). A link is a 32-byte random token (43 URL-safe characters); the server stores its SHA-256 hash for lookup plus the token encrypted, so the business can copy the same link again instead of minting a new one. Each document has at most one live link; revoking it stops the old URL working and sharing again mints a new token. A token reaches exactly one document and nothing else in the organization. Unknown, malformed, revoked and suspended-organization tokens — and deleted documents — all answer the same 404. The public endpoints share the PDF rate limit per client IP (429 when exceeded) and send `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow` and `Referrer-Policy: no-referrer`.",
  endpoints: [
    {
      id: "share-get",
      method: "query",
      path: "share.get",
      title: "Get Share Link",
      description: "The document's live share link with its view statistics, or `null` when it has none yet.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "documentId", type: "string (UUID)", required: true, description: "Sales-side document (any document type with `type: \"sale\"`)" },
      ],
      output: {
        description: "`url` is built on the `APP_URL` server setting (falling back to the request's Origin header). `viewCount` / `lastViewedAt` count opens of the public JSON endpoint.",
        example: {
          url: "https://app.fintranzact.com/i/q9Xw3v0Jb2kT8sYpLr5mN1cHfZ7aE4uD6gRiVoKjB0s",
          createdAt: "2026-09-18T06:30:00.000Z",
          viewCount: 3,
          lastViewedAt: "2026-09-20T11:02:41.000Z",
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/share.get?input=%7B%22json%22%3A%7B%22documentId%22%3A%22DOC_ID%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const link = await trpc.share.get.query({ documentId: invoiceId });
if (link) console.log(link.url, "viewed", link.viewCount, "times");`,
      },
      gotchas: [
        "Requires `Invoice:read` permission.",
        "NOT_FOUND `Document not found` for purchase-side documents, deleted documents, or ids from another business.",
      ],
      relatedEndpoints: ["share-create", "share-revoke", "share-public-document"],
    },
    {
      id: "share-create",
      method: "mutation",
      path: "share.create",
      title: "Create Share Link",
      description: "Return the document's live link, minting one if it has none. Idempotent: calling it again returns the same URL until the link is revoked. Two concurrent calls end up with the same link. Audit entry `share.create`.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "documentId", type: "string (UUID)", required: true, description: "Sales-side document to share" },
      ],
      output: {
        description: "Same shape as `share.get`.",
        example: {
          url: "https://app.fintranzact.com/i/q9Xw3v0Jb2kT8sYpLr5mN1cHfZ7aE4uD6gRiVoKjB0s",
          createdAt: "2026-09-18T06:30:00.000Z",
          viewCount: 0,
          lastViewedAt: null,
        },
      },
      codeExamples: {
        curl: `curl -X POST "${API_BASE_URL}/api/trpc/share.create" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -H "Content-Type: application/json" \\
  -d '{"json":{"documentId":"DOC_ID"}}'`,
        javascript: `const { url } = await trpc.share.create.mutate({ documentId: invoiceId });
await navigator.clipboard.writeText(url);`,
      },
      gotchas: [
        "Requires only `Invoice:read` permission — anyone who can see the document can publish a link to it.",
        "NOT_FOUND `Document not found` for purchase-side or deleted documents.",
      ],
      relatedEndpoints: ["share-get", "share-revoke", "share-public-document"],
    },
    {
      id: "share-revoke",
      method: "mutation",
      path: "share.revoke",
      title: "Revoke Share Link",
      description: "Stop the document's live link working. The next `share.create` mints a new token. Audit entry `share.revoke` when a link was live.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "documentId", type: "string (UUID)", required: true, description: "Document whose link to revoke" },
      ],
      output: {
        description: "`revoked` is false when the document had no live link.",
        example: { revoked: true },
      },
      codeExamples: {
        curl: `curl -X POST "${API_BASE_URL}/api/trpc/share.revoke" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -H "Content-Type: application/json" \\
  -d '{"json":{"documentId":"DOC_ID"}}'`,
        javascript: `const { revoked } = await trpc.share.revoke.mutate({ documentId: invoiceId });`,
      },
      gotchas: [
        "Requires `Invoice:update` permission.",
        "Deleting a document doesn't revoke its link, but the public endpoints answer 404 for deleted documents.",
      ],
      relatedEndpoints: ["share-create"],
    },
    {
      id: "share-public-document",
      method: "query",
      path: "GET /api/share/:token",
      title: "Public: Shared Document",
      description: "Raw HTTP endpoint (not tRPC), no authentication. Returns the shared document as JSON for the public share page and counts a view (best effort). `balance` is `totalAmount − amountPaid − amountAdjusted` (never below zero), where `amountAdjusted` sums non-cancelled credit notes and returns against the document.",
      auth: "public",
      input: [
        { name: "token", type: "string (path)", required: true, description: "The 43-character share token from the link URL" },
      ],
      output: {
        description: "`payment` is present when the business has a UPI id (with a pay URL and a QR code data URL); `bank` when it has a bank account number on its documents. `business.hasLogo` tells the page whether to request `/api/share/:token/logo`. `onlinePayment.available` says whether to offer Pay now (see `POST /api/share/:token/pay`). `poweredBy` is true when the plan shows the small \"Made with Fintranzact\" line (all three built-in plans do); `poweredByUrl` is where it links: sign-up with the referring partner's referral code (`/register?ref=CODE`), or null for the plain site. Errors: 404 `{ error: \"This link is not valid any more\" }`, 429 when rate limited.",
        example: {
          document: {
            documentType: "invoice",
            type: "sale",
            number: "INV-01482",
            date: "2026-09-18T00:00:00.000Z",
            dueDate: "2026-10-03T00:00:00.000Z",
            status: "partial",
            subtotal: "25000.00",
            taxAmount: "4500.00",
            discountAmount: "0.00",
            additionalCharges: "0.00",
            roundOff: "0.00",
            totalAmount: "29500.00",
            amountPaid: "10000.00",
            amountAdjusted: "0.00",
            balance: "19500.00",
            notes: null,
            terms: "Payment within 15 days.",
          },
          business: {
            name: "Mehta Hardware",
            legalName: "Mehta Hardware Pvt Ltd",
            gstin: "24AAACM1234B1Z9",
            phone: "9825012345",
            email: "accounts@mehtahardware.in",
            address: "12 Relief Road, Ahmedabad, Gujarat, 380001",
            hasLogo: true,
          },
          party: { name: "Sharma Traders", gstin: "27AAECS1234F1Z5", address: "Plot 4, MIDC, Pune, Maharashtra" },
          lineItems: [
            { name: "Door Hinge 4in", description: null, hsn: "8302", quantity: "500.000", unit: "pcs", unitPrice: "50.00", discountPercent: "0.00", taxPercent: "18.00", totalAmount: "29500.00" },
          ],
          payment: { upiId: "mehtahardware@okicici", payUrl: "https://api.example.com/pay/upi?...", qrDataUrl: "data:image/png;base64,iVBOR..." },
          bank: { accountName: "Mehta Hardware Pvt Ltd", accountNumber: "50200012345678", ifsc: "HDFC0000123", bankName: "HDFC Bank" },
          onlinePayment: { available: true },
          poweredBy: false,
          poweredByUrl: null,
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/share/SHARE_TOKEN"`,
        javascript: `const res = await fetch(\`${API_BASE_URL}/api/share/\${token}\`);
if (res.status === 404) throw new Error("Link revoked or invalid");
const { document, business, lineItems } = await res.json();`,
      },
      gotchas: [
        "No session, API key or business header is needed — possession of the token is the only credential.",
        "Every successful request increments the link's `viewCount`, including automated fetches.",
      ],
      relatedEndpoints: ["share-public-pdf", "share-public-logo", "share-create"],
    },
    {
      id: "share-public-pay",
      method: "mutation",
      path: "POST /api/share/:token/pay",
      title: "Public: Pay Now",
      description: "Raw HTTP endpoint (not tRPC), no authentication, no request body. Makes (or reuses) a Razorpay payment link for the shared invoice's current balance due on the business's own Razorpay account and returns its URL; the share page sends the customer there. The amount comes from the database, never from the request. Only offered when `onlinePayment.available` is true in `GET /api/share/:token` (the business connected Razorpay, the invoice is an issued sales invoice with at least ₹1 due, and the organisation is not read-only). Stricter rate limit than the page (10 per minute per client IP). No key or secret is ever in the response.",
      auth: "public",
      input: [
        { name: "token", type: "string (path)", required: true, description: "Share token" },
      ],
      output: {
        description: "`{ url }` with the Razorpay payment link. Errors: 404 `{ error: \"This link is not valid any more\" }` (unknown link, Razorpay not connected, read-only organisation), 409 when nothing can be paid online on the invoice, 502 when Razorpay could not make the link, 429 when rate limited.",
        example: { url: "https://rzp.io/i/abc123" },
      },
      codeExamples: {
        curl: `curl -X POST "${API_BASE_URL}/api/share/SHARE_TOKEN/pay"`,
        javascript: `const res = await fetch(\`${API_BASE_URL}/api/share/\${token}/pay\`, { method: "POST", credentials: "omit" });
if (res.ok) window.location.assign((await res.json()).url);`,
      },
      gotchas: [
        "The customer returns to the share page after paying; the invoice is updated by the business's Razorpay webhook, so it can take a moment.",
      ],
      relatedEndpoints: ["share-public-document", "online-payments-create-invoice-link"],
    },
    {
      id: "share-public-pdf",
      method: "query",
      path: "GET /api/share/:token/pdf",
      title: "Public: Shared Document PDF",
      description: "Raw HTTP endpoint, no authentication. Renders the shared document as a PDF download (`Content-Disposition: attachment; filename=\"<number>.pdf\"`). Does not count a view.",
      auth: "public",
      input: [
        { name: "token", type: "string (path)", required: true, description: "Share token" },
        { name: "format", type: "string (query)", required: false, description: "Page size — `a5`; anything else gives A4, in the business's chosen invoice design", default: "a4", enumValues: ["a4", "a5"] },
        { name: "copies", type: "string (query)", required: false, description: "A4 only: comma-separated copies to print, each on its own pages with its label (`original`, `duplicate`, `triplicate`, or `all`). Service invoices print original and duplicate only. Default: one copy" },
      ],
      output: {
        description: "`application/pdf` bytes. 404 JSON `{ error: \"This link is not valid any more\" }` for invalid links; 429 when rate limited.",
        example: "<binary PDF>",
      },
      codeExamples: {
        curl: `curl -o invoice.pdf "${API_BASE_URL}/api/share/SHARE_TOKEN/pdf?format=a4"`,
        javascript: `window.location.href = \`${API_BASE_URL}/api/share/\${token}/pdf\`;`,
      },
      gotchas: [
        "Unlike the signed-in `GET /api/invoices/:id/pdf`, the thermal format isn't offered here.",
      ],
      relatedEndpoints: ["share-public-document"],
    },
    {
      id: "share-public-logo",
      method: "query",
      path: "GET /api/share/:token/logo",
      title: "Public: Shared Document Logo",
      description: "Raw HTTP endpoint, no authentication. The issuing business's logo image for the share page, served with `nosniff`, a restrictive CSP and `Cross-Origin-Resource-Policy: cross-origin`.",
      auth: "public",
      input: [
        { name: "token", type: "string (path)", required: true, description: "Share token" },
      ],
      output: {
        description: "Image bytes with the stored MIME type (PNG/JPEG/WebP). 404 JSON `{ error: \"Not found\" }` when the token is invalid or the business has no logo; 429 when rate limited.",
        example: "<binary image>",
      },
      codeExamples: {
        curl: `curl -o logo.png "${API_BASE_URL}/api/share/SHARE_TOKEN/logo"`,
        javascript: `// Only when the document response says business.hasLogo
img.src = \`${API_BASE_URL}/api/share/\${token}/logo\`;`,
      },
      gotchas: [
        "Unlike the other two public endpoints, this one answers for a live token even if the shared document itself was deleted.",
      ],
      relatedEndpoints: ["share-public-document"],
    },
  ],
};
