# Atlas

Atlas lets a team browse GitHub repositories and start autonomous OpenCode Sessions from team-authored Specs.

## Language

**Repository**:
A GitHub repository onboarded into Atlas.
_Avoid_: Project, workspace

**Spec**:
An open GitHub issue labelled `spec` that describes one implementable piece of work.
_Avoid_: job, ticket, task, specification

**Blocker**:
Any GitHub issue a Spec depends on through a GitHub issue dependency. Blockers do not gate Session starts in Phase 1.
_Avoid_: dependency, parent

**Session**:
One Atlas-managed implementation attempt of a Spec, associated with an OpenCode session and its own Session directory once prepared. A Spec may have many historical Sessions, but only one unfinished Session at a time.
_Avoid_: Run, job, SpecJob, conversation, thread

**Session directory**:
The dedicated copy of a Repository in which a Session works.
_Avoid_: Run directory, workspace, worktree, checkout

**Agent**:
The OpenCode agent that implements a Spec inside a Session.
_Avoid_: orchestrator, worker, bot

**PR**:
A GitHub pull request belonging to a Repository. A PR need not be associated with an Atlas Session.
_Avoid_: merge request

**PR stack**:
An explicitly ordered group of pull requests in the same Repository, registered as a native GitHub stack. Locally prepared branches are not yet native stack members.
_Avoid_: branch chain when referring to native membership

**Stack reservation**:
Exclusive ownership of a stack's next implementation by an Atlas Session, also applicable to a standalone parent PR before a stack exists. It can outlast the Session's execution while publication is pending.
_Avoid_: execution slot when referring to stack exclusivity

**Idle**:
A Session for which neither live execution, explicit waiting, nor a terminal outcome is confirmed. Idle does not mean completed.
_Avoid_: completed, stalled

**Active Session**:
An unfinished Session, including one that is Queued, Preparing, Running, Waiting, or Idle. Active does not necessarily mean executing.
_Avoid_: Running Session when referring to all unfinished Sessions

**Stale**:
A freshness warning that Atlas's live connection is disconnected or reconciliation is incomplete. It accompanies rather than replaces a Session's semantic state.
_Avoid_: Stall, timeout, hang
