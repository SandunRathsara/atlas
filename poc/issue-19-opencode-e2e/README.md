# PROTOTYPE: issue #19 OpenCode end-to-end POC

This is throwaway code for issue #19, not Atlas production code. It answers one
question:

> Can the pinned `@opencode-ai/client` connect to the already-running,
> matching `opencode2` server, run one real implementation spec in an isolated
> Git repository, observe completion, collect the result, and clean everything
> up without human interaction?

## Run it

The local OpenCode service must already be running and must match the exact
client version pinned in `package.json`.

```sh
npm install
npm run poc
```

The script:

1. discovers the configured local service and uses its Basic Auth password
   without printing it;
2. checks health/version and the `build` agent;
3. creates a temporary absolute Git repository under the OS temp directory;
4. creates a session, submits a bounded implementation spec, subscribes to
   live events, waits with `session.wait`, and retrieves the final assistant
   message;
5. independently runs the target repository's `npm test`, checks the source
   change, and checks that the verifier itself was not changed;
6. exercises a deterministic missing-session failure probe and attempts a
   controlled interrupt probe; and
7. deletes the sessions and temporary repository.

The JSON report is written to `artifacts/` (ignored by Git) and also printed as
the final output. It contains event summaries, command output, the diff,
durations, cleanup status, and failure details. No API password or prompt is
written to the report.

Useful overrides:

```sh
OPENCODE_AGENT_ID=build npm run poc
OPENCODE_SERVICE_FILE="$HOME/.local/state/opencode/service.json" npm run poc
# Optional when the service's configured default model is unavailable:
OPENCODE_MODEL=openrouter/openrouter/free npm run poc
```

The service discovery fallback understands the legacy beta registration file
shape (`url`, `version`, `pid`, `password`) as well as the newer wrapped shape.
The POC refuses a server version different from the exact client dependency.
