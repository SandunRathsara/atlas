import { tmpdir } from "node:os";
import { join } from "node:path";

// Verifiers must never discover the operator's live OpenCode through the default
// `$XDG_STATE_HOME/opencode/service.json`; point discovery at a path that cannot exist.
process.env.OPENCODE_SERVICE_FILE = join(tmpdir(), `atlas-verify-no-opencode-${crypto.randomUUID()}`, "service.json");
