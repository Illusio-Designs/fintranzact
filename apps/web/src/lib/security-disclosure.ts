/**
 * The responsible-disclosure policy, shared by /security (the summary) and
 * /security/report (the full page) so both always state the same promises.
 * public/.well-known/security.txt points at /security/report.
 */

/** How quickly we acknowledge a report. */
export const ACKNOWLEDGE_WITHIN = "48 hours";
/** How quickly a critical issue gets a fix or a mitigation plan. */
export const CRITICAL_FIX_WITHIN = "7 days";

/** What happens after someone reports an issue to the given security address. */
export function reportSteps(email: string): Array<[string, string]> {
  return [
    ["Email us", `Write to ${email} with what you found, the steps to reproduce it and the impact you expect.`],
    ["We confirm", `We acknowledge every report within ${ACKNOWLEDGE_WITHIN} and keep you updated while we investigate.`],
    ["We fix it", `Critical issues get a fix or a mitigation plan within ${CRITICAL_FIX_WITHIN}. We will tell you when it is resolved.`],
  ];
}

/** The parts of Fintranzact a report may cover. */
export const COVERED_SERVICES = [
  "The Fintranzact web app and this website",
  "The desktop app and the mobile app",
  "The public API, the command-line tool and the MCP server",
  "Invoice share links and online store pages",
];

export const IN_SCOPE = [
  "Signing in as someone else, or bypassing a role's permissions",
  "Seeing or changing another business's data",
  "SQL injection, cross-site scripting (XSS) and CSRF",
  "Session hijacking or fixation",
  "Bypassing rate limits or bot protection",
  "Sensitive data in logs, error messages or share links",
];

export const OUT_OF_SCOPE = [
  "Volumetric denial of service",
  "Social engineering of our team or customers",
  "Issues in third-party dependencies (please report them upstream)",
  "Attacks that need physical access to a device or server",
];
