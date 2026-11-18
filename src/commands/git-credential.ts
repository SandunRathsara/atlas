// `atlas git-credential <operation>`: Git credential helper used by
// preparation and the Release `bin/git-credential-atlas` shim.
import { requestCredential, CredentialError } from "../credentials.ts";

export const run = async (args: string[]) => {
  const operation = args[0] ?? "get";
  const input = await new Response(Bun.stdin).text();
  const values = new Map<string, string>();
  for (const line of input.split(/\r?\n/u)) {
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    values.set(line.slice(0, separator), line.slice(separator + 1));
  }

  const sessionDirectory = process.env.ATLAS_SESSION_DIRECTORY ?? process.cwd();
  const protocol = values.get("protocol");
  const host = values.get("host");
  const path = values.get("path");

  try {
    if (operation !== "get" || !sessionDirectory || !protocol || !host || !path) throw new CredentialError("Credential operation is not allowed");
    const response = await requestCredential({
      operation: "git",
      sessionDirectory,
      protocol,
      host,
      path,
    });
    process.stdout.write(`username=${response.username}\npassword=${response.password}\n\n`);
    return 0;
  } catch {
    // Git must not fall back to an inherited helper, prompt, SSH key, or human login.
    process.stdout.write("quit=true\n\n");
    return 1;
  }
};
