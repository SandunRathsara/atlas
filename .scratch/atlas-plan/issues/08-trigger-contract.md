# 08 - Trigger contract: what Atlas sends to opencode2 when Implement is pressed
Type: grilling
Status: open
Blocked by: 01, 03

## Question

When the user presses Implement on a spec:

- Which agent name does Atlas ask for, and where is that configured.
- The prompt Atlas submits: issue URL, number, title, body, repo, base branch. Template and length limits.
- Credentials the agent needs to push and open a PR from the run directory: installation token in the remote URL, `gh` auth, or something else. How Atlas provides them without leaking.
- Session title and any metadata Atlas attaches for later lookup.
