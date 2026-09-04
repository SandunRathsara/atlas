# 14 - Persistence model: SQLite schema, GitHub cache vs live reads, webhook dedupe
Type: grilling
Status: open
Blocked by: 07, 13

## Question

- Tables and key fields for projects, runs, run events, and webhook deliveries.
- What GitHub data is cached locally versus fetched live on page load.
- Webhook delivery dedupe and ordering.
- Migration approach and SQLite access library on Bun.
