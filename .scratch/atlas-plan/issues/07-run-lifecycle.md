# 07 - Run lifecycle: states, completion rule, queueing, concurrency caps
Type: grilling
Status: open
Blocked by: 01, 02

## Question

Define the run state machine and its rules:

- States and transitions. Starting point: QUEUED, PREPARING (clone), RUNNING, COMPLETED, FAILED, STALLED, CANCELLED. Challenge this.
- The completion rule: session idle plus what? Does the PR need to be open (not draft) for COMPLETED?
- Queueing order and the global cap on concurrent runs. Per-project cap or not.
- What happens to the run directory on each terminal state.
