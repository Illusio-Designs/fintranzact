import type { EndpointGroup } from "./types";
const API_BASE_URL = (import.meta.env.API_URL || (typeof window !== "undefined" ? window.location.origin : "https://fintranzact-production.up.railway.app")).replace(/\/$/, "");

export const partnerEndpoints: EndpointGroup = {
  id: "partner",
  title: "Partner Programme",
  description: "Public side of the partner programme: the \"Become a partner\" application and the directory of approved partners. Reviewing applications is done by platform admins and is not part of the public API.",
  endpoints: [
    {
      id: "partner-submit-application",
      method: "mutation",
      path: "partner.submitApplication",
      title: "Apply to Become a Partner",
      description: "Records a partner application for review. No account is created; the applicant is contacted once a platform admin approves it, and receives a referral code by email.",
      auth: "public",
      input: [
        { name: "contactName", type: "string", required: true, description: "Applicant's name, 2–100 characters." },
        { name: "companyName", type: "string", required: true, description: "Company or firm name, 2–150 characters." },
        { name: "email", type: "string", required: true, description: "Contact email (lower-cased). Only one pending application is allowed per email." },
        { name: "phone", type: "string", required: true, description: "8–16 digits, spaces or dashes, optional leading +." },
        { name: "city", type: "string", required: true, description: "2–80 characters." },
        { name: "state", type: "string", required: false, description: "Up to 80 characters." },
        { name: "website", type: "string", required: false, description: "A domain or URL, up to 200 characters." },
        { name: "partnerType", type: "enum", required: true, description: "Kind of partner.", enumValues: ["accountant", "reseller", "technology"] },
        { name: "clientCount", type: "enum", required: false, description: "Rough number of clients the applicant serves (values defined in packages/shared/src/partners.ts)." },
        { name: "message", type: "string", required: false, description: "Up to 1000 characters." },
        { name: "listPublicly", type: "boolean", required: false, default: "false", description: "Whether to appear in the public partner directory once approved." },
        { name: "turnstileToken", type: "string", required: false, description: "Cloudflare Turnstile token. Required when the server has TURNSTILE_SECRET_KEY set." },
      ],
      output: {
        description: "`{ received: true }` once the application is stored.",
        example: { received: true },
      },
      codeExamples: {
        curl: `curl -X POST "${API_BASE_URL}/api/trpc/partner.submitApplication" \\
  -H "Content-Type: application/json" \\
  -d '{"json":{"contactName":"Priya Shah","companyName":"Shah & Co","email":"priya@example.in","phone":"+91 98200 00000","city":"Pune","partnerType":"accountant"}}'`,
        javascript: `await trpc.partner.submitApplication.mutate({
  contactName: "Priya Shah",
  companyName: "Shah & Co",
  email: "priya@example.in",
  phone: "+91 98200 00000",
  city: "Pune",
  partnerType: "accountant",
});`,
      },
      gotchas: [
        "CONFLICT when a pending application already exists for the same email.",
        "FORBIDDEN (\"Verification failed\") when Turnstile is configured and the token is missing or invalid.",
      ],
      relatedEndpoints: ["partner-directory"],
    },
    {
      id: "partner-directory",
      method: "query",
      path: "partner.directory",
      title: "Partner Directory",
      description: "Approved partners who chose to be listed, sorted by company name, each with their badge. Contact details (email, phone) and commission rates are never returned.",
      auth: "public",
      input: [],
      output: {
        description: "Array of partners. `badge` is one of registered, silver, gold or platinum, based on how many organisations the partner referred that are on a paid plan.",
        example: [
          { id: "8f0c…", companyName: "Shah & Co", city: "Pune", state: "Maharashtra", website: "shahco.in", partnerType: "accountant", badge: "silver" },
        ],
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/partner.directory"`,
        javascript: `const partners = await trpc.partner.directory.query();`,
      },
      relatedEndpoints: ["partner-submit-application"],
    },
  ],
};

export const contactEndpoints: EndpointGroup = {
  id: "contact",
  title: "Contact Enquiries",
  description: "The marketing site's contact form. The enquiry is emailed to the Fintranzact inbox with Reply-To set to the sender.",
  endpoints: [
    {
      id: "contact-submit",
      method: "mutation",
      path: "contact.submit",
      title: "Send an Enquiry",
      description: "Emails an enquiry to the Fintranzact inbox (CONTACT_INBOX, default support@fintranzact.com). `kind: \"contact\"` is a general message; `kind: \"partner\"` carries partner-programme details. Without an email provider configured the enquiry is logged instead.",
      auth: "public",
      input: [
        { name: "kind", type: "enum", required: true, description: "Which form sent it.", enumValues: ["contact", "partner"] },
        { name: "name", type: "string", required: true, description: "2–100 characters, single line." },
        { name: "email", type: "string", required: true, description: "Sender's email; used as Reply-To." },
        { name: "message", type: "string", required: false, description: "Required for `contact` (10–5000 characters); optional for `partner` (up to 5000)." },
        { name: "programme", type: "enum", required: false, description: "`partner` only (required there).", enumValues: ["accountant", "reseller", "technology"] },
        { name: "company", type: "string", required: false, description: "`partner` only. Single line, up to 150 characters." },
        { name: "phone", type: "string", required: false, description: "`partner` only. Single line, up to 30 characters." },
        { name: "city", type: "string", required: false, description: "`partner` only. Single line, up to 100 characters." },
        { name: "turnstileToken", type: "string", required: false, description: "Cloudflare Turnstile token. Required when the server has TURNSTILE_SECRET_KEY set." },
        { name: "website", type: "string", required: false, description: "Honeypot field — leave empty. Submissions that fill it are accepted but silently dropped." },
      ],
      output: {
        description: "`{ success: true }` when the enquiry was accepted (also returned for silently dropped honeypot submissions).",
        example: { success: true },
      },
      codeExamples: {
        curl: `curl -X POST "${API_BASE_URL}/api/trpc/contact.submit" \\
  -H "Content-Type: application/json" \\
  -d '{"json":{"kind":"contact","name":"Rahul","email":"rahul@example.in","message":"Can Fintranzact print thermal receipts?"}}'`,
        javascript: `await trpc.contact.submit.mutate({
  kind: "contact",
  name: "Rahul",
  email: "rahul@example.in",
  message: "Can Fintranzact print thermal receipts?",
});`,
      },
      gotchas: [
        "Limited to 5 submissions per IP address every 15 minutes (TOO_MANY_REQUESTS), on top of the general per-IP API limit.",
        "Single-line fields reject line breaks.",
        "Partner-programme applications that should be reviewed in the platform go through `partner.submitApplication`; the web partners page uses that.",
      ],
      relatedEndpoints: ["partner-submit-application"],
    },
  ],
};
