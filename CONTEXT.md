# Atlas

Atlas watches GitHub repositories for issues labelled `spec` and turns each one into an autonomous implementation run on an opencode2 server.

## Language

**Project**:
A GitHub repository Atlas watches.
_Avoid_: repo, workspace

**Spec**:
A GitHub issue labelled `spec` that describes one implementable piece of work.
_Avoid_: job, ticket, task, specification

**Blocker**:
Any GitHub issue a spec depends on through a GitHub issue dependency. A spec with an open blocker cannot start a run.
_Avoid_: dependency, parent

**Run**:
One implementation attempt of a spec. A run owns one session and one run directory.
_Avoid_: job, SpecJob, execution

**Run directory**:
The full clone of the project a run's session works in. Created by Atlas per run; never a git worktree.
_Avoid_: workspace, worktree, checkout

**Session**:
The opencode2 session a run drives.
_Avoid_: conversation, thread

**Agent**:
The opencode2 agent that implements a spec inside a session. Defined and configured on the opencode2 server, not in Atlas.
_Avoid_: orchestrator, worker, bot

**PR**:
The pull request the agent opens for a run, linked to the spec through GitHub's own linked-PR data.
_Avoid_: merge request

**Stall**:
A run whose session has shown no activity for longer than the configured threshold. Atlas cancels the session and marks the run stalled.
_Avoid_: timeout, hang
