import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inlineScriptHashes } from "@/lib/csp-hash";

const sha = (s: string) => `sha256-${createHash("sha256").update(s).digest("base64")}`;

describe("inlineScriptHashes", () => {
  it("hashes the exact body of inline scripts and skips external ones", () => {
    const html = `<head><script src="https://x.test/a.js" async></script><script>
  var a = 1;
</script><script type="module">b()</script></head>`;
    expect(inlineScriptHashes(html)).toEqual([sha("\n  var a = 1;\n"), sha("b()")]);
  });

  // Regression: the CSP hash was hard-coded in vite.config.ts and went stale,
  // so browsers blocked the theme script on every page.
  it("covers the theme script in index.html", () => {
    const html = readFileSync(path.resolve(__dirname, "../../index.html"), "utf-8");
    const start = html.indexOf("<script>", html.indexOf("turnstile")) + "<script>".length;
    const body = html.slice(start, html.indexOf("</script>", start));
    expect(body).toContain("fintranzact-theme");
    expect(inlineScriptHashes(html)).toContain(sha(body));
  });
});
