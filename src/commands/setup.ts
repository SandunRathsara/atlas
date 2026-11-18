// `atlas setup`: install, re-run, or adopt Atlas on this host. See src/setup/run.ts and docs/INSTALL.md.
import { runSetup } from "../setup/run.ts";

export const run = (args: string[]) => runSetup(args);
