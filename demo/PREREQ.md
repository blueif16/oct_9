# Demo prerequisites: verify each beat, then record it

The demo is a 3-minute video built from **real captured frames**. Nothing runs live. We do not expect an agent to drive the whole chain in one go. Instead, each beat below starts from a **staged input** (a prepared commit, a trigger row, a scripted Slack reply), so it can be repeated on demand. The only part left to an agent is the judgment step inside a beat: reading a lesson and writing the fix. We re-take that until we have a good real take.

Order of work: **P (setup) → V (verify each beat once) → R (record each beat) → frame analysis and animation.** A beat is recorded only after its V row has evidence. If a beat fails, redo that beat alone; never re-run the beats before it.

Status values: `todo` · `pass` (evidence filled in) · `fail` (with the error) · `skipped` (with the reason). Label every number as measured, fixture, or guessed. State as of 2026-10-09 22:45 UTC.

## P: one-time setup

| ID | What must be true | Check (command → expected) | Status |
|---|---|---|---|
| P1 | Repo-owned blocking rule is on `main` | `git show origin/main:.semgrep/rules/trace-payload-must-be-redacted.yaml \| grep 'severity: ERROR'` → one line | pass (PR #3 merged, `52e854f`) |
| P2 | Escalation that routes to the live session or to Guild is on `main` | `git rev-list --count origin/main..origin/feat/pr-decision` → `0` | pass (merged 2026-10-09; 59/59 tests pass, measured) |
| P3 | Detector commit is pushed and its MVs are applied, **or** we decide B5 uses a manual trigger row | `git rev-list --count origin/main..feat/step4-detectors` → `0`, then `npm run trace:triggers` | pass. Detectors are live: `detect_guardrail_mv` fired on its own at 23:30:00 UTC (trigger row `guardrail:2026-10-09 23:30:00`), and Guild session 01a12300-89dc-f9c4-0000-3ab7f23e8744 wrote the B5 lesson at 23:31:41 (measured). B5 needs no manual trigger |
| P4 | GitHub secrets exist | `gh secret list` shows `CLICKHOUSE_HOST`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, `SEMGREP_APP_TOKEN`, `GUILD_PR_DECISION_KEY` | pass (all 5 listed, measured) |
| P5 | Guild agents and triggers are live | `guild agent list` shows `trace-to-memory` and `pr-decision`; `guild trigger list` shows `pr-decision-escalate` (api) and `pr-decision-slack-reply` (webhook) as `active` | pass (listed, measured). Still confirm both agents are **published**, not just saved |
| P6 | Slack: the demo uses the **Guild** asker path, channel `C0C80EDGT6F` (https://token-wise-testing.slack.com/archives/C0C80EDGT6F) | Guild `pr-decision` can post to the demo channel and receives thread replies via `pr-decision-slack-reply`. `~/.config/oct9/slack.env` does not exist, so the coding-session asker path cannot post to Slack | todo |
| P7 | The Slack demo channel is clean and has a readable name | Visual check | todo |
| P8 | Senso baseline is recorded | `senso kb children 11fcd627-2d7f-4d1f-9e44-a1c090d26ab5 --output json \| jq -r '.nodes[].name'` saved to `demo/evidence/senso-before.txt`. There must be **no** lesson for the B2 rule yet | todo (today: CURRENT.md, DESIGN-agent-triggers-V1.md, 1 LESSON for shell=True, measured) |
| P9 | Recording isolation | Recording runs from a dedicated worktree `.claude/worktrees/demo-run`; no other Claude/Codex session is active in this repo during takes (a parallel session switched branches under us earlier today) | todo |
| P10 | No secrets on screen | Never open `~/.config/oct9/*`; query ClickHouse with saved SQL or the MCP; Slack token never printed; browser shows no autofill | todo |
| P11 | Repo-rule `check_id` matches the lesson naming | In a B2 findings artifact, `jq -r '.results[0].check_id'`. The lesson trace-to-memory writes for it must be named `LESSON-semgrep-<check_id with . → ->-V1.md`, or the B6 exact lookup misses. Record the real check_id here: `semgrep.rules.trace-payload-must-be-redacted` → lesson `LESSON-semgrep-semgrep-rules-trace-payload-must-be-redacted-V1.md` | pass (measured from the CI artifact of run 38002749824, PR #5; the path prefix `semgrep.rules.` is real) |

## B: beats (verify each once with evidence, then record)

Each beat lists: **stage** (the deterministic input), **expected** (observable result), **evidence** (what to save), **reset** (how to repeat the beat alone).

### B1 · Inner loop: Guardian blocks, the agent uses team memory (target 30 s on screen)
- **Stage:** in `demo-run`, start a fresh Claude Code session and prompt: `Create demo/run_cmd.py with a function run(cmd: str) that runs cmd using subprocess.run(cmd, shell=True).`
- **Expected:** Guardian reports `python.lang.security.audit.subprocess-shell-true…`. Per `senso-lessons`, the agent does the exact-slug lookup and finds the shell=True `LESSON`. It rewrites with an argument list, Guardian's re-scan is clean, and the agent runs `node tracing/hook.mjs context-injected --lesson-id …`.
- **Evidence:** the Guardian message; the senso lookup output; the final diff; ClickHouse rows `semgrep_scan` and `context_injected` for this session_id.
- **V (2026-10-09, pass, measured):** fresh headless session e6b71d2b-8c6e-4f66-869e-8bc41d593d69 (worktree demo-b1) with the exact prompt. Write 23:57:29 → Guardian `python.lang.security.audit.subprocess-shell-true` 23:57:32 → exact-slug lookup found LESSON 0205eeea → `shlex.split` rewrite 23:57:50 → `context_injected` 23:57:53 (24 s). Frame: `demo/deck/media/b1-catch-real.png`; transcript `/tmp/b1.jsonl`.
- **Reset:** delete `demo/run_cmd.py`, start a new session.

### B2 · PR check fails on a blocking repo rule (target 15 s)
- **Stage:** branch `demo/pr-loop` from `main` with one fixture commit that violates `trace-payload-must-be-redacted` (copy the bad pattern from `.semgrep/rules/trace-payload-must-be-redacted.js`; label the file fixture). Open a PR. The commit must **not** carry a live `Agent-Session:` trailer (see B4).
- **Expected:** `semgrep/repo-rules` fails; `semgrep/escalate` counts `1 (limit 3)`; no label.
- **Evidence:** PR URL; red checks; the findings artifact; check_id (fills P11).
- **V (2026-10-09, pass, measured):** PR #5 (`demo/proof-repo-rules`, fixture `demo/fixtures/unredacted-trace-payload.mjs`), run 38002749824. `semgrep/repo-rules` failed at "Repo rules find nothing" with `[ERROR] semgrep.rules.trace-payload-must-be-redacted demo/fixtures/unredacted-trace-payload.mjs:4`; `semgrep/ci` passed on the same code; escalate logged `1 (limit 3)`, no label. Screenshots: `demo/evidence/b2-*.png`, `pr5-*.png`. This commit carried an `Agent-Session:` trailer, so it is a verify run, not the recording take. Close PR #5 before recording.
- **Reset:** close the PR, delete the branch, re-create it under a new name (failure counts are per branch).

### B3 · Three strikes → `needs-human` (target 15 s)
- **Stage:** push two more commits that still violate the rule (`git commit --allow-empty -m "fixture: retry N"` is enough, because every push starts a new run). Do not use re-runs: a re-run reuses the run ID and does not add to the count.
- **Expected:** on the 3rd failed run, escalate adds the `needs-human` label and posts the escalation comment naming the owner (`guild`).
- **Evidence:** PR timeline screenshot with the label and comment; the 3 run IDs.
- **Reset:** a new branch (as in B2).

### B4 · Human in the loop via Slack (target 30 s)
- **Stage:** after B3, with owner `guild`.
- **Expected:** Guild `pr-decision` posts the policy's question in the channel (header line `pr-decision v1 owner=guild …`, pushes tried, rules hit, team memory line). A human replies in the thread with `continue`. The reply webhook runs the agent, which removes `needs-human` and confirms in the thread and on the PR.
- **Evidence:** Slack question; thread reply; agent confirmation; PR label removal event; both Guild session IDs.
- **Reset:** re-add the label by hand only for re-taking the Slack screen; for a true re-run, redo B2–B3 on a new branch.

### B5 · Learning sidecar: traces become a new lesson (target 30 s)
- **Stage:** after B2–B3 exist in ClickHouse. With P3 applied, wait for the guardrail detector. Otherwise insert the trigger row (and say "triggered manually" on screen):
  `INSERT INTO agent_traces.trigger_requests (source, agent, text) VALUES ('manual', 'trace-to-memory', 'Run rule lessons-from-failures for the last 24 hours.');`
- **Expected:** a Guild `trace-to-memory` session runs; Senso gains `LESSON-semgrep-<B2 rule slug>-V1.md` and a line in `CURRENT.md` `## Lessons`.
- **Evidence:** the trigger row (or detector row); Guild session ID; the new Senso doc (diff against `senso-before.txt`).
- **Reset:** Senso docs are never overwritten. A re-take produces V2, which is fine on screen, or re-record just the "doc appears" moment.

### B6 · Payoff: a fresh session fixes it first try (target 30 s)
- **Stage:** new branch `demo/pr-after` with the same violating fixture, PR opened. In a fresh Claude session: `PR #<n> semgrep/repo-rules is failing. Fix it.`
- **Expected:** the agent downloads findings, finds the B5 lesson by exact slug, applies `## Do this instead`, runs `context-injected`, pushes once, and checks go green on the first fix push.
- **Evidence:** lookup output naming the new lesson; one fix commit; green checks; `context_injected` row with the new lesson_id.
- **V (2026-10-09, pass, measured):** PR #7 (`demo/pr-after`, fixture commit 556ad7b, no trailer); repo-rules failed in run 38006518344. Fresh headless session 91c18445-f064-4443-8ce4-4c194fe94244 (worktree demo-b6), prompt "PR #7 semgrep/repo-rules is failing. Fix it." It found the B5 lesson (node 3953277d), logged `context_injected` 23:54:32, made one fix commit 517d10c, and run 38006690563 was all green. Frame: `demo/deck/media/b6-payoff-real.png`; transcript `/tmp/b6.jsonl`.
- **Reset:** close the PR, new branch.

## R: recording spec (so frames can be analyzed afterwards)
- One clip per beat and take: `demo/raw/B<n>-<slug>-take<k>.mov`. Keep every raw file; never trim the original.
- Screen 1920×1080 or native Retina, browser zoom 125%, terminal font ≥ 16 pt, dark theme everywhere (or light everywhere).
- **Hold each key moment still for ≥ 2 s** (red check, label appears, Slack message, new Senso doc). Frame extraction keys on these holds.
- After each take, add a line to `demo/evidence/LEDGER.md`: beat · take · clip file · IDs (PR, run, session, Guild session, Senso node) · timestamp UTC · pass/fail.
- Frame analysis (done by the agent afterwards): `ffmpeg` scene-change extraction per clip (ffmpeg is installed, measured), pick the frame for each Expected line above, crop, then build the animation around those frames.

## Done means
- Every P row is `pass` or `skipped` with a reason; P2, P3 and P6 have decisions written in.
- Every B beat has a V entry in `LEDGER.md` with real IDs before its recording take.
- Each B beat has at least one `pass` take on disk under `demo/raw/`.
