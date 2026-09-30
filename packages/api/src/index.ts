import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "./router.js";

export { appRouter, type AppRouter } from "./router.js";
export { createContext } from "./context.js";

/** What each procedure returns, for typing data in the apps. */
export type RouterOutputs = inferRouterOutputs<AppRouter>;
