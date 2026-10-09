---
name: senso-lessons
description: Ask the team's Senso memory for a lesson before retrying a failing approach, and handle Semgrep Guardian findings by looking up the matching Senso lesson first. TRIGGER when (a) the same tool call, command, or test has failed 3 times in this session, including retries where you rewrote the call, (b) Semgrep Guardian reports a finding on a file you wrote, or (c) the `semgrep/ci` check fails on a PR. Not for routine first-attempt errors.
---

# Senso lessons: stop retrying, ask the team memory

Senso holds lessons that the Guild `trace-to-memory` agent extracts from past failures and saves as `LESSON-*.md` documents in the shared folder. This skill tells you when to read them and how. Every command below was run against Senso CLI v0.18.1 on 2026-10-09.

```bash
FOLDER=11fcd627-2d7f-4d1f-9e44-a1c090d26ab5   # from AGENTS.md; never invent another
FAIL_LIMIT=3                                    # failures before you must consult Senso
```

## When this applies (observable triggers only)
- **Repeated failure.** Count the failures of one goal in this session, for example "run the tests", "insert into ClickHouse", or "call the Guild API". Rewritten calls, changed flags, and new approaches to the same goal all add to the same count. When the count reaches `FAIL_LIMIT`, stop. Do not make attempt number `FAIL_LIMIT + 1` until you have finished steps 1–4 below.
- **Semgrep PR check.** `gh pr checks` shows `semgrep/ci` failing. Go to the Semgrep PR check section.
- **Semgrep finding.** Guardian output contains a line like `[ERROR] python.lang.security.audit.subprocess-shell-true.subprocess-shell-true`. Go to the Semgrep section.

## Why you do not just retry
| Excuse | Correction |
|---|---|
| "One more tweak and it'll work." | You have already tried `FAIL_LIMIT` tweaks. A lesson may name the actual cause, and a lookup costs one call. |
| "Senso won't know about this." | You can't know that until you search. A search that finds nothing also tells the team about the gap (see step 2). |
| "Searching costs credits." | Step 1 is free. Step 2 is one search, which is cheaper than another failed loop. |
| "I'll just suppress the Semgrep rule." | AGENTS.md forbids suppressing a finding without telling the user. Look up the lesson and fix the code. |

## Repeated failure: steps
1. **List the folder's lessons (free, no search).**
   ```bash
   senso kb children $FOLDER --output json | jq -r '.nodes[] | select(.name|startswith("LESSON-")) | "\(.content_id)  \(.kb_node_id)  \(.name)"'
   ```
   If a title clearly names your failure, read that lesson with `senso kb get-content <kb_node_id>` and skip to step 3. If there are no `LESSON-` rows, skip to step 4.
2. **Search only those lessons.** Describe the failure in plain words: the goal, the error text, and what you already tried. Do not paste the raw stack trace.
   ```bash
   IDS=$(senso kb children $FOLDER --output json | jq -r '.nodes[] | select(.name|startswith("LESSON-")) | .content_id')
   senso search context "<goal> fails with <error>; tried <A>, <B>" \
     --content-ids $IDS --require-scoped-ids --max-results 3 --output json \
     | jq -r '.results[] | "\(.score)  \(.kb_node_id)  \(.title)\n\(.chunk_text)\n"'
   ```
   - Never run `search` with an empty `$IDS`. The API returns `400 Invalid request body`.
   - Leave gap signals on (do not pass `--no-gap-signals`). When a real question finds nothing, Senso files it as a gap.
   - Read the full lesson (`senso kb get-content <kb_node_id>`) before acting on a chunk.
3. **Apply or reject the lesson, then record it.**
   - The lesson applies if its `## What happened` matches your error and its `## When this does not apply` does not exclude your case. Then follow `## Do this instead`, and record that you used it:
     ```bash
     node tracing/hook.mjs context-injected --lesson-id <lesson_id from the doc header>
     ```
   - If it does not apply, give one line of reason and continue to step 4.
4. **No lesson applies.** Stop retrying the same approach. Follow the `systematic-debugging` skill (reproduce, find the root cause, change one variable at a time). If you hit `FAIL_LIMIT` again on the new approach, stop and report to the user. Do not write a lesson yourself: your failures are already traced to ClickHouse, and the Guild agent turns them into lessons.

## Semgrep finding: steps
1. Take the rule ID from the `[SEVERITY] <rule.id>` line and replace `.` with `-` to get the lesson slug. For example, `python.lang.security.audit.subprocess-shell-true.subprocess-shell-true` becomes `python-lang-security-audit-subprocess-shell-true-subprocess-shell-true`.
2. Look for an exact lesson (free). Lesson files are named `LESSON-semgrep-<slug>-V<n>.md`; use the highest `V<n>`.
   ```bash
   senso kb children $FOLDER --output json | jq -r --arg s "LESSON-semgrep-<slug>-V" '.nodes[] | select(.name|startswith($s)) | "\(.kb_node_id)  \(.name)"'
   ```
3. If a lesson exists, read it, fix the code as `## Do this instead` says, and run `node tracing/hook.mjs context-injected --lesson-id <lesson_id>`. If none exists, fix the code from Semgrep's own message.
4. Confirm that Guardian's scan of the rewritten file reports no finding for that rule. Do not move on until it does. Never add `nosemgrep` or any other suppression without telling the user the rule ID and why.

## Semgrep PR check: steps
`.github/workflows/semgrep.yml` runs `semgrep ci` (Semgrep AppSec Platform) on every PR. Each failed `semgrep/ci` run counts as one failure toward `FAIL_LIMIT`. When the workflow's `semgrep/escalate` job counts `FAIL_LIMIT` failed runs on the branch, it labels the PR `needs-human`. That label is the human-in-the-loop (HITL) route.
1. After every push to a PR branch, wait for the check:
   ```bash
   gh pr checks <pr> --watch     # waits for every check, including semgrep/escalate
   ```
2. If `semgrep/ci` fails, first check for the label:
   ```bash
   gh pr view <pr> --json labels --jq '.labels[].name' | grep -x needs-human
   ```
   If it prints `needs-human`, stop. Do not push again. If the escalate comment names your session as the asker, follow the `pr-decision` skill. Otherwise give the user the PR URL, the findings, and the fixes you tried. Resume only after a human removes the label; the newest `Human decision via Slack` comment on the PR says what to do.
3. Otherwise, download the findings from the failed run:
   ```bash
   RUN=$(gh run list --workflow Semgrep --branch <branch> --status failure --limit 1 --json databaseId --jq '.[0].databaseId')
   gh run download $RUN -n semgrep-results -D /tmp/semgrep-$RUN
   jq -r '.results[] | "[\(.extra.severity)] \(.check_id)  \(.path):\(.start.line)"' /tmp/semgrep-$RUN/semgrep-results.json
   ```
   If there is no artifact, or `results` is empty, the scan itself failed (for example, a missing `SEMGREP_APP_TOKEN`). Read `gh run view $RUN --log-failed`, then report to the user instead of changing code.
4. For each `check_id`, follow **Semgrep finding: steps** 1–3 above. Then commit with a `fix:` message that names the rule ID, push, and return to step 1.

## Done means (report each with evidence)
- The command output from step 1, plus step 2 if you ran it, or the exact lesson lookup for a Semgrep finding.
- The lesson you used and the `context-injected` command you ran, or a one-line reason no lesson applied.
- For Semgrep: the clean re-scan of the file. For a PR: `semgrep/ci` passing, or the `needs-human` label plus your report to the user. For a PR: `semgrep/ci` passing, or the `needs-human` label and your report to the user.
- No attempt beyond `FAIL_LIMIT` happened before the Senso lookup.
