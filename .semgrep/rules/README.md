# Repo Semgrep rules

This folder holds this project's own Semgrep rules. The `semgrep/repo-rules` check in `.github/workflows/semgrep.yml` runs them on every PR. Guardian does not run them, because developer rules are not enabled for our Semgrep deployment. The Semgrep AppSec Platform Policies run separately, in `semgrep/ci`.

Agents add, change, and retire rules here. A human merges the PR. That merge is the only approval step.

## When to add or change a rule
- **Add** a rule when a lesson or a stated requirement (AGENTS.md, a user instruction, a `LESSON-*.md` in Senso) names a code shape that is always wrong in this repo, and Semgrep's own rules do not already catch it.
- **Narrow** a rule when it flags code that is correct. Add a `pattern-not`, and add that code to the fixture as an `ok:` case.
- **Retire** a rule when the requirement it enforces is gone. Delete both of its files.
- Do not write a rule for something you cannot point to as a single code shape in one file. Semgrep checks each file on its own, so a rule cannot follow data across files.

## What one rule looks like (both files are required)
| File | Contents |
|---|---|
| `<rule-id>.yaml` | Exactly one rule under `rules:`. Its `id` is the file name. |
| `<rule-id>.<ext>` | A fixture in the rule's language. It has at least one `// ruleid: <rule-id>` line above code that must match, and at least one `// ok: <rule-id>` line above similar code that must not match. |

In the rule:
- `id` is specific, for example `trace-payload-must-be-redacted`, not `redaction`.
- `message` says why the code is wrong in this repo and exactly what to write instead.
- `severity: ERROR` fails the PR. Use it only for code that must never merge.
- `metadata.source` names where the requirement came from: an AGENTS.md section, a Senso lesson ID (`lesson_id: <kb_node_id>`), or a PR number.

`trace-payload-must-be-redacted.yaml` and `.js` are the reference example.

## Done means (run both locally; both must pass before you push)
```bash
semgrep --test .semgrep/rules                                                   # every ruleid: line matches, no ok: line does
semgrep scan --config .semgrep/rules --exclude .semgrep --metrics off --error .   # exit 0: the repo is clean
```
- If the scan finds existing code that breaks a new rule, either fix that code in the same PR (in a separate `fix:` commit), or narrow the rule if the code is actually correct. Do not merge a rule the repo already fails.
- Show that the fixture can fail: delete one `pattern-not` (or break the pattern), run `semgrep --test`, see it fail, then restore the line.
- Open the change as a **draft PR** titled `feat(semgrep-rule): <rule-id>`. In the body, link the requirement or lesson, and paste both commands' output.
- If you cannot name the requirement the rule enforces, stop and report to the user instead of inventing one.
