/**
 * Sunset alerts: who to tell what, and when (SPEC.md §3, US6). Pure TypeScript with no network,
 * database or browser code, so a future React Native app can reuse it. The server job that runs
 * it every 15 minutes lives in app/_server/alerts.
 */
export * from "./settings";
export * from "./decide";
export * from "./message";
