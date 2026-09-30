#!/usr/bin/env node
/**
 * Fintranzact MCP Server
 *
 * Exposes Fintranzact invoicing data and operations as MCP tools and resources.
 * Designed for use with Claude Desktop, OpenClaw, and any MCP-compatible host.
 *
 * Required environment variables:
 *   FINTRANZACT_API_URL     — Base URL of the Fintranzact API (default: http://localhost:3000)
 *   FINTRANZACT_API_KEY       — Session ID obtained from `fintranzact login` (Bearer token)
 *   FINTRANZACT_TENANT_ID   — Tenant (organization) UUID
 *   FINTRANZACT_BUSINESS_ID — Active business UUID
 *
 * Usage in Claude Desktop claude_desktop_config.json:
 *   {
 *     "mcpServers": {
 *       "fintranzact": {
 *         "command": "npx",
 *         "args": ["@fintranzact/mcp"],
 *         "env": {
 *           "FINTRANZACT_API_URL": "http://localhost:3000",
 *           "FINTRANZACT_API_KEY": "<session-id-from-fintranzact-login>",
 *           "FINTRANZACT_TENANT_ID": "<tenant-uuid>",
 *           "FINTRANZACT_BUSINESS_ID": "<business-uuid>"
 *         }
 *       }
 *     }
 *   }
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { FintranzactClient } from "./client.js";
import { registerTools } from "./server.js";

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    process.stderr.write(
      `[fintranzact-mcp] Error: Required environment variable "${name}" is not set.\n` +
      `[fintranzact-mcp] Run "fintranzact whoami --json" to get all required values.\n`
    );
    process.exit(1);
  }
  return val;
}

function validateApiUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    process.stderr.write(`[fintranzact-mcp] Error: FINTRANZACT_API_URL is not a valid URL: "${raw}"\n`);
    process.exit(1);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    process.stderr.write(`[fintranzact-mcp] Error: FINTRANZACT_API_URL must use http: or https: protocol.\n`);
    process.exit(1);
  }
  return url.origin;
}

const config = {
  apiUrl: validateApiUrl(process.env.FINTRANZACT_API_URL ?? "http://localhost:3000"),
  token: requireEnv("FINTRANZACT_API_KEY"),
  tenantId: requireEnv("FINTRANZACT_TENANT_ID"),
  businessId: requireEnv("FINTRANZACT_BUSINESS_ID"),
};

declare const __MCP_VERSION__: string | undefined;
const mcpVersion = typeof __MCP_VERSION__ !== "undefined" ? __MCP_VERSION__ : "dev";

const client = new FintranzactClient(config);
const server = new McpServer({
  name: "fintranzact",
  version: mcpVersion,
});

registerTools(server, client);

const transport = new StdioServerTransport();
await server.connect(transport);

// Graceful shutdown — close MCP connection before exiting
const shutdown = async () => {
  await server.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
