# 12 - Webhook ingress: how GitHub reaches the server
Type: grilling
Status: open
Blocked by: 03, 05

## Question

- Path for GitHub webhooks to reach Atlas on a private-network server: public reverse proxy with TLS, Cloudflare tunnel, Tailscale funnel, or similar.
- Whether the bearer-token UI and the webhook endpoint share one listener.
- Fallback when webhooks are missed: polling interval and reconciliation.
