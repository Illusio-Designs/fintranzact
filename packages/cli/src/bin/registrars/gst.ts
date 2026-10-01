import { Command } from "commander";
import { gstR1Command, gstR3bCommand, gstR1CsvCommand, gstR9Command, gstCmp08Command, gstHsnSearchCommand, gstHsnCheckCommand, gstr2bUploadsCommand } from "../../commands/gst/index.js";

export function registerGstCommands(program: Command): void {
  // ── gst ───────────────────────────────────────────────────────────────────

  const gst = program.command("gst").description("GST reports");

  gst
    .command("r1")
    .description("GSTR-1 report")
    .option("--json", "JSON output")
    .option("--quarter <q>", "Quarter: Q1, Q2, Q3, Q4")
    .option("--month <n>", "Month number (1-12)", parseInt)
    .option("--year <n>", "Year", parseInt)
    .action(async (opts) => {
      await gstR1Command({ json: opts.json, quarter: opts.quarter, month: opts.month, year: opts.year });
    });

  gst
    .command("r3b")
    .description("GSTR-3B report")
    .option("--json", "JSON output")
    .option("--quarter <q>", "Quarter: Q1, Q2, Q3, Q4")
    .option("--month <n>", "Month number (1-12)", parseInt)
    .option("--year <n>", "Year", parseInt)
    .action(async (opts) => {
      await gstR3bCommand({ json: opts.json, quarter: opts.quarter, month: opts.month, year: opts.year });
    });

  gst
    .command("r1-csv")
    .description("Download GSTR-1 as GSTN-compatible CSV")
    .option("--quarter <q>", "Quarter")
    .option("--month <n>", "Month", parseInt)
    .option("--year <n>", "Year", parseInt)
    .option("--output <path>", "Output file path")
    .action(async (opts) => {
      await gstR1CsvCommand({ quarter: opts.quarter, month: opts.month, year: opts.year, output: opts.output });
    });

  gst
    .command("gstr9 <fy>")
    .description("GSTR-9 annual return (e.g. 2023-24)")
    .option("--json", "JSON output")
    .action(async (fy: string, opts) => {
      await gstR9Command(fy, { json: opts.json });
    });

  gst
    .command("cmp08 <fy> <quarter>")
    .description("CMP-08 quarterly return for composition dealers (e.g. 2025-26 1)")
    .option("--json", "JSON output")
    .action(async (fy: string, quarter: string, opts) => {
      await gstCmp08Command(fy, quarter, { json: opts.json });
    });

  gst
    .command("hsn <query...>")
    .description("Find HSN / SAC codes by code or product words (e.g. 3004, paracetamol)")
    .option("--type <type>", "goods or services")
    .option("--limit <n>", "Results, 1–50 (default 20)")
    .option("--json", "JSON output")
    .action(async (query: string[], opts) => {
      await gstHsnSearchCommand(query.join(" "), { json: opts.json, type: opts.type, limit: opts.limit });
    });

  gst
    .command("hsn-check <code>")
    .description("Check an HSN / SAC code and show what it stands for")
    .option("--json", "JSON output")
    .action(async (code: string, opts) => {
      await gstHsnCheckCommand(code, { json: opts.json });
    });

  gst
    .command("gstr2b-uploads")
    .description("List GSTR-2B uploaded periods")
    .option("--json", "JSON output")
    .action(async (opts) => {
      await gstr2bUploadsCommand({ json: opts.json });
    });
}
