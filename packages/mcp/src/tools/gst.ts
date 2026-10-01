/**
 * GST reporting tools.
 *
 * Tools registered:
 *   gst_report     — generate GSTR1 or GSTR3B summary data for a given month/year
 *   gst_report_csv — get GSTR-1 data in CSV format ready for portal upload
 *   gst_gstr9      — GSTR-9 annual return summary
 *   gst_cmp08      — CMP-08 quarterly return for composition dealers
 *   gst_hsn_search — find HSN / SAC codes by code prefix or description words
 *   gst_hsn_check  — check an HSN / SAC code and get what it stands for
 *
 * Note: PDF generation is intentionally excluded. AI agents cannot consume
 * binary content in tool responses. The JSON report is designed to let agents
 * summarize GST liability, answer questions, and guide filing.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FintranzactClient } from "../client.js";
import { wrapTool } from "../lib/errors.js";

const CURRENT_YEAR = new Date().getFullYear();

export function registerGstTools(server: McpServer, client: FintranzactClient) {

  server.tool(
    "gst_report_csv",
    [
      "Get GSTR-1 data as a CSV string ready for upload to the GST portal.",
      "Returns the CSV content and a suggested filename (e.g. 'GSTR1_March_2024.csv').",
      "Save the CSV content to a file and upload it at https://www.gst.gov.in/.",
      "Month is 1–12 (1 = January, 3 = March, etc.).",
    ].join(" "),
    {
      month: z.number().int().min(1).max(12)
        .describe("Month number (1 = January, 12 = December)."),
      year: z.number().int().min(2020).max(CURRENT_YEAR + 1)
        .describe(`Year, e.g. ${CURRENT_YEAR}.`),
    },
    wrapTool(async (input) => {
      const result = await client.gst.gstr1CSV({ month: input.month, year: input.year });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    })
  );

  server.tool(
    "gst_report",
    [
      "Generate a GST report (GSTR1 or GSTR3B) for a specific month and year.",
      "GSTR1 = outward supplies summary (sales). GSTR3B = monthly return summary (sales + purchases + ITC).",
      "Returns JSON data — use this to answer 'What is our GST liability for March 2024?' or 'How much ITC can we claim this month?'",
      "Month is 1–12 (1 = January, 3 = March, etc.).",
      "Example: { report_type: 'gstr3b', month: 3, year: 2024 } for March 2024 GSTR3B.",
    ].join(" "),
    {
      report_type: z.enum(["gstr1", "gstr3b"])
        .describe("'gstr1' for outward supplies (sales) report. 'gstr3b' for monthly summary return."),
      month: z.number().int().min(1).max(12)
        .describe("Month number (1 = January, 12 = December)."),
      year: z.number().int().min(2020).max(CURRENT_YEAR + 1)
        .describe(`Year, e.g. ${CURRENT_YEAR}.`),
    },
    wrapTool(async (input) => {
      const report = input.report_type === "gstr1"
        ? await client.gst.gstr1({ month: input.month, year: input.year })
        : await client.gst.gstr3b({ month: input.month, year: input.year });

      const monthName = new Date(input.year, input.month - 1, 1)
        .toLocaleString("en-IN", { month: "long" });

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(
            {
              ...report,
              _meta: {
                reportType: input.report_type.toUpperCase(),
                period: `${monthName} ${input.year}`,
              },
            },
            null,
            2
          ),
        }],
      };
    })
  );

  server.tool(
    "gst_gstr9",
    [
      "Get GSTR-9 annual return summary for a financial year.",
      "GSTR-9 is the annual GST return consolidating all monthly/quarterly filings.",
      "Returns total turnover, tax paid, ITC claimed, and other annual summary data.",
      "Financial year format: 'YYYY-YY' e.g. '2023-24' for FY 2023-2024 (April 2023 to March 2024).",
    ].join(" "),
    {
      financial_year: z.string().regex(/^\d{4}-\d{2}$/)
        .describe("Financial year in YYYY-YY format, e.g. '2023-24'."),
    },
    wrapTool(async (input) => {
      const result = await client.gst.gstr9({ financialYear: input.financial_year });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    })
  );

  server.tool(
    "gst_cmp08",
    [
      "Get the CMP-08 quarterly statement for a composition-scheme business:",
      "outward supplies (sales net of credit notes and returns) and the tax payable for the quarter.",
      "Quarters follow the financial year: Q1 = Apr–Jun, Q2 = Jul–Sep, Q3 = Oct–Dec, Q4 = Jan–Mar.",
    ].join(" "),
    {
      financial_year: z.string().regex(/^\d{4}-\d{2}$/)
        .describe("Financial year in YYYY-YY format, e.g. '2025-26'."),
      quarter: z.number().int().min(1).max(4).describe("Financial-year quarter, 1–4."),
    },
    wrapTool(async (input) => {
      const result = await client.gst.cmp08({ year: Number(input.financial_year.slice(0, 4)), quarter: input.quarter });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    })
  );

  server.tool(
    "gst_hsn_search",
    [
      "Find HSN (goods) and SAC (services) codes in the CBIC HSN / SAC list.",
      "Pass digits to match codes starting with them (e.g. '3004'), or words that must all appear in the description (e.g. 'paracetamol tablets').",
      "Use it to pick the right code for an item before creating or updating it.",
    ].join(" "),
    {
      query: z.string().min(1).max(50).describe("Code prefix or description words."),
      type: z.enum(["goods", "services"]).optional().describe("Only HSN goods codes or only SAC service codes."),
      limit: z.number().int().min(1).max(50).optional().describe("How many results (default 20)."),
    },
    wrapTool(async (input) => {
      const result = await client.gst.hsnSearch(input);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    })
  );

  server.tool(
    "gst_hsn_check",
    [
      "Check whether an HSN / SAC code is a real GST code (4–8 digits: a listed code or the heading of listed codes)",
      "and return what it stands for: goods or services, and its description.",
      "Item create and update refuse codes that fail this check.",
    ].join(" "),
    {
      hsn: z.string().min(2).max(8).describe("The HSN or SAC code, e.g. '30041010' or '998713'."),
    },
    wrapTool(async (input) => {
      const result = await client.gst.hsnValidate(input);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    })
  );
}
