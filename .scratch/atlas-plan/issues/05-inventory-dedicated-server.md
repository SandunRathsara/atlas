# 05 - Inventory the dedicated server
Type: task
Status: open
Blocked by:

## Question

Atlas will run on an Omarchy server with root access and Docker. The deployment plan needs facts only the server can give. Hand the user a short checklist to run, or run it over SSH if access is available, and record:

- OS and kernel version, CPU and RAM.
- Whether `bun`, `git`, and `gh` are installed and their versions.
- How opencode2 is run there today: binary path, version, how it is started, URL and port it listens on, whether it survives reboots.
- Whether `OPENCODE_SERVER_PASSWORD` is set for that server (Atlas must send HTTP Basic `opencode:<password>`; see issues/01), and whether the binary is build `beta-17823` or newer (the client package must match).
- Public reachability: does the server have a public IP or domain, is anything already terminating TLS (Caddy, nginx, Traefik), is a tunnel in use (Tailscale, Cloudflare)?
- Where data should live on disk (free space per mount).

Resolved when the facts are recorded in the Answer.
