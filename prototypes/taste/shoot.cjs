// Usage: node shoot.cjs <outDir> <file1.html> [file2.html ...]
const { chromium } = require("/home/omega/.local/share/mise/installs/npm-playwright/latest/node_modules/playwright");
const path = require("node:path");
const [outDir, ...files] = process.argv.slice(2);
(async () => {
  const browser = await chromium.launch({ executablePath: "/usr/bin/chromium" });
  for (const file of files) {
    for (const [w, h, tag] of [[1440, 900, "desktop"], [390, 844, "phone"]]) {
      for (const mode of ["dark", "light"]) {
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: tag === "phone" ? 2 : 1 });
        const p = await ctx.newPage();
        await p.goto(`file://${path.resolve(file)}?mode=${mode}`);
        await p.evaluate(() => document.fonts.ready);
        await p.waitForTimeout(150);
        const name = path.basename(file, ".html");
        await p.screenshot({ path: `${outDir}/${name}-${tag}-${mode}.png`, fullPage: tag === "desktop" });
        await ctx.close();
      }
    }
  }
  await browser.close();
})();
