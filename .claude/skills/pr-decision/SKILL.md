---
name: pr-decision
description: Ask the human in Slack what to do with a PR you pushed that is now labeled needs-human, then act on the answer. TRIGGER when your PR has the `needs-human` label and the escalate comment on it names your session (`session:<your session id>` will ask for a decision). Not when it names `guild`: the Guild agent asks then, so stop and report to the user.
---

# pr-decision (coding-agent runtime)

You are the asker described in `policies/pr-decision/POLICY.md`, as owner `session:<your session id>`. **Read that file in full first; it is the policy.** This skill only adds how to do each policy step from a coding session. You have one advantage over the Guild agent: you know what you tried, and you can make a `guardrail` change yourself.

## Setup facts
- Your session ID: `$CLAUDE_CODE_SESSION_ID`. Codex commits carry no `Agent-Session:` trailer yet, so CI always routes Codex PRs to Guild.
- Slack: `~/.config/oct9/slack.env` holds `SLACK_BOT_TOKEN` and `SLACK_CHANNEL`. Load it with `set -a; . ~/.config/oct9/slack.env; set +a`. NEVER print the file or the token. If the file is missing, tell the user Slack is not set up for coding agents, and run the handover (step 6) so the Guild agent asks instead.
- Who owns the PR: `gh pr view <pr> --json comments --jq '.comments[].body' | grep 'will ask for a decision'` (the newest line wins).

## Steps
1. **Context (policy §3).** Get the title with `gh pr view <pr> --json title,headRefName`, and the run ID from the escalate comment's run URL. Write "Tried so far" from your own session: at most 3 attempts, one line, plus the rule IDs. Look up lessons for free with `senso kb children 11fcd627-2d7f-4d1f-9e44-a1c090d26ab5 --output json`.
2. **Ask (policy §4)** with `owner=session:$CLAUDE_CODE_SESSION_ID`. Keep the returned `ts`:
   ```bash
   jq -n --arg c "$SLACK_CHANNEL" --arg t "$TEXT" '{channel:$c, text:$t}' \
     | curl -sS -H "Authorization: Bearer $SLACK_BOT_TOKEN" -H 'Content-Type: application/json' -d @- https://slack.com/api/chat.postMessage | jq -r '.ok, .ts, .error'
   ```
3. **Wait** for a human reply: poll once a minute, for up to 30 minutes:
   ```bash
   curl -sS -H "Authorization: Bearer $SLACK_BOT_TOKEN" "https://slack.com/api/conversations.replies?channel=$SLACK_CHANNEL&ts=$TS" \
     | jq -c '.messages[1:][] | select(.bot_id == null) | {user, text, ts}'
   ```
   Read the newest human reply with policy §5. If the decision is `unclear`, reply in the thread as §6 says and keep waiting.
4. **Act (policy §6)** with `gh`:
   - Remove the label: `gh pr edit <pr> --remove-label needs-human`. Add it: `gh pr edit <pr> --add-label needs-human`.
   - Rerun: `gh run rerun <run_id> --failed`.
   - Comment: `gh pr comment <pr> --body "<the §6 comment>"`.
   - Thread reply: the `chat.postMessage` call from step 2, with `thread_ts:$TS` added.
5. **Continue your own work.**
   - `continue`: resume the `senso-lessons` Semgrep PR loop.
   - `rerun`: run `gh pr checks <pr> --watch`.
   - `guardrail`: make exactly the change in `guardrail_text`, in its own `fix:` commit on the branch. Push, remove `needs-human`, and comment that it is done.
   - `stop`: end the work on this PR and report to the user.
6. **Handover.** If 30 minutes pass with no decision, or your session must end first, hand the thread to Guild:
   - Edit the header line to say `owner=guild` with `chat.update` (`channel`, `ts`, the new `text`).
   - Post `Handing this thread to the Guild agent; reply here as before.` in the thread.
   - Comment on the PR: ``` `guild` will ask for a decision in Slack (handed over by session:<id>). ```

## Done means (report each with evidence)
- The question's `ts` and its header line, or the handover output.
- The human's reply and the decision you read from it (§5).
- The `gh` output for each §6 action, and the thread reply's `ok: true`.
- The policy self-check (§7), marked PASS for each item.
