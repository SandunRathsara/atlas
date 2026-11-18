// Release identity checks for the publishing workflow.
//
// Usage: bun scripts/release.ts validate <tag> [published-tag ...]
//   Exits non-zero unless <tag> is a valid next Release after the published tags.
// Release files are built by scripts/build-release.ts.
import { validateReleaseSequence } from "../src/release.ts";

const [command, tag, ...published] = process.argv.slice(2);
if (command !== "validate" || !tag) {
  console.error("usage: bun scripts/release.ts validate <tag> [published-tag ...]");
  process.exit(2);
}
const release = validateReleaseSequence(tag, published);
console.log(`release identity validated: ${release.semver} build ${release.build}`);
