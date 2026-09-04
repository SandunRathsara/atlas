# PROTOTYPE: issue #19 OpenCode end-to-end POC

This is throwaway code for issue #19, not Atlas production code. It answers one
question:

> Can the pinned `@opencode-ai/client` connect to the already-running,
> matching `opencode2` server, send an initial prompt to an isolated Git
> repository, observe completion, collect the result, and leave the session
> available for inspection without human interaction?

## Run it

The local OpenCode service must already be running and must match the exact
client version pinned in `package.json`.

Prepare `poc/persistence/issue-19-opencode-e2e/` yourself before running the
POC. It must already be a standalone Git repository. The POC does not create,
initialize, seed, reset, test, or delete anything in that target directory.

```sh
npm install
npm run poc "<initial prompt>"
```

The script:

1. discovers the configured local service and uses its Basic Auth password
   without printing it;
2. checks health/version and the `build` agent;
3. always selects `opencode/muse-spark-1.3-contributor-free` and uses the
   existing absolute Git repository at
   `poc/persistence/issue-19-opencode-e2e/`;
4. creates a session, submits the supplied initial prompt, subscribes to live
   events, waits with `session.wait`, and retrieves the final assistant message;
5. records the target repository's Git state and diff before and after the
   session without assuming any project files, commands, or expected changes;
6. exercises a deterministic missing-session failure probe and attempts a
   controlled interrupt probe; and
7. stops its event stream while preserving the sessions and repository for
   inspection in the OpenCode TUI.

The run directory is printed immediately when the run starts. In another
terminal, open that directory with the matching TUI while the POC is running:

```sh
opencode2 /absolute/path/printed/by/the/poc
```

All runs use `poc/persistence/issue-19-opencode-e2e/`, so their OpenCode
sessions are easy to find together in the TUI. The directory and sessions are
intentionally not deleted or reset; manage the directory manually.

The JSON report is written to `artifacts/` (ignored by Git) and also printed as
the final output. It contains event summaries, command output, the diff,
durations, cleanup status, and failure details. No API password or prompt is
written to the report.

Useful overrides:

```sh
OPENCODE_AGENT_ID=build npm run poc "<initial prompt>"
OPENCODE_SERVICE_FILE="$HOME/.local/state/opencode/service.json" npm run poc "<initial prompt>"
```

The model is intentionally fixed to `opencode/muse-spark-1.3-contributor-free`
(`Muse Spark 1.3` through OpenCode Zen); `OPENCODE_MODEL` is not used.

The service discovery fallback understands the legacy beta registration file
shape (`url`, `version`, `pid`, `password`) as well as the newer wrapped shape.
The POC refuses a server version different from the exact client dependency.
