# OpenCode Autonomous Spec Runner — Engineering Handoff

## Goal

Build an application using the **OpenCode SDK + OpenCode Server** that can execute software-development specifications autonomously for long periods without human intervention.

Primary priorities, in order:

1. Autonomy
2. Observability
3. Reliability
4. Cost
5. Speed
6. Recoverability

## Workload

Each job represents **one clearly defined/grilled engineering specification**.

Typical specs involve:

- New feature development
- Enhancements
- Refactoring
- Source code generation
- Automated tests
- Documentation
- End-to-end implementation

Debugging and exploratory analysis are secondary use cases.

Each spec operates against **one Git repository**.

Multiple independent specs may run concurrently.

---

## Core Architecture

```text
Application / Control Plane
        │
        ├── Spec Manager
        ├── Job Scheduler
        ├── Workspace / Worktree Manager
        ├── Worker Allocator
        ├── OpenCode Session Manager
        ├── Event / Observability Manager
        └── Result Manager
                │
                ▼
        OpenCode Server
                │
        Root session per spec
                │
         Orchestration agent
                │
        ┌───────┼────────┐
        ▼       ▼        ▼
     Worker   Worker   Worker
     session  session  session
        │       │        │
      Task worktrees (one per coding task)
```

### Responsibility Boundary

**Our application owns resource isolation and lifecycle. The orchestration agent owns the coding work.**

The application does not decide how to break down or implement a specification. It provides the orchestrator with a controlled way to allocate an isolated worktree and OpenCode worker session for each coding subtask.

Our application owns:

- Job lifecycle
- Repository preparation
- Project-level Git repositories
- Spec-root and task worktree allocation
- OpenCode root and worker session lifecycle
- Resource leases and cleanup
- Spec, worker, and integration concurrency
- Status
- Events/logging
- Timeouts/stall detection
- Cost tracking
- Final result retrieval

The OpenCode orchestration agent owns:

- Understanding the specification
- Planning
- Breaking work into subtasks
- Deciding which subtasks should run in parallel
- Requesting and directing worker sessions
- Implementation
- Integrating completed task branches into the spec branch
- Tests
- Verification
- Fixes
- Documentation
- Final response

---

## Job Model

Conceptually:

```text
SpecJob
├── id
├── specification
├── repository
├── baseBranch
├── baseCommit
├── workingBranch
├── specWorkspacePath
├── rootWorktreePath
├── rootSessionId
├── workers[]
│   ├── taskId
│   ├── baseCommit
│   ├── workingBranch
│   ├── worktreePath
│   ├── sessionId
│   ├── status
│   └── tipCommit
├── status
├── startedAt
├── lastActivityAt
├── completedAt
├── finalResponse
├── error
└── execution metadata
```

Initial lifecycle:

```text
QUEUED
  ↓
PREPARING
  ↓
RUNNING
  ↓
COMPLETED

Alternative terminal states:

FAILED
STALLED
CANCELLED
```

This lifecycle should be challenged/refined during planning.

---

## Git Isolation

Use one bare common Git repository per project. Every running spec receives a non-checkout parent workspace containing:

- One root worktree for the spec integration branch.
- A reserved directory for dynamically allocated task worktrees.
- State and locking metadata owned by the control plane.

Example:

```text
/runner-data/
└── projects/
    └── <project-id>/
        ├── repo.git/                   # Bare common repository
        ├── project.lock                # Serializes Git administration
        └── specs/
            └── <spec-id>/              # Not a Git checkout
                ├── state.json
                ├── integration.lock
                └── checkouts/
                    ├── root/            # Spec integration worktree
                    └── tasks/
                        ├── <task-id-1>/  # Worker worktree
                        ├── <task-id-2>/
                        └── <task-id-3>/
```

The root and task worktrees are descendants of the spec workspace, but no task worktree is nested inside another Git worktree.

Branch allocation:

```text
Spec root: runner/spec/<spec-id>
Task:      runner/task/<spec-id>/<task-id>
```

Create the spec worktree from an immutable commit captured from the requested base branch:

```bash
git --git-dir=<repo.git> worktree add --lock \
  --reason "active spec <spec-id>" \
  -b runner/spec/<spec-id> \
  <spec-workspace>/checkouts/root \
  <base-commit>
```

Create each task branch and worktree from the spec root's captured `HEAD` when the task is allocated:

```bash
git --git-dir=<repo.git> worktree add --lock \
  --reason "active task <task-id>" \
  -b runner/task/<spec-id>/<task-id> \
  <spec-workspace>/checkouts/tasks/<task-id> \
  <task-base-commit>
```

Git worktree rules:

- Every active coding task has a unique branch and worktree.
- A branch is checked out in only one worktree; never bypass this safeguard with `--force`.
- Use opaque generated IDs in paths and branch names, not user-provided titles.
- Serialize worktree creation, removal, pruning, and repository maintenance with the project lock.
- Treat `git worktree lock` as protection from pruning/removal, not as a concurrency mutex.
- Remove worktrees with `git worktree remove`; retain dirty or failed worktrees for recovery.
- Worktrees share Git objects, refs, configuration, and hooks. They provide checkout isolation, not a security boundary.

Task worktrees should be allocated lazily. Reserve worker capacity and the task-checkout directory per spec, rather than pre-creating unused branches and worktrees.

### Task Integration

Parallel workers commit only to their task branches. Completed work is integrated into the root spec branch serially:

1. Stop or finish the worker and require a clean, committed task worktree.
2. Record and verify the task branch's exact tip commit.
3. Acquire the spec's `integration.lock` and require a clean root worktree.
4. Merge the exact task commit into the root worktree.
5. Run the required verification before committing the integration merge.
6. Confirm that the task tip is an ancestor of the spec branch.
7. Release the task worktree only after successful integration.

Keep a failed or conflicting task worktree and branch for diagnosis. Dependent tasks must run sequentially or start from a new root commit after their dependencies are integrated.

---

## OpenCode Session Model

Create **one root OpenCode session per spec**.

That root session acts as the engineering/orchestration agent and is explicitly located in the spec's root worktree.

Create one worker session per allocated coding task. Each worker session must be explicitly located in its allocated task worktree; independent workers may run in parallel.

The orchestrator decides the tasks and requests workers through a controlled application tool or API. Conceptually:

```text
start_worker(taskId, prompt, baseCommit)
    ↓
Reserve branch and worktree path
    ↓
Create task worktree
    ↓
Create OpenCode session at that worktree
    ↓
Submit task prompt
    ↓
Return worker/session handle to orchestrator
```

The application manages worker resources, status, and cleanup, but does not choose or implement the coding task.

OpenCode documents that its built-in sub-agents run in child sessions, but does not document a per-invocation working-directory option for the `subagent` tool. Do not assume a built-in sub-agent automatically moves to a task worktree. The planning phase must verify and design explicit worker-session location binding against the current OpenCode API.

---

## Orchestration Agent

Create a dedicated OpenCode primary agent, tentatively:

```text
orchestrator
```

Its mandate:

> Own the complete implementation of the provided specification and operate autonomously until the specification is complete.

Expected workflow:

```text
Read specification
↓
Inspect repository
↓
Plan
↓
Implement directly and/or allocate parallel workers
↓
Wait for completed task commits
↓
Integrate task commits serially
↓
Implement
↓
Write/update tests
↓
Run verification
↓
Fix failures
↓
Update documentation
↓
Review resulting diff
↓
Final verification
↓
Final response
```

The agent must not depend on human interaction.

When ambiguity exists it should:

1. Inspect existing code.
2. Follow existing project conventions.
3. Make the safest reasonable assumption.
4. Continue implementation.
5. Document important assumptions in its final response.

---

## Permissions

Execution is unattended.

Normal development capabilities therefore need appropriate `allow` permissions.

Human-question/approval workflows must not leave sessions permanently blocked.

The exact OpenCode permission policy needs to be designed carefully during implementation.

Security boundaries must still prevent inappropriate host/server-level operations.

---

## Observability

Use OpenCode's event/SSE capabilities rather than aggressive polling wherever practical.

The application should eventually expose information such as:

```text
Spec #104

Status: RUNNING
Elapsed: 2h 14m
Last activity: 12s ago
Root session: ses_xxx
Active worker sessions: 4
Active task worktrees: 4
Current activity: integration tests
Cost/tokens: ...
```

Persist enough execution information to diagnose failed or stalled runs.

---

## Completion

The application monitors the **root orchestration session**, its worker sessions, and their resource leases.

Conceptually:

```text
Create session
↓
Submit specification
↓
Monitor events/status
↓
Session works autonomously
↓
All worker sessions reach a terminal state
↓
All accepted task commits are integrated or explicitly rejected
↓
Root session becomes idle/completed
↓
Retrieve latest orchestration-agent response
↓
Store finalResponse
↓
Mark job COMPLETED
```

Root-session idleness alone is not completion while workers or unintegrated task results remain active.

The user-facing result should primarily be the **last response from the orchestration agent**.

Do not expose internal sub-agent chatter unless needed for observability/debugging.

---

## Long-Running Sessions

Runs may last many hours.

OpenCode context compaction should remain enabled.

We should investigate whether custom compaction/context preservation is needed to ensure critical information survives long executions, especially:

- Original specification
- Acceptance criteria
- Architectural decisions
- Completed work
- Remaining work
- Modified files
- Test state
- Known failures
- Important assumptions

---

## Concurrency

Multiple specs can execute simultaneously.

Concurrency exists at two levels:

- Multiple specs may run against the same project.
- Multiple independent coding tasks may run within each spec.

The application scheduler limits both levels. A project lock serializes Git administration, while a per-spec integration lock serializes task merges. These locks do not prevent independent workers from implementing tasks concurrently.

Example:

```text
Job Queue

Spec A → RUNNING
Spec B → RUNNING
Spec C → RUNNING
Spec D → QUEUED
Spec E → QUEUED
```

Introduce a configurable limit such as:

```text
MAX_ACTIVE_SPECS
MAX_ACTIVE_WORKERS
MAX_ACTIVE_WORKERS_PER_SPEC
MAX_ACTIVE_WORKTREES_PER_PROJECT
```

The appropriate value should consider:

- LLM/API limits
- Cost
- Server CPU
- Server RAM
- Repository build workload
- Test workload

---

# Next Phase

Do NOT immediately start coding.

First produce a detailed engineering plan.

Planning should cover at minimum:

1. Application architecture
2. Technology stack
3. Job/state machine
4. Persistence/database model
5. Project, spec, and task worktree lifecycle
6. OpenCode server lifecycle
7. OpenCode SDK integration
8. Root and worker session creation/location binding
9. Orchestrator-worker protocol and agent design
10. Permission/security model
11. Event/SSE processing
12. Observability
13. Stall detection
14. Failure handling
15. Cancellation
16. Spec, worker, Git-administration, and integration concurrency control
17. Cost/token tracking
18. Long-running session strategy
19. Context compaction
20. Restart/recovery behavior
21. API design
22. Testing strategy
23. Deployment on the dedicated server

For important OpenCode-specific architectural decisions, verify assumptions against the **current official OpenCode documentation** rather than relying on memory.

Identify uncertainties and architectural risks before implementation.

The final planning output should result in a concrete, phased implementation plan that can then be executed step-by-step.
