import { Command } from "commander";

export function registerBillingCommands(program: Command): void {
  const billing = program.command("billing").description("Plan and trial status");

  billing
    .command("status")
    .description("Show the plan state, trial countdown and whether the organisation is read-only (works while read-only)")
    .option("--json", "JSON output")
    .action(async (opts) => {
      const { billingStatusCommand } = await import("../../commands/billing/status.js");
      await billingStatusCommand(opts);
    });
}
