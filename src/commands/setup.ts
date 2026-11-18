// `atlas setup`: host setup wizard. Not implemented yet; replace this file's
// `run` to implement it (src/cli.ts already registers the subcommand).
export const run = async (_args: string[]) => {
  process.stderr.write("atlas setup is not implemented yet.\n");
  return 1;
};
