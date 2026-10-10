/**
 * client-ip.ts — the visitor's IP address from the request headers, for rate limits,
 * the audit trail and the access log. One implementation for every route.
 *
 * X-Forwarded-For is a list: the client may put anything at the front, and each proxy
 * the request passes through appends the address it received the request from. So only
 * entries at the END, added by proxies we run or trust, can be believed. The visitor is
 * the first entry from the right that is not one of those proxies.
 *
 * Settings (all optional; the defaults behave exactly as this code always has):
 *   TRUSTED_PROXY_CIDRS      comma-separated networks (IPv4 or IPv6, "1.2.3.0/24" or a bare
 *                            address) of proxies whose entries are skipped. On AWS these are
 *                            the CloudFront origin-facing ranges (the Terraform sets them),
 *                            so the visitor is found whether the request came through
 *                            CloudFront or straight to the load balancer.
 *   TRUSTED_PROXY_HOPS       how many entries from the right to skip unconditionally (0-10),
 *                            for proxies whose addresses are not known in advance. Default 0.
 *   TRUST_CF_CONNECTING_IP   "false" or "0" ignores the cf-connecting-ip header. It is only
 *                            trustworthy behind Cloudflare, which overwrites it; anywhere
 *                            else a client can send any value and dodge every per-IP limit.
 *                            Default: trusted (unchanged).
 */

import { BlockList, isIP } from "node:net";

const MAX_HOPS = 10;

interface Config {
  trustCfConnectingIp: boolean;
  hops: number;
  proxies: BlockList | null;
}

let cached: { key: string; config: Config } | null = null;

function parseHops(raw: string | undefined): number {
  if (!raw || !/^\d+$/.test(raw.trim())) return 0;
  return Math.min(Number(raw.trim()), MAX_HOPS);
}

function parseProxies(raw: string | undefined): BlockList | null {
  if (!raw) return null;
  const list = new BlockList();
  let added = 0;
  for (const part of raw.split(",")) {
    const entry = part.trim();
    if (!entry) continue;
    const [addr, bits] = entry.split("/");
    const family = isIP(addr!);
    if (!family) continue; // a malformed entry is ignored, never a reason to trust more
    const type = family === 4 ? "ipv4" : "ipv6";
    try {
      if (bits === undefined) list.addAddress(addr!, type);
      else if (/^\d+$/.test(bits) && Number(bits) <= (family === 4 ? 32 : 128)) list.addSubnet(addr!, Number(bits), type);
      else continue;
      added++;
    } catch {
      // ignore
    }
  }
  return added > 0 ? list : null;
}

function readConfig(env: NodeJS.ProcessEnv): Config {
  const key = `${env.TRUSTED_PROXY_CIDRS ?? ""}|${env.TRUSTED_PROXY_HOPS ?? ""}|${env.TRUST_CF_CONNECTING_IP ?? ""}`;
  if (cached?.key === key) return cached.config;
  const flag = (env.TRUST_CF_CONNECTING_IP ?? "").trim().toLowerCase();
  const config: Config = {
    trustCfConnectingIp: !(flag === "false" || flag === "0"),
    hops: parseHops(env.TRUSTED_PROXY_HOPS),
    proxies: parseProxies(env.TRUSTED_PROXY_CIDRS),
  };
  cached = { key, config };
  return config;
}

function isTrustedProxy(list: BlockList, entry: string): boolean {
  const family = isIP(entry);
  if (!family) return false; // not an address: never skip it
  try {
    return list.check(entry, family === 4 ? "ipv4" : "ipv6");
  } catch {
    return false;
  }
}

/**
 * The visitor's address, or null when the headers carry none. `get` reads a header by
 * (lower-case) name, so it works for a Fetch Request and for a Hono context.
 */
export function clientIpFromHeaders(
  get: (name: string) => string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const config = readConfig(env);

  if (config.trustCfConnectingIp) {
    const cfIp = get("cf-connecting-ip")?.trim();
    if (cfIp) return cfIp;
  }

  const xff = get("x-forwarded-for");
  if (!xff) return null;
  const entries = xff.split(",").map((s) => s.trim()).filter(Boolean);

  // Drop what our own proxies appended, from the right; what is left at the end is the visitor.
  let end = Math.max(entries.length - config.hops, 0);
  if (config.proxies) {
    while (end > 0 && isTrustedProxy(config.proxies, entries[end - 1]!)) end--;
  }
  return end > 0 ? entries[end - 1]! : null;
}
