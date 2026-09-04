# 11 - Restart and recovery: reconciling runs with sessions and run directories after Atlas restarts
Type: grilling
Status: open
Blocked by: 02, 07

## Question

- On startup, how Atlas reconciles stored runs against live opencode2 sessions and run directories on disk.
- Runs whose session vanished. Runs whose directory vanished.
- Resubscribing to events without missing transitions that happened while Atlas was down.
- opencode2 server restarted or upgraded mid-run: the stream closes without replay and in-flight sessions get `interrupted{reason: shutdown}` then auto-resume (issues/02, unverified on build 17823). How Atlas reconnects and reconciles run state, and what a build upgrade means for the pinned client package.
