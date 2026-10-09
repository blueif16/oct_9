# Judge brief: token-wise

## 30-second pitch
Every coding-agent session starts with no memory. When an agent hits a bug a teammate's agent fixed yesterday, it retries: the same mistake, the same wasted tokens. token-wise gives a team's agents a shared memory. Semgrep catches the mistake, the agent asks Senso for the team's lesson before retrying, three failed PR runs hand off to a human in Slack, and ClickHouse plus Guild turn every failure into a new lesson. Fail once. Ask the team. Never twice.

## Numbers to quote (all measured 2026-10-09)
- **879** tool calls and **870** security scans traced into ClickHouse in one day of building.
- **8** lessons written by our Guild agents from our own agents' mistakes, plus 2 runbooks.
- The learning loop ran **with no manual step**: 3 CI findings at 23:08–23:16 UTC → `detect_guardrail_mv` fired at 23:30 → Guild wrote the lesson at 23:31.

## Proof points, if they ask "is that real?"
- **Escalation:** PR #5 failed `semgrep/repo-rules` 3 times → `needs-human` label + comment (public on GitHub).
- **Human in the loop:** PR #4. Guild asked in Slack, a human replied `continue`, and the bot removed the label and commented.
- **Learning from ourselves:** a session failed 3× in 1 minute on a blocked shell command. Guild's loop-breaker wrote `LESSON-loop-worktree-complex-command-V1` at 22:53. A later session hit the same block, used the lesson's fix, and got through on the next try (`context_injected` logged).
- **Our own rule caught what the default scan missed:** on PR #5, `semgrep/ci` passed while our repo rule `trace-payload-must-be-redacted` failed.

## Likely questions
**Isn't this just RAG over a vector database?** No. Retrieval is *triggered by failure*: a Semgrep finding, a failing PR check, or 3 failures of one goal. It's scoped to the team's folder, with an exact rule→lesson lookup first (free) and search second. And the lessons are *generated from measured traces*, not hand-written docs.

**What stops a bad lesson from spreading?** Each lesson carries its measured evidence and a "When this does not apply" section. Lessons are versioned and never overwritten, so a wrong one is replaced by V2 while V1 stays visible. Humans decide at the escalation point. *Honest gap:* we don't yet auto-check whether a lesson actually made the next fix pass.

**Does it save money?** It cuts the retry loop: the agent stops after 3 failures and asks memory or a human. The lesson lookup is a free listing plus at most one search. *Honest gap:* we haven't measured token savings yet. That's the next metric, comparing before vs after a lesson using ClickHouse.

**Aren't you storing sensitive data in traces?** Payloads are redacted before they leave the machine, and our repo rule `trace-payload-must-be-redacted` blocks any PR that writes unredacted trace payloads. That's the rule in the demo.

**Does it work beyond Claude Code?** Codex uses the same hooks, rules (`AGENTS.md`) and memory. Codex commits don't carry the session trailer yet, so their escalations always go to the Guild agent.

## Known limits (say them before they're found)
- Slides 5 (catch) and 9 (payoff) use frames built from real traces and lessons, not screen recordings.
- The Slack capture's "Tried so far" line says "none found": it came from a test PR with no history.
- The B5 run wrote the lesson but didn't add it to the `CURRENT.md` index.
