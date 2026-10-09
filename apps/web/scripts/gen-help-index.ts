/** Regenerates packages/shared/src/help-index.generated.ts (see help-index-lib.ts). Run: pnpm --filter @fintranzact/web gen:help-index */
import { readFileSync, writeFileSync } from "node:fs";
import { HELP_INDEX_OUTPUT, buildHelpIndex, renderHelpIndexModule } from "./help-index-lib";

const next = renderHelpIndexModule(buildHelpIndex());
let current = "";
try {
  current = readFileSync(HELP_INDEX_OUTPUT, "utf-8");
} catch {
  /* first run */
}
if (current !== next) {
  writeFileSync(HELP_INDEX_OUTPUT, next);
  console.log(`Wrote ${HELP_INDEX_OUTPUT}`);
} else {
  console.log("Help index is up to date.");
}
