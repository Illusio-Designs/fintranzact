/**
 * MCP tool error normalization.
 *
 * All tool handlers are wrapped with wrapTool() to ensure errors are returned
 * as structured MCP content rather than thrown exceptions. The MCP SDK itself
 * handles uncaught exceptions, but we want to give the AI agent a useful, plain
 * English message rather than a raw JSON error envelope.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { FintranzactApiError, formatFintranzactError, type FintranzactError } from "../client.js";

type ToolHandler<T> = (input: T) => Promise<CallToolResult>;

/**
 * Wrap a tool handler in error normalization.
 *
 * - Successful calls pass through unchanged.
 * - FintranzactApiError is translated to a structured, agent-readable error message.
 * - Any other thrown error is collapsed to a safe api_error (no stack traces exposed).
 */
export function wrapTool<T>(handler: ToolHandler<T>): ToolHandler<T> {
  return async (input: T): Promise<CallToolResult> => {
    try {
      return await handler(input);
    } catch (err) {
      const fintranzactErr = toFintranzactError(err);
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: formatFintranzactError(fintranzactErr),
          },
        ],
      };
    }
  };
}

function toFintranzactError(err: unknown): FintranzactError {
  if (err instanceof FintranzactApiError) {
    return err.fintranzactError;
  }
  // Sanitize network errors — don't leak hostnames, IPs, or ports to the AI agent
  if (err instanceof Error) {
    if (err.message.includes("ECONNREFUSED") || err.message.includes("ETIMEDOUT")) {
      return { code: "api_error", message: "Unable to connect to the Fintranzact API. Check that the server is running and FINTRANZACT_API_URL is correct." };
    }
    if (err.message.includes("ENOTFOUND")) {
      return { code: "api_error", message: "Cannot resolve the Fintranzact API hostname. Check FINTRANZACT_API_URL." };
    }
    if (err.name === "AbortError" || err.message.includes("timeout")) {
      return { code: "api_error", message: "Request to the Fintranzact API timed out (30s). The server may be overloaded." };
    }
    return { code: "api_error", message: err.message };
  }
  return { code: "api_error", message: "An unexpected error occurred. Check server logs." };
}
