# 09 - Stall detection: activity definition, threshold, cancel mechanics, what the UI shows
Type: grilling
Status: open
Blocked by: 02, 07

## Question

- Which events count as activity, and which do not (e.g. a long-running test command with no output).
- What Atlas does when the session emits `permission.asked` (waiting on a human, not a stall per issues/02): auto-reply, fail the run, or surface in the UI. Unattended runs must not block forever.
- Default threshold and where it is configured.
- Cancel mechanics on stall: abort the session, then what.
- What the UI shows for a stalled run and whether it can be retried.
