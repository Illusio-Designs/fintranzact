import type { EndpointGroup } from "./types";
import { API_BASE_URL } from "./api-base";

export const tenantEndpoints: EndpointGroup = {
  id: "tenant",
  title: "Organizations",
  description: "Manage organizations (tenants). Each organization can contain multiple businesses. Handle member invitations, role assignments, and organization switching. In multi-tenant mode, each user gets their own organization on registration.",
  endpoints: [
    {
      id: "tenant-create",
      method: "mutation",
      path: "tenant.create",
      title: "Create Organization",
      description: "Create a new organization for the authenticated user. The user becomes the owner. In multi-tenant mode (`MULTI_TENANT=true`), a dedicated database is provisioned for the new organization. In self-hosted mode, the user joins or creates the default organization instead. The new organization is auto-selected in the current session.",
      auth: "protected",
      input: [],
      output: {
        description: "The new organization's ID and name. The session is updated to point to this organization.",
        example: {
          tenantId: "01957a2b-3c4d-7e8f-9012-abcdef012345",
          tenantName: "Rahul's Organization",
        },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/tenant.create \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -d '{"json":{}}'`,
        javascript: `const result = await trpc.tenant.create.mutate();
console.log("Created org:", result.tenantName);
// Session is auto-switched to the new organization`,
        python: `import httpx

resp = httpx.post(
    "${API_BASE_URL}/api/trpc/tenant.create",
    headers={"Authorization": f"Bearer {session_token}"},
    json={"json": {}},
)
data = resp.json()["result"]["data"]["json"]
print("New org:", data["tenantName"])`,
      },
      gotchas: [
        "Enforces plan limits — free tier users can only own a limited number of organizations. Returns FORBIDDEN if the limit is reached.",
        "In multi-tenant mode, this provisions a new PostgreSQL database for the organization. If provisioning fails, the tenant row is rolled back automatically.",
        "In self-hosted mode (`MULTI_TENANT` not set), all users share the default organization. The first user becomes the owner; subsequent users get the `member` role.",
        "The session's tenantId is updated automatically — no need to call `tenant.select` after creation.",
      ],
    },
    {
      id: "tenant-can-create-org",
      method: "query",
      path: "tenant.canCreateOrg",
      title: "Check Organization Creation Limit",
      description: "Check whether the authenticated user can create a new organization based on their plan limits. Looks at all organizations the user owns, picks the highest plan tier, and checks whether the org count is within that plan's `maxOwnedOrgs` limit.",
      auth: "protected",
      input: [],
      output: {
        description: "Boolean indicating whether the user can create another organization.",
        example: true,
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/tenant.canCreateOrg" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"`,
        javascript: `const canCreate = await trpc.tenant.canCreateOrg.query();
if (canCreate) {
  // Show "Create Organization" button
}`,
        python: `import httpx

resp = httpx.get(
    "${API_BASE_URL}/api/trpc/tenant.canCreateOrg",
    headers={"Authorization": f"Bearer {session_token}"},
)
can_create = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "This is a `query` (GET) — not a mutation. Use `.query()` not `.mutate()`.",
        "Use this check before showing a 'Create Organization' button in the UI to avoid showing actions that will fail server-side.",
      ],
    },
    {
      id: "tenant-list",
      method: "query",
      path: "tenant.list",
      title: "List Organizations",
      description: "List all organizations the authenticated user is a member of. Returns only active organizations with the user's role, plan, and display information. Used for the organization switcher UI.",
      auth: "protected",
      input: [],
      output: {
        description: "Array of organization memberships with tenant details.",
        example: [
          {
            tenantId: "01957a2b-3c4d-7e8f-9012-abcdef012345",
            role: "owner",
            tenantName: "Gupta Trading Co.",
            tenantSlug: "gupta-trading-co-abc123",
            tenantPlan: "pro",
          },
          {
            tenantId: "01957a2b-4d5e-6f78-9012-abcdef543210",
            role: "member",
            tenantName: "Sharma Enterprises",
            tenantSlug: "sharma-enterprises-xyz789",
            tenantPlan: "free",
          },
        ],
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/tenant.list" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"`,
        javascript: `const orgs = await trpc.tenant.list.query();
for (const org of orgs) {
  console.log(\`\${org.tenantName} — role: \${org.role}, plan: \${org.tenantPlan}\`);
}`,
        python: `import httpx

resp = httpx.get(
    "${API_BASE_URL}/api/trpc/tenant.list",
    headers={"Authorization": f"Bearer {session_token}"},
)
orgs = resp.json()["result"]["data"]["json"]
for org in orgs:
    print(f"{org['tenantName']} — {org['role']}")`,
      },
      gotchas: [
        "Only returns organizations with `status = 'active'` — deactivated orgs are excluded.",
        "The `role` reflects the user's role within that organization, not a global role.",
      ],
    },
    {
      id: "tenant-list-clients",
      method: "query",
      path: "tenant.listClients",
      title: "List Clients (Switcher)",
      description: "The organization switcher's list: every active organization the caller belongs to (their own firm and the clients they have accountant access to), pinned first, then most recently opened, then by name. Searchable, scoped and paged. Needs no selected organization. Use tenant.list when you only need the plain memberships.",
      auth: "protected",
      input: [
        { name: "search", type: "string", required: false, description: "Case-insensitive part of the organization name. Matched literally: % and _ are ordinary characters." },
        { name: "scope", type: "enum", required: false, description: "all (default), mine (organizations you own) or clients (everything else)", enumValues: ["all", "mine", "clients"] },
        { name: "cursor", type: "string", required: false, description: "nextCursor from the previous page" },
        { name: "limit", type: "number", required: false, description: "Items per page (default 30, max 100)" },
      ],
      output: {
        description: "A page of organizations, the cursor for the next page (null on the last page), the number of matches, and whole-list counts that ignore search and scope.",
        example: {
          items: [
            {
              tenantId: "01957a2b-3c4d-7e8f-9012-abcdef012345",
              name: "Acme Traders",
              slug: "acme-traders-abc123",
              role: "auditor",
              roleLabel: "Accountant (read-only)",
              isOwnFirm: false,
              isClient: true,
              isCa: true,
              plan: "business",
              pinned: true,
              lastOpenedAt: "2026-10-01T10:00:00.000Z",
            },
          ],
          nextCursor: null,
          total: 1,
          counts: { all: 3, mine: 1, clients: 2, pinned: 1 },
        },
      },
      codeExamples: {
        curl: `curl -G "${API_BASE_URL}/api/trpc/tenant.listClients" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  --data-urlencode 'input={"json":{"search":"acme","scope":"clients"}}'`,
        javascript: `const page = await trpc.tenant.listClients.query({ search: "acme", limit: 30 });
for (const c of page.items) console.log(c.pinned ? "*" : " ", c.name, c.roleLabel);
if (page.nextCursor) await trpc.tenant.listClients.query({ cursor: page.nextCursor });`,
        python: `import httpx, json

resp = httpx.get(
    "${API_BASE_URL}/api/trpc/tenant.listClients",
    params={"input": json.dumps({"json": {"scope": "clients"}})},
    headers={"Authorization": f"Bearer {session_token}"},
)
page = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "Order is pinned first, then lastOpenedAt descending (never opened last), then name, then id. Paging is a keyset on that order: a cursor stays correct if something is pinned or opened between pages.",
        "Ordering, search and paging are done in memory over one indexed query (an accountant has at most a few hundred organizations).",
        "Only active organizations are listed, as in tenant.list.",
        "pinned and lastOpenedAt belong to the caller only. lastOpenedAt is refreshed by tenant.select, at most every 5 minutes.",
        "isOwnFirm is true for owner/superadmin; isClient is its opposite; isCa is true for the accountant roles (auditor, ca_filing).",
      ],
      relatedEndpoints: ["tenant-list", "tenant-select", "tenant-set-pinned", "tenant-leave"],
    },
    {
      id: "tenant-set-pinned",
      method: "mutation",
      path: "tenant.setPinned",
      title: "Pin an Organization",
      description: "Pin or unpin an organization in the caller's own switcher. Pins are private to the caller.",
      auth: "protected",
      input: [
        { name: "tenantId", type: "string (uuid)", required: true, description: "An organization the caller is a member of" },
        { name: "pinned", type: "boolean", required: true, description: "true to pin, false to unpin" },
      ],
      output: { description: "The new state.", example: { success: true, pinned: true } },
      codeExamples: {
        curl: `curl -X POST "${API_BASE_URL}/api/trpc/tenant.setPinned" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"json":{"tenantId":"ORG_UUID","pinned":true}}'`,
        javascript: `await trpc.tenant.setPinned.mutate({ tenantId, pinned: true });`,
        python: `httpx.post(
    "${API_BASE_URL}/api/trpc/tenant.setPinned",
    json={"json": {"tenantId": tenant_id, "pinned": True}},
    headers={"Authorization": f"Bearer {session_token}"},
)`,
      },
      gotchas: [
        "FORBIDDEN unless the caller is a member of the organization.",
        "At most 20 pinned organizations: pinning a 21st is a BAD_REQUEST. Pinning something already pinned, or unpinning something not pinned, changes nothing.",
        "Allowed in read-only and suspended states (it only changes the caller's own preferences).",
      ],
      relatedEndpoints: ["tenant-list-clients"],
    },
    {
      id: "tenant-leave",
      method: "mutation",
      path: "tenant.leave",
      title: "Leave an Organization",
      description: "The caller ends their own membership of an organization they do not own (an accountant leaving a client). Same cleanup as being removed: the person's business access, their API keys for the organization, their invitation rows and the organization on their sessions. Records an access.left event and emails the organization's owners.",
      auth: "protected",
      input: [
        { name: "tenantId", type: "string (uuid)", required: true, description: "The organization to leave" },
      ],
      output: { description: "Confirmation.", example: { success: true } },
      codeExamples: {
        curl: `curl -X POST "${API_BASE_URL}/api/trpc/tenant.leave" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"json":{"tenantId":"ORG_UUID"}}'`,
        javascript: `await trpc.tenant.leave.mutate({ tenantId });`,
        python: `httpx.post(
    "${API_BASE_URL}/api/trpc/tenant.leave",
    json={"json": {"tenantId": tenant_id}},
    headers={"Authorization": f"Bearer {session_token}"},
)`,
      },
      gotchas: [
        "Owners and superadmins cannot leave (FORBIDDEN): transfer ownership or delete the organization instead. NOT_FOUND if the caller is not a member.",
        "Takes effect immediately: the caller's sessions lose the organization (they must choose another), and their API keys for it are deleted.",
        "Logged as access.left (not access.removed), with metadata.removedBy set to the caller. The owners get an email 'X left your organisation'; a failed email does not undo the leave.",
        "To come back, an owner or admin must invite the person again.",
        "tenant.removeMember still refuses removing yourself; leaving is this procedure.",
      ],
      relatedEndpoints: ["tenant-remove-member", "tenant-access-log", "tenant-list-clients"],
    },
    {
      id: "tenant-my-invitations",
      method: "query",
      path: "tenant.myInvitations",
      title: "My Pending Invitations",
      description: "List pending organization invitations for the authenticated user's email address. Used by the NoOrgScreen to show 'You've been invited to [Org]' when a user has no organization membership yet. Only returns invitations that have not been accepted and have not expired.",
      auth: "protected",
      input: [],
      output: {
        description: "Array of pending invitations with organization name, assigned role, who invited the user, the role's display label and (for accountant roles) what that access allows.",
        example: [
          {
            id: "01957a2b-9999-aaaa-bbbb-ccccddddeeee",
            tenantName: "Gupta Trading Co.",
            role: "ca_filing",
            invitedByName: "Rohit Gupta",
            roleLabel: "Accountant (filing)",
            accessDescription: "Can view everything, prepare and file GST returns, and download reports. Cannot create or edit sales, purchases, payments or other records.",
          },
        ],
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/tenant.myInvitations" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"`,
        javascript: `const invites = await trpc.tenant.myInvitations.query();
if (invites.length > 0) {
  console.log("You have pending invitations!");
  // Show accept/decline UI
}`,
        python: `import httpx

resp = httpx.get(
    "${API_BASE_URL}/api/trpc/tenant.myInvitations",
    headers={"Authorization": f"Bearer {session_token}"},
)
invites = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "Matches invitations by the user's email (case-insensitive, whatever case the inviter typed).",
        "`accessDescription` is `null` for non-accountant roles; `invitedByName` is `null` if the inviter has no name.",
        "Expired invitations (older than 7 days) are automatically excluded.",
        "To accept an invitation from this list, use `tenant.acceptById` with the invitation ID.",
      ],
      relatedEndpoints: ["tenant-accept-by-id"],
    },
    {
      id: "tenant-accept-by-id",
      method: "mutation",
      path: "tenant.acceptById",
      title: "Accept Invitation by ID",
      description: "Accept an organization invitation by its ID. Used when the user sees pending invitations in-app (from `tenant.myInvitations`) and clicks accept — no email token needed. Verifies the invitation belongs to the user's email. If the user is already a member, idempotently marks the invitation as accepted and selects the organization.",
      auth: "protected",
      input: [
        { name: "invitationId", type: "string (UUID)", required: true, description: "The invitation ID from `tenant.myInvitations`" },
      ],
      output: {
        description: "The organization the user joined. Session is auto-switched.",
        example: {
          tenantId: "01957a2b-3c4d-7e8f-9012-abcdef012345",
          tenantName: "Gupta Trading Co.",
        },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/tenant.acceptById \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -d '{"json":{"invitationId":"01957a2b-9999-aaaa-bbbb-ccccddddeeee"}}'`,
        javascript: `const result = await trpc.tenant.acceptById.mutate({
  invitationId: "01957a2b-9999-aaaa-bbbb-ccccddddeeee",
});
console.log("Joined:", result.tenantName);
// Session is now pointed at this organization`,
        python: `import httpx

resp = httpx.post(
    "${API_BASE_URL}/api/trpc/tenant.acceptById",
    headers={"Authorization": f"Bearer {session_token}"},
    json={"json": {"invitationId": "01957a2b-9999-aaaa-bbbb-ccccddddeeee"}},
)
data = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "Returns NOT_FOUND if the invitation doesn't exist, has expired, or belongs to a different email.",
        "Idempotent — calling this multiple times for the same invitation is safe.",
        "The session is auto-selected to the joined organization — no need to call `tenant.select`.",
        "Membership creation and invitation acceptance happen atomically in a transaction.",
      ],
      relatedEndpoints: ["tenant-my-invitations", "tenant-accept-invitation"],
    },
    {
      id: "tenant-select",
      method: "mutation",
      path: "tenant.select",
      title: "Switch Organization",
      description: "Switch the current session to a different organization. Updates the session's `tenantId` and invalidates the in-process session cache so subsequent requests pick up the new organization context. The user must be a member of the target organization.",
      auth: "protected",
      input: [
        { name: "tenantId", type: "string (UUID)", required: true, description: "The organization to switch to" },
      ],
      output: {
        description: "Success confirmation.",
        example: { success: true },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/tenant.select \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -d '{"json":{"tenantId":"01957a2b-3c4d-7e8f-9012-abcdef012345"}}'`,
        javascript: `await trpc.tenant.select.mutate({
  tenantId: "01957a2b-3c4d-7e8f-9012-abcdef012345",
});
// All subsequent API calls now operate under the selected organization`,
        python: `import httpx

httpx.post(
    "${API_BASE_URL}/api/trpc/tenant.select",
    headers={"Authorization": f"Bearer {session_token}"},
    json={"json": {"tenantId": "01957a2b-3c4d-7e8f-9012-abcdef012345"}},
)`,
      },
      gotchas: [
        "Returns FORBIDDEN if the user is not a member of the target organization.",
        "The session cache is invalidated immediately — no stale data on the next request.",
        "After switching, all `tenantProcedure` and `businessProcedure` calls operate under the new organization.",
        "The selection belongs to the session, not to a browser tab: two tabs on one session share it. Send `x-business-id` per request to pick a business; there is no per-request organization.",
        "Records when the caller last opened the organization (shown as Recent in the switcher), at most once every 5 minutes. A failure to record it never fails the selection.",
      ],
    },
    {
      id: "tenant-current",
      method: "query",
      path: "tenant.current",
      title: "Get Current Organization",
      description: "Returns full details of the currently selected organization (tenant). Requires that the session has a selected tenant (use `tenant.select` first if needed).",
      auth: "protected",
      input: [],
      output: {
        description: "Full tenant record or null if not found.",
        example: {
          id: "01957a2b-3c4d-7e8f-9012-abcdef012345",
          name: "Gupta Trading Co.",
          slug: "gupta-trading-co-abc123",
          plan: "pro",
          status: "active",
          createdAt: "2026-01-15T05:30:00.000Z",
          twoFactorPolicy: "admins",
          twoFactorGraceDays: 7,
          twoFactorRequirement: {
            required: true,
            blocked: false,
            graceEndsAt: "2026-02-01T05:30:00.000Z",
            policy: "admins",
            setupPath: "/settings?tab=account&pane=security",
          },
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/tenant.current" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"`,
        javascript: `const org = await trpc.tenant.current.query();
console.log("Current org:", org?.name, "Plan:", org?.plan);`,
        python: `import httpx

resp = httpx.get(
    "${API_BASE_URL}/api/trpc/tenant.current",
    headers={"Authorization": f"Bearer {session_token}"},
)
org = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "Uses `tenantProcedure` — requires a session with a selected organization. Returns BAD_REQUEST \"No organization selected\" if no tenant is selected (UNAUTHORIZED only when there is no session at all).",
        "An explicit column list is returned (`id`, `name`, `slug`, `referralCode`, `partnerId`, `plan`, `status`, `createdAt`, `updatedAt`, `twoFactorPolicy`, `twoFactorGraceDays`, `twoFactorRequirement`). The tenant database connection fields are never returned.",
        "`twoFactorPolicy` is `off`, `admins` (owners, superadmins and admins) or `all`. `twoFactorRequirement` is what the CALLER must do: `required` (their role is covered and they have no two-factor), `blocked` (the grace period is over), `graceEndsAt` (the deadline, null when not required), `policy` and `setupPath`. It is always `required: false` for API keys, which never do two-factor.",
        "This is one of the two organisation-scoped calls (with `billing.status`) that still work for a member who is blocked by the two-factor policy, so a client can show the banner or redirect to `setupPath`. Every other organisation-scoped call fails with FORBIDDEN and `error.data.twoFactor = { required: true, reason: \"two_factor_setup_required\", setupPath }`.",
        "Returns `null` if the tenant row no longer exists (edge case after deletion).",
      ],
    },
    {
      id: "tenant-members",
      method: "query",
      path: "tenant.members",
      title: "List Members",
      description: "List all members of the currently selected organization. Returns user details (name, email) along with their role and membership dates. Useful for the team management page. For owners and admins, a CA member (`auditor` / `ca_filing`) whose e-mail belongs to an approved accountant partner with a verified account also carries `caPartner: { id, companyName }` (the \"Registered CA partner\" badge); `caPartner` is `null` for everyone else.",
      auth: "protected",
      input: [],
      output: {
        description: "Array of organization members with user details.",
        example: [
          {
            id: "membership-uuid",
            userId: "user-uuid-1",
            role: "owner",
            acceptedAt: "2026-01-15T05:30:00.000Z",
            createdAt: "2026-01-15T05:30:00.000Z",
            userName: "Rahul Sharma",
            userEmail: "rahul@guptaenterprises.in",
            twoFactorEnabled: true,
            lastOpenedAt: null,
            caPartner: null,
          },
          {
            id: "membership-uuid-2",
            userId: "user-uuid-2",
            role: "seller",
            acceptedAt: "2026-02-10T11:00:00.000Z",
            createdAt: "2026-02-10T10:45:00.000Z",
            userName: "Priya Patel",
            userEmail: "priya@guptaenterprises.in",
          },
        ],
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/tenant.members" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"`,
        javascript: `const members = await trpc.tenant.members.query();
for (const m of members) {
  console.log(\`\${m.userName} (\${m.userEmail}) — \${m.role}\`);
}`,
        python: `import httpx

resp = httpx.get(
    "${API_BASE_URL}/api/trpc/tenant.members",
    headers={"Authorization": f"Bearer {session_token}"},
)
members = resp.json()["result"]["data"]["json"]
for m in members:
    print(f"{m['userName']} — {m['role']}")`,
      },
      gotchas: [
        "Uses `tenantProcedure` — requires a selected organization in the session.",
        "Returns all members regardless of role — filter client-side if needed.",
        "`twoFactorEnabled` (whether the member has set up two-factor authentication) is returned ONLY to owner, superadmin and admin callers; for everyone else it is `undefined`.",
      ],
    },
    {
      id: "tenant-set-security-policy",
      method: "mutation",
      path: "tenant.setSecurityPolicy",
      title: "Set Two-Factor Policy",
      description: "Require two-factor authentication in the selected organization: for nobody (`off`), for owners, superadmins and admins (`admins`), or for every member (`all`). Members who have not set it up get a grace period, then are blocked from the organization until they do. Only the organization owner (or a superadmin) can call it, and only if their own account has two-factor on. Recorded in the security trail as `2fa.policy_changed`.",
      auth: "protected",
      input: [
        { name: "policy", type: "enum", required: true, description: "Who must use two-factor authentication.", enumValues: ["off", "admins", "all"] },
        { name: "graceDays", type: "number", required: false, description: "Days members have to set it up before they are blocked (0 to 30). Omit to keep the current value (7 by default). 0 blocks at once." },
      ],
      output: {
        description: "The stored policy.",
        example: { policy: "all", graceDays: 7, enforcedAt: "2026-06-15T12:00:00.000Z" },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/tenant.setSecurityPolicy \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -d '{"json":{"policy":"all","graceDays":7}}'`,
        javascript: `await trpc.tenant.setSecurityPolicy.mutate({ policy: "all", graceDays: 7 });`,
        python: `import httpx

resp = httpx.post(
    "${API_BASE_URL}/api/trpc/tenant.setSecurityPolicy",
    headers={"Authorization": f"Bearer {session_token}"},
    json={"json": {"policy": "all", "graceDays": 7}},
)`,
      },
      gotchas: [
        "Owner and superadmin only (FORBIDDEN for everyone else). A policy other than `off` is refused with BAD_REQUEST \"Turn on two-factor authentication for your own account first.\" unless the caller has two-factor on, so nobody can lock themselves out.",
        "Tightening (`off` to `admins` or `all`, or `admins` to `all`) and changing `graceDays` while a policy is on restart everyone's grace period (`enforcedAt` becomes now). Relaxing keeps it. `off` clears it and blocks nobody.",
        "Uses `tenantProcedure` and is allowed while the organization is read-only (tightening security is never refused for plan reasons).",
        "API keys are never subject to the policy. A member who is blocked can still sign in, list and select organizations, call `tenant.current` and `billing.status`, and set up two-factor; see `tenant.current`.",
      ],
    },
    {
      id: "tenant-invite-member",
      method: "mutation",
      path: "tenant.inviteMember",
      title: "Invite Member",
      description: "Send an invitation to join the current organization. The invitation is emailed to the specified address with a unique, one-time token. Owners and admins can invite staff roles; only the owner (or superadmin) can invite an accountant (CA) role (`auditor` or `ca_filing`). Enforces team member limits based on the organization's plan, except for CA roles, which are outside that limit but capped at 3 per organization.",
      auth: "protected",
      input: [
        { name: "email", type: "string (email)", required: true, description: "Email address to invite. Trimmed and lowercased before it is stored or compared." },
        { name: "role", type: "enum", required: false, description: "Role to assign when invitation is accepted. `auditor` (Accountant, read-only) and `ca_filing` (Accountant, filing) are owner-only.", default: "seller", enumValues: ["admin", "seller_manager", "seller", "accountant", "auditor", "ca_filing"] },
        { name: "creditPartner", type: "boolean", required: false, description: "CA roles only (ignored for other roles). The owner's opt-in: \"This CA referred me to Fintranzact, credit them as my partner\". Refused (BAD_REQUEST) unless the e-mail belongs to an approved accountant partner. When the CA accepts and the organisation has no partner yet, the organisation is credited to that partner (`tenants.partnerId`) and `access.partner_attributed` is logged. Default off: accepting a CA invite never credits anyone on its own.", default: "false" },
      ],
      output: {
        description: "The raw invitation token, the ready-made invite link, the role invited and the expiration date.",
        example: {
          token: "abc123def456ghi789jkl012mno345pq",
          inviteUrl: "https://app.fintranzact.com/invite/abc123def456ghi789jkl012mno345pq",
          role: "seller",
          expiresAt: "2026-04-15T05:30:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/tenant.inviteMember \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -d '{"json":{"email":"priya@guptaenterprises.in","role":"seller"}}'`,
        javascript: `const invite = await trpc.tenant.inviteMember.mutate({
  email: "priya@guptaenterprises.in",
  role: "seller",
});
console.log("Invitation sent, expires:", invite.expiresAt);`,
        python: `import httpx

resp = httpx.post(
    "${API_BASE_URL}/api/trpc/tenant.inviteMember",
    headers={"Authorization": f"Bearer {session_token}"},
    json={"json": {"email": "priya@guptaenterprises.in", "role": "seller"}},
)
data = resp.json()["result"]["data"]["json"]
print("Token:", data["token"])`,
      },
      gotchas: [
        "Only owners, superadmins, and admins can invite members. Returns FORBIDDEN otherwise.",
        "Returns CONFLICT if the email is already a member of the organization.",
        "Returns CONFLICT if a pending (unexpired) invitation for this email already exists.",
        "Invitations expire after 7 days. The token is a 32-character nanoid with ~192 bits of entropy.",
        "The token is hashed (SHA-256) before storage — only the raw token sent via email can be used to accept.",
        "If RESEND_API_KEY is not configured, the invitation email is skipped (but the invitation is still created).",
        "Enforces team member plan limits before creating the invitation. Accountant (CA) roles do not count towards the limit, as members or as pending invitations.",
        "Inviting `auditor` or `ca_filing` as an admin returns FORBIDDEN (\"Only the owner can invite an accountant (CA)\"). More than 3 CAs (members plus pending CA invitations) returns CONFLICT.",
        "Accountant roles get an accountant-specific email (\"X has invited you as their accountant on Fintranzact\") that states the access level, that access can be removed at any time and that activity is logged.",
        "The invited email is stored lowercase, and duplicate and already-a-member checks are case-insensitive, so `Anita.Shah@Firm.IN` and `anita.shah@firm.in` are the same invitee.",
      ],
      relatedEndpoints: ["tenant-accept-invitation", "tenant-pending-invitations", "tenant-revoke-invitation"],
    },
    {
      id: "tenant-peek-invitation",
      method: "query",
      path: "tenant.peekInvitation",
      title: "Peek Invitation",
      description: "Preview invitation details without accepting it. Used by the onboarding flow to show 'Join [Org] or create your own?' before committing. Public because new users may not have a session yet. Deliberately omits the invitee's email to prevent PII leakage via token possession.",
      auth: "public",
      input: [
        { name: "token", type: "string", required: true, description: "The raw invitation token from the email link (1-128 chars)" },
      ],
      output: {
        description: "Organization name, role, who invited, the role label and (accountant roles) the access description, or null if the token is invalid/expired/already accepted.",
        example: {
          tenantName: "Gupta Trading Co.",
          role: "auditor",
          invitedByName: "Rohit Gupta",
          roleLabel: "Accountant (read-only)",
          accessDescription: "Can view everything and download reports. Cannot change anything.",
        },
      },
      codeExamples: {
        curl: `# Token comes from the /invite/:token URL
curl "${API_BASE_URL}/api/trpc/tenant.peekInvitation?input=%7B%22json%22%3A%7B%22token%22%3A%22abc123def456ghi789jkl012mno345pq%22%7D%7D"`,
        javascript: `// Extract token from URL: /invite/abc123def456...
const token = params.token;

const preview = await trpc.tenant.peekInvitation.query({ token });
if (preview) {
  console.log(\`Invited to \${preview.tenantName} as \${preview.role}\`);
} else {
  console.log("Invitation is invalid or expired");
}`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"token": "abc123def456ghi789jkl012mno345pq"}}))
resp = httpx.get(f"${API_BASE_URL}/api/trpc/tenant.peekInvitation?input={params}")
preview = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "This is a public endpoint — no authentication required.",
        "Returns `null` (not an error) if the token is invalid, expired, or already accepted.",
        "Security: the response deliberately omits the invitee email to prevent PII leakage. It does include the inviter's display name, the role label and, for CA roles, `accessDescription` (otherwise `null`).",
        "The token has ~192 bits of entropy (nanoid(32)), making brute-force infeasible.",
      ],
      relatedEndpoints: ["tenant-accept-invitation"],
    },
    {
      id: "tenant-accept-invitation",
      method: "mutation",
      path: "tenant.acceptInvitation",
      title: "Accept Invitation by Token",
      description: "Accept an organization invitation using the raw token from the email link. Verifies the token, checks the invitation email matches the authenticated user's email, creates membership, and marks the invitation as accepted — all atomically in a transaction. Idempotent: re-accepting an already-accepted invitation is safe and will re-add the user if they were removed.",
      auth: "protected",
      input: [
        { name: "token", type: "string", required: true, description: "The raw invitation token from the email link" },
      ],
      output: {
        description: "The organization the user joined. Session is auto-switched.",
        example: {
          tenantId: "01957a2b-3c4d-7e8f-9012-abcdef012345",
          tenantName: "Gupta Trading Co.",
        },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/tenant.acceptInvitation \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -d '{"json":{"token":"abc123def456ghi789jkl012mno345pq"}}'`,
        javascript: `const result = await trpc.tenant.acceptInvitation.mutate({
  token: "abc123def456ghi789jkl012mno345pq",
});
console.log("Joined:", result.tenantName);
// Session is now pointed at the joined organization`,
        python: `import httpx

resp = httpx.post(
    "${API_BASE_URL}/api/trpc/tenant.acceptInvitation",
    headers={"Authorization": f"Bearer {session_token}"},
    json={"json": {"token": "abc123def456ghi789jkl012mno345pq"}},
)
data = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "Returns NOT_FOUND if the token is invalid or expired.",
        "Returns FORBIDDEN if the invitation was sent to a different email than the authenticated user's.",
        "Idempotent — re-accepting an already-accepted invitation is safe. If the user was removed and re-accepts, they are re-added.",
        "Membership creation and invitation acceptance are wrapped in a transaction to prevent partial state.",
        "The session is auto-selected to the joined organization.",
      ],
      relatedEndpoints: ["tenant-peek-invitation", "tenant-accept-by-id"],
    },
    {
      id: "tenant-pending-invitations",
      method: "query",
      path: "tenant.pendingInvitations",
      title: "List Pending Invitations",
      description: "List all pending (not yet accepted) invitations for the current organization. Shows the invitee email, assigned role, and who sent the invitation. Only includes unexpired invitations. A pending CA invitation to an approved accountant partner carries `caPartner: { id, companyName }` (otherwise `null`). Used in the team management UI to show outstanding invites.",
      auth: "protected",
      input: [],
      output: {
        description: "Array of pending invitations sorted by creation date (newest first).",
        example: [
          {
            id: "invite-uuid-1",
            email: "priya@guptaenterprises.in",
            role: "seller",
            createdAt: "2026-04-08T10:30:00.000Z",
            expiresAt: "2026-04-15T10:30:00.000Z",
            invitedByName: "Rahul Sharma",
            caPartner: null,
          },
        ],
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/tenant.pendingInvitations" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"`,
        javascript: `const pending = await trpc.tenant.pendingInvitations.query();
console.log(\`\${pending.length} pending invitations\`);`,
        python: `import httpx

resp = httpx.get(
    "${API_BASE_URL}/api/trpc/tenant.pendingInvitations",
    headers={"Authorization": f"Bearer {session_token}"},
)
pending = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "Uses `tenantProcedure` — requires a selected organization in the session.",
        "Only shows unexpired, unaccepted invitations. Expired invitations are filtered out automatically.",
        "Each row also carries `roleLabel` (e.g. \"Accountant (filing)\") and `accessDescription` (what an accountant CA role can do, `null` for other roles).",
      ],
      relatedEndpoints: ["tenant-invite-member", "tenant-revoke-invitation"],
    },
    {
      id: "tenant-access-log",
      method: "query",
      path: "tenant.accessLog",
      title: "Access Log",
      description: "The organization's access log, newest first: who was invited, who accepted, role changes, removals, when an accountant (CA) opened the books and which reports they downloaded. Only owners, superadmins and admins can read it. It is kept without a time limit (it is not subject to the plan's audit retention). What a CA changed or filed is in business.auditTrail.",
      auth: "protected",
      input: [
        { name: "cursor", type: "string", required: false, description: "nextCursor from the previous page (\"<createdAt ms>_<id>\"). Keyset paging: no events are skipped or repeated, even with equal timestamps." },
        { name: "limit", type: "number", required: false, description: "Events per page (default 25, max 100)" },
        { name: "type", type: "enum | enum[]", required: false, description: "Only these event types", enumValues: ["access.invited", "access.invite_revoked", "access.accepted", "access.role_changed", "access.removed", "access.left", "access.org_opened", "access.export", "access.partner_attributed"] },
      ],
      output: {
        description: "A page of events and the cursor for the next page (null on the last page). actor and subject are null when the user no longer exists. metadata holds only role, from, to, email and procedure.",
        example: {
          items: [
            {
              id: "event-uuid",
              type: "access.export",
              label: "Accountant downloaded a report or export",
              createdAt: "2026-10-01T10:00:00.000Z",
              actor: { id: "user-uuid", name: "Anita Shah", email: "anita@cafirm.in" },
              subject: { id: "user-uuid", name: "Anita Shah", email: "anita@cafirm.in" },
              metadata: { procedure: "gst.gstr1Json", role: "ca_filing" },
            },
          ],
          nextCursor: null,
        },
      },
      codeExamples: {
        curl: `curl -G "${API_BASE_URL}/api/trpc/tenant.accessLog" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  --data-urlencode 'input={"json":{"limit":25,"type":["access.export"]}}'`,
        javascript: `const { items, nextCursor } = await trpc.tenant.accessLog.query({ limit: 25 });
for (const e of items) console.log(e.createdAt, e.label, e.actor?.name);`,
        python: `import httpx, json

resp = httpx.get(
    "${API_BASE_URL}/api/trpc/tenant.accessLog",
    params={"input": json.dumps({"json": {"limit": 25}})},
    headers={"Authorization": f"Bearer {session_token}"},
)
page = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "Uses `tenantProcedure`, and an inline gate: FORBIDDEN unless the caller is owner, superadmin or admin.",
        "Event types: invited, invite_revoked, accepted, role_changed, removed, org_opened (CA roles only, at most once an hour per person and organization), export (CA roles only: GSTR-1/9/4 JSON, GSTR-1 CSV, party ledger CSV, Tally CSV/XML, TDS certificate).",
        "Reads are not logged. Downloads by non-CA roles are not logged.",
        "`tenant.members` also returns `lastOpenedAt` per CA member (owners and admins only; null otherwise).",
      ],
      relatedEndpoints: ["tenant-members", "tenant-invite-member", "tenant-remove-member", "business-audit-trail"],
    },
    {
      id: "tenant-revoke-invitation",
      method: "mutation",
      path: "tenant.revokeInvitation",
      title: "Revoke Invitation",
      description: "Revoke (delete) a pending invitation. The invitation link will no longer work. Only owners and admins can revoke invitations. Only unaccepted invitations belonging to the current organization can be revoked.",
      auth: "protected",
      input: [
        { name: "invitationId", type: "string (UUID)", required: true, description: "The invitation ID to revoke" },
      ],
      output: {
        description: "Success confirmation.",
        example: { success: true },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/tenant.revokeInvitation \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -d '{"json":{"invitationId":"invite-uuid-1"}}'`,
        javascript: `await trpc.tenant.revokeInvitation.mutate({
  invitationId: "invite-uuid-1",
});`,
        python: `import httpx

httpx.post(
    "${API_BASE_URL}/api/trpc/tenant.revokeInvitation",
    headers={"Authorization": f"Bearer {session_token}"},
    json={"json": {"invitationId": "invite-uuid-1"}},
)`,
      },
      gotchas: [
        "Only owners, superadmins, and admins can revoke invitations. Returns FORBIDDEN otherwise.",
        "Silently succeeds if the invitation was already accepted or doesn't exist — it only deletes unaccepted invitations.",
      ],
      relatedEndpoints: ["tenant-pending-invitations", "tenant-invite-member"],
    },
    {
      id: "tenant-remove-member",
      method: "mutation",
      path: "tenant.removeMember",
      title: "Remove Member",
      description: "Remove a member from the current organization, in one flow: deletes their membership, all their business access in this organization, their API keys for this organization and any invitation rows for their email (accepted ones deleted, pending ones expired, so an old invite link cannot re-add them), clears the organization from their sessions, records an access.removed security event and emails them a notice. Cannot remove yourself or a superadmin/owner.",
      auth: "protected",
      input: [
        { name: "userId", type: "string (UUID)", required: true, description: "The user ID of the member to remove" },
      ],
      output: {
        description: "Success confirmation.",
        example: { success: true },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/tenant.removeMember \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -d '{"json":{"userId":"user-uuid-2"}}'`,
        javascript: `await trpc.tenant.removeMember.mutate({
  userId: "user-uuid-2",
});
// The removed user's sessions for this org are immediately invalidated`,
        python: `import httpx

httpx.post(
    "${API_BASE_URL}/api/trpc/tenant.removeMember",
    headers={"Authorization": f"Bearer {session_token}"},
    json={"json": {"userId": "user-uuid-2"}},
)`,
      },
      gotchas: [
        "Only owners, superadmins, and admins can remove members. Returns FORBIDDEN otherwise.",
        "Returns BAD_REQUEST if you try to remove yourself — use a different admin to remove your account.",
        "Returns FORBIDDEN if you try to remove an owner or superadmin.",
        "The removed user's sessions for this organization are immediately cleared (tenantId set to null) and the session cache is invalidated.",
        "Every tenant-scoped request re-checks that the caller is still a member (a positive answer is cached for 15 seconds per server process). A removed user's API key or stale session gets FORBIDDEN \"You no longer have access to this organisation\"; across several server instances this can take up to 15 seconds.",
        "Only this organization is affected: the user's account, other organizations and their API keys for them are untouched.",
        "Removing someone who is not a member succeeds and does nothing visible (no event, no email); leftover keys and grants for this organization are still swept, so a retry is always safe.",
        "To let them back in, send a new invitation. An old accepted invite link is refused (NOT_FOUND).",
        "The notice email is best effort and never fails the removal.",
      ],
      relatedEndpoints: ["tenant-members", "tenant-update-member-role"],
    },
    {
      id: "tenant-update-member-role",
      method: "mutation",
      path: "tenant.updateMemberRole",
      title: "Update Member Role",
      description: "Change a member's role within the current organization. Only owners and admins can change roles. Cannot change the role of an owner or superadmin.",
      auth: "protected",
      input: [
        { name: "userId", type: "string (UUID)", required: true, description: "The user ID whose role to change" },
        { name: "role", type: "enum", required: true, description: "The new role to assign", enumValues: ["admin", "seller_manager", "seller", "accountant", "auditor", "ca_filing"] },
      ],
      output: {
        description: "Success confirmation.",
        example: { success: true },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/tenant.updateMemberRole \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -d '{"json":{"userId":"user-uuid-2","role":"admin"}}'`,
        javascript: `await trpc.tenant.updateMemberRole.mutate({
  userId: "user-uuid-2",
  role: "admin",
});`,
        python: `import httpx

httpx.post(
    "${API_BASE_URL}/api/trpc/tenant.updateMemberRole",
    headers={"Authorization": f"Bearer {session_token}"},
    json={"json": {"userId": "user-uuid-2", "role": "admin"}},
)`,
      },
      gotchas: [
        "Only owners, superadmins, and admins can change roles. Returns FORBIDDEN otherwise.",
        "Cannot change the role of an owner or superadmin — these are immutable.",
        "Moving a member to or from an accountant (CA) role (`auditor`, `ca_filing`) is owner-only (admins get FORBIDDEN), and a new CA is refused with CONFLICT when the organization already has 3 CAs including pending invitations.",
        "Available roles: `admin` (full access), `seller_manager` (manage sellers), `seller` (create invoices), `accountant` (bookkeeping: payments, expenses, bank), `auditor` (read-only access to every book and report), `ca_filing` (read-only plus preparing and filing GST returns).",
      ],
      relatedEndpoints: ["tenant-members", "tenant-remove-member"],
    },
    {
      id: "tenant-update-plan",
      method: "mutation",
      path: "tenant.updatePlan",
      title: "Change Organization Plan",
      description: "Switch an organization to a self-serve plan. Only the free plans (`forever_free`, `free`) can be chosen this way; paid plans (`pro`, `business`, `enterprise`) are arranged with the Fintranzact team and applied by a platform admin. Targets the organization selected in the session; if none is selected it falls back to an organization the caller owns (useful during onboarding, before `tenant.select`).",
      auth: "protected",
      input: [
        { name: "plan", type: "enum", required: true, description: "Target plan. Paid plans are only accepted if they equal the organization's current plan (a no-op).", enumValues: ["forever_free", "free", "pro", "business", "enterprise"] },
      ],
      output: {
        description: "The plan that was saved.",
        example: { plan: "free" },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/tenant.updatePlan \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -d '{"json":{"plan":"free"}}'`,
        javascript: `const { plan } = await trpc.tenant.updatePlan.mutate({ plan: "free" });
console.log("Organization is now on", plan);`,
        python: `import httpx

resp = httpx.post(
    "${API_BASE_URL}/api/trpc/tenant.updatePlan",
    headers={"Authorization": f"Bearer {session_token}"},
    json={"json": {"plan": "free"}},
)`,
      },
      gotchas: [
        "Returns FORBIDDEN \"Paid plans are set up by the Fintranzact team. Contact us to upgrade.\" for `pro`, `business` or `enterprise` unless the organization is already on that plan.",
        "Returns NOT_FOUND \"No organization selected to update.\" when the session has no selected organization and the caller owns none.",
        "No organization role is checked when an organization is selected in the session: any member (seller, accountant, …) can switch it to a free plan — including downgrading a paid organization to `free`.",
        "Not audit-logged. Plan limits (businesses, members, exports) change immediately on the next request.",
      ],
      relatedEndpoints: ["tenant-current", "tenant-list"],
    },
  ],
};
