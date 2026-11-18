// `atlas version [--json]`: the release identity built into this binary.
import { embeddedReleaseIdentity, loadReleaseIdentity } from "../release.ts";
import { defaultReleaseRoot } from "../runtime.ts";

export const run = async (args: string[]) => {
  const json = args.includes("--json");
  if (args.some((argument) => argument !== "--json")) {
    process.stderr.write("usage: atlas version [--json]\n");
    return 2;
  }
  // From source there is nothing embedded; report what `atlas serve` would use.
  const identity = embeddedReleaseIdentity() ?? loadReleaseIdentity(defaultReleaseRoot());
  if (json) process.stdout.write(`${JSON.stringify(identity)}\n`);
  else process.stdout.write(identity.published ? `atlas ${identity.tag} (${identity.gitSha})\n` : "atlas development build (unpublished)\n");
  return 0;
};
