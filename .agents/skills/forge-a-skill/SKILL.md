---
name: forge-a-skill
description: Forge one codebase rule into a guardrail skill. Use only when the developer invokes /forge-a-skill by name.
disable-model-invocation: true
---

# Forge a Skill

Forge exactly one agent-owned guardrail skill. Do not continue unless the
developer invoked `/forge-a-skill` by name.

## Workflow

### Step 1: Guard and input

Confirm that the developer invoked `/forge-a-skill` by name. Take the rule from
the invocation arguments. If there is no rule argument, ask one question for
the rule. Stop if the skill was selected by the model instead of the developer.

### Step 2: Apply the one-job test

Ask yourself exactly one question: "Does this rule answer exactly one question
an agent asks itself?" Split a rule joined by "and", or a rule whose correct
tool depends on the request, into separate jobs. Forge only the first job and
save each remaining job for the report as follow-up `/forge-a-skill` runs.

### Step 3: Run the six-field interview

Read the repository guidance and its routed knowledge maps first. Then inspect
the relevant source, tests, configuration, and commands. Derive a candidate
name from the rule using the naming contract in Step 4, then derive:

- proposed anchors;
- one to three exemplars cited as `path#symbol`;
- a positive decision procedure;
- a repository violation check command, or one concrete manual check;
- current violations, including every finding's path and evidence; and
- whether a guardrail of that name already exists.

Do not treat a map statement as source evidence when a more direct file or
symbol is available. Complete the scan before the interview only when it has
one to three direct `path#symbol` exemplars. If none exists, stop and explain
that the rule cannot be forged from current repository evidence. If an
existing skill is a guardrail, this run is a **Re-forge**: use its current
content as the interview defaults and update it in place after approval. If the
existing canonical skill is not a guardrail, stop rather than replace it.

Present all six fields in one message. This is one fixed round; do not spread
the fields across multiple rounds. Present the one to three exemplars with the
six fields. Propose Anchors, Decision procedure, and Violation check command
from the scan. Ask the developer only for Question answered, Why, and
Exceptions; let them correct any proposal.

1. **Question answered**: the one question this rule answers.
2. **Why**: the system scale and use case that make the rule suitable.
3. **Anchors**: directories, libraries, layers, or verbs where the rule applies.
4. **Decision procedure**: positive steps an agent follows.
5. **Exceptions**: known cases where the rule does not apply.
6. **Violation check command**: a repository command that detects violations,
   or a concrete manual check when no command exists.

### Step 4: Derive the skill contract

- Choose a lowercase, hyphenated, plain trigger-word-led name. It must match the
  directory `.agents/skills/<name>/`.
- Write a description of at most 200 characters in exactly this form:
  `<rule in one clause>. Use when planning, reviewing, or changing <anchors>.`
- Use the interview answers to fill
  `.agents/skills/forge-a-skill/templates/guardrail.md`. Keep its eight sections
  in order and keep the body at most 60 lines. Include one to three direct
  `path#symbol` exemplars. Use `None confirmed` only for an exception or
  reference that the available evidence does not show.
- Put the command and its success criterion in Verification. If there is no
  command, put one concrete `Manual check:` line there.

### Step 5: Show the plan and get approval

Show the skill name, the description verbatim, anchors, exemplars, and
verification command or manual check. List every current violation and require
one choice for each finding before approval:

- **Grandfather**: add it to Known exceptions with its path.
- **Park**: delegate it to `defer-work`, which requires developer approval. This
  skill does not park the work itself.

Count unique project skills and personal skills on the developer's machine;
do not count harness exposures or count an existing Re-forge twice. Sum their
description character lengths, including the new or updated guardrail. Use the
8,000-character budget and calculate
`headroom = 8,000 - description characters`. Show the calculated plan line with
all placeholders replaced:

`Skill listing: <project-count> project skills + <personal-count> personal skills; <total> description characters; 8,000-character budget; <headroom> headroom.`

If this rule is a consequential decision, offer to invoke
`recording-decisions`; that skill owns any ADR. If the developer accepts,
invoke `recording-decisions`, wait for its ADR path, and add that ADR path to
the planned References before asking for approval. End with one explicit
approval question. No guardrail file is written before the developer approves
the complete plan and every violation has a disposition.

### Step 6: Write the guardrail

After approval, invoke `defer-work` for each parked finding. Then confirm that
the name matches its directory, the description has the required form and is
at most 200 characters, the fixed sections remain in order, Exemplars contains
one to three `path#symbol` entries, and the body is at most 60 lines. Then
create a new guardrail, or update it in place for a Re-forge:

- Write `.agents/skills/<name>/SKILL.md` from the fixed guardrail template. Add
  each grandfathered finding to Known exceptions with its path.
- Write `.agents/skills/<name>/evals/evals.json` from
  `.agents/skills/forge-a-skill/templates/probe-set.json`. Replace every
  placeholder with concrete repository language. Keep five should-trigger
  prompts across planning, design, review, editing, and refactoring phrasings,
  and three should-not-trigger prompts outside the anchors. Each
  `expected_output` must state whether the guardrail loads.

Do not add the guardrail to `.agents/bearings.json`; forged skills are
agent-owned project files. Stop rather than replace an existing canonical
skill that is not a guardrail. Never edit source files or fix violations during
a forge.

### Step 7: Expose the guardrail

If `.agents/bearings.json` does not exist, write only the canonical skill
directory and state that no harness exposure was created. Otherwise, read
`harnesses` and `exposure` from the Manifest:

- For `symlink`, create `.<harness>/skills/<name>` as the relative symlink
  `../../.agents/skills/<name>`.
- For `copy`, recursively copy the canonical skill directory to
  `.<harness>/skills/<name>`.

Expose it to every configured harness. Do not change the Manifest or harness
settings, and do not replace an unrelated exposure collision.

### Step 8: Verify and report

When a Manifest exists, run `npx bearings verify` and fix only guardrail or
exposure errors from this run. Finish only when it reports zero failures.
Report the canonical path, exposure paths, a `git diff` pointer for review, the
fix list with every violation and its disposition, and all follow-up forges
from Step 2. When there is no Manifest, clearly state that verification and
exposure were not available.

Recalculate the Step 5 skill-listing math from the files now on disk and repeat
its exact `Skill listing:` line in the report.

If headroom is 1,600 characters or less, advise the developer that they can
raise `skillListingBudgetFraction`. Report only. Do not edit harness settings.
Tell the developer to use `skill-creator` description tuning when it is
installed. Otherwise, tell them to check all probes in a fresh session and
confirm that should-trigger prompts load the guardrail and should-not-trigger
prompts do not.

## Wall

This skill does not fix violations, record an ADR, park work, edit the Agent
Seed, edit knowledge maps, edit harness settings, or approve anything on the
developer's behalf. Delegate an approved ADR to `recording-decisions` and an
approved deferral to `defer-work`.
