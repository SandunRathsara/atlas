import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createReleaseMetadata, validateReleaseSequence } from "../src/release.ts";

const usage = () => {
  throw new Error("usage: bun scripts/release.ts validate <tag> [published-tag ...] | metadata <tag> <git-sha> <output>");
};

const command = process.argv[2];
if (command === "validate") {
  const tag = process.argv[3] ?? usage();
  const release = validateReleaseSequence(tag, process.argv.slice(4));
  console.log(`release identity validated: ${release.semver} build ${release.build}`);
} else if (command === "metadata") {
  const tag = process.argv[3] ?? usage();
  const gitSha = process.argv[4] ?? usage();
  const output = process.argv[5] ?? usage();
  const root = join(import.meta.dir, "..");
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
    engines?: { bun?: string };
    dependencies?: { "@opencode/client"?: string };
  };
  const pins = Object.fromEntries(
    (await readFile(join(root, "deploy/pins.env"), "utf8"))
      .split(/\r?\n/)
      .map((line) => /^([A-Z][A-Z0-9_]*)=(.+)$/.exec(line))
      .filter((match): match is RegExpExecArray => Boolean(match))
      .map((match) => [match[1]!, match[2]!]),
  );
  if (!packageJson.engines?.bun || packageJson.engines.bun !== pins.ATLAS_BUN_VERSION) {
    throw new Error("package.json and deploy/pins.env must agree on the Bun runtime");
  }
  if (!packageJson.dependencies?.["@opencode/client"] ||
      packageJson.dependencies["@opencode/client"] !== pins.ATLAS_OPENCODE_CLIENT_VERSION) {
    throw new Error("package.json and deploy/pins.env must agree on the packaged OpenCode client");
  }
  // Atlas reports the installed client version on /health, so the frozen lockfile must resolve exactly the pin.
  const lock = await readFile(join(root, "bun.lock"), "utf8");
  const resolved = /"@opencode\/client": \["@opencode\/client@([^"]+)"/u.exec(lock)?.[1];
  if (resolved !== pins.ATLAS_OPENCODE_CLIENT_VERSION) {
    throw new Error("bun.lock and deploy/pins.env must agree on the packaged OpenCode client");
  }
  if (lock.includes("@opencode-ai/")) {
    throw new Error("bun.lock must not contain the retired @opencode-ai packages");
  }
  const metadata = createReleaseMetadata(tag, gitSha, {
    bun: packageJson.engines.bun,
    git: pins.ATLAS_GIT_VERSION ?? "",
    gh: pins.ATLAS_GH_VERSION ?? "",
  });
  await writeFile(output, `${JSON.stringify(metadata, null, 2)}\n`);
  console.log(`release metadata written to ${output}`);
} else {
  usage();
}
