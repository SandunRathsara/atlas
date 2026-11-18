// `import path from "…" with { type: "file" }` yields a file path (see src/assets.ts).
declare module "*.css" {
  const path: string;
  export default path;
}
declare module "*.woff2" {
  const path: string;
  export default path;
}
// `with { type: "text" }` yields the file's text (see src/commands/ops.ts).
declare module "*.sh" {
  const text: string;
  export default text;
}
declare module "*.conf" {
  const text: string;
  export default text;
}
declare module "*.marker" {
  const text: string;
  export default text;
}
declare module "htmx.org/dist/htmx.min.js" {
  const path: string;
  export default path;
}
// Not in the package's `exports`; Bun still resolves it and inlines it at build time (src/opencode.ts).
declare module "@opencode/client/package.json" {
  const manifest: { name?: unknown; version?: unknown };
  export default manifest;
}
