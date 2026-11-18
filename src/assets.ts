// Static UI assets. `with { type: "file" }` resolves to a real path from
// source and to an embedded `/$bunfs/` file inside the compiled binary, so
// `Bun.file(path)` serves both. `public/app.css` is the `build:css` output and
// must exist before this module loads.
import appCss from "../public/app.css" with { type: "file" };
// @ts-expect-error TypeScript types a relative .js import as the module, not the file path Bun returns.
import appJs from "../public/app.js" with { type: "file" };
// @ts-expect-error Same as above.
import themeJs from "../public/theme.js" with { type: "file" };
import interFont from "../public/fonts/inter.woff2" with { type: "file" };
import geistMonoFont from "../public/fonts/geist-mono.woff2" with { type: "file" };
import htmxJs from "htmx.org/dist/htmx.min.js" with { type: "file" };

const hour = "public, max-age=3600";
const week = "public, max-age=604800";
const javascript = "text/javascript; charset=UTF-8";

export const staticAssets: readonly { route: string; path: string; contentType: string; cacheControl: string }[] = [
  { route: "/assets/app.css", path: appCss, contentType: "text/css; charset=UTF-8", cacheControl: hour },
  { route: "/assets/app.js", path: appJs, contentType: javascript, cacheControl: hour },
  { route: "/assets/theme.js", path: themeJs, contentType: javascript, cacheControl: hour },
  { route: "/assets/fonts/inter.woff2", path: interFont, contentType: "font/woff2", cacheControl: week },
  { route: "/assets/fonts/geist-mono.woff2", path: geistMonoFont, contentType: "font/woff2", cacheControl: week },
  { route: "/assets/htmx.min.js", path: htmxJs, contentType: javascript, cacheControl: "public, max-age=31536000, immutable" },
];
