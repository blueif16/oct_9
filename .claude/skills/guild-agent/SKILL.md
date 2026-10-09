---
name: guild-agent
description: Create, test, and save a custom Guild.ai agent from the CLI, then optionally attach a schedule (cron) or API trigger. TRIGGER when the user asks to build/try/set up a Guild agent, run an agent on a schedule or cron in Guild, or start a Guild agent from a webhook, custom job, or HTTP call. Not for installing Agent Hub agents through the web UI.
---

# Guild agent: create → test → save → trigger

Use this to go from nothing to a working private Guild agent that has passed a real test run. Every command below was run against Guild CLI v0.27.1 on 2026-10-09. Docs index: https://docs.guild.ai/llms.txt. Fetch the relevant `.md` page with curl if the CLI behaves differently from what is described here.

## Done means (all must be observable)
1. `guild auth status` prints `✓ Authenticated as <user>`.
2. The agent directory has a real `PROMPT.md` with the user's instructions, not the scaffold placeholder.
3. At least two test runs returned the agent's reply (a line starting with `<`, then `✓ Chat complete`): one normal input, and one edge case the prompt says how to handle.
4. `guild agent save` printed a SHA and `Status: DRAFT`.
5. If the user asked for a trigger: `guild trigger list` shows it.

Report each item with its evidence: the command output, not a claim.

## Steps

### 1. Install and authenticate
```bash
which guild || npm install -g @guildai/cli      # needs Node 22+
guild auth status
```
If you are not authenticated, run `guild auth login --non-interactive > /tmp/guild-login.log 2>&1` **in the background**. Then `cat` the log and give the user the `https://app.guild.ai/device-flow/<CODE>` URL and code. The command exits on its own once the user approves in the browser. Never ask the user to paste credentials.

### 2. Workspace
```bash
guild workspace list
guild workspace create <name>     # only if none suitable exists
guild workspace select <name>
```
A new account has **no** workspaces, so the Quickstart's `guild workspace select home` fails.

### 3. Scaffold the agent, outside the current repo
`guild agent init` creates its own git repo, so never point it inside another repo.
```bash
guild agent categories            # pick one
guild agent init --name <agent> --agent-type GUILD_NATIVE --category <cat> --directory ~/Desktop/<dir>
```
Choose the type with this rule (full table: docs `/guide/agent-types`):
- **GUILD_NATIVE** (default): the job is instructions plus integration tools, text in and text out. No build step.
- **OPENCLAW** or **GOOSE**: the agent must read or write files, run commands, or work in a repo (these run in a container).
- **GUILD_TYPESCRIPT** with `--template LLM|AUTO_MANAGED_STATE|BLANK`: typed input, attachments, or deterministic logic.
- **LANGGRAPH**: the user already has Python LangGraph or LangChain code.

### 4. Write the agent
- Native: replace `PROMPT.md` entirely; it becomes the system prompt. Declare tools in `guild.yaml` under `integrations:`, `sub_agents:`, and `builtins:`. The `ui` builtin is already in the scaffold.
- The prompt must define the output shape and say what to do with off-topic input. That gives you a checkable edge case for step 5.

### 5. Test (ephemeral build, nothing saved)
```bash
cd ~/Desktop/<dir> && git add -A          # only git-tracked/staged files are uploaded
echo '{"text":"<a realistic task>"}' | guild agent chat --mode json --no-splash
echo '{"text":"<an edge case>"}'      | guild agent chat --mode json --no-splash
```
Input format rules for a Native agent (learned from failures):
- `{"text": "..."}` works.
- `{"prompt": "..."}`, from the Quickstart (written for TypeScript agents), failed with `upstream request timeout`, and the session recorded no events.
- A bare JSON string fails with a pydantic `literal_error` / `dict_type` validation error.

If a run fails, check `guild session events <session-id>`. Zero events means the input never reached the agent, so fix the input format before you touch the prompt.

### 6. Save a private version
```bash
git commit -qam "<what the prompt does>"
guild agent save --message "<summary>" --wait
```
Expect `Status: DRAFT`. **Do NOT add `--publish` unless the user explicitly asks.** Publishing makes the version installable by others.

### 7. Trigger (only if the user asked for one)
The agent must be in the workspace: `guild workspace agent add <agent>`.
- **Schedule / cron:**
  `guild trigger create --type time --frequency CRON --cron-expression "0 9 * * 1-5" --cron-timezone America/New_York --agent <agent> --input '{"text":"..."}' --name "<name>"`
  The presets `HOURLY`, `DAILY --time HH:MM`, `WEEKLY --days-of-week`, and `MONTHLY --days-of-month` also work.
- **Custom job / webhook from your own code:** create an **API** trigger in the web UI (workspace → Triggers → Add Trigger → API). The `<key_id>:<secret>` is shown once, and the key can only be managed in the UI. Then call it:
  `curl -X POST https://api.guild.ai/v1/workspaces/<owner>/<workspace>/sessions -u "$KEY" -H "Content-Type: application/json" -d '{"session_type":"api_trigger","agent_input":{"text":"..."}}'`
  Poll `GET /v1/sessions/{id}` until `root_task.status` is `DONE`, `ERROR`, or `INTERRUPTED`. Read the output from `GET /v1/sessions/{id}/events`. The key can read and write every session in the workspace, so store it as a secret and never commit it.
- **Events from built-in services** (Slack, GitHub, Linear, Jira, Azure DevOps, Notion): `guild trigger create --type webhook --integration github --event pull_request --action opened --service-config '{"repo":"owner/repo"}' --agent <agent>`.
- Unverified: whether a trigger can run a DRAFT version or needs a published one. If a triggered run fails to dispatch, tell the user before publishing.

## Scope fence
- Do NOT publish, delete agents or workspaces, or create API trigger keys without an explicit ask.
- Do NOT print or commit trigger API keys.
- If the CLI rejects a flag or the output differs from what is described here, fetch the matching docs page, adapt, and tell the user which part of this skill is out of date.
