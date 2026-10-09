# Agent instructions

All agents in this repo (Claude Code, Codex, others) share one memory: a Senso knowledge base folder.

## Shared memory (Senso)

- FOLDER_ID: `11fcd627-2d7f-4d1f-9e44-a1c090d26ab5`
- CURRENT_ID (node ID of CURRENT.md): `6485bd2d-b149-4f61-abd1-0a53f8113a20`

If either ID above still reads `TODO_…`, Senso is not set up yet: say so to the user and continue without it. NEVER invent an ID.

1. At the start of every session, run: `senso kb get-content CURRENT_ID` (read it directly; never search for it, since searches cost credits).
2. Before reading the repo or asking the user, run: `senso search "your question"`. Check the source IDs in the answer belong to FOLDER_ID; search covers the whole org, so discard answers drawn from other folders.
3. At every task boundary, rewrite CURRENT.md in place with `senso kb patch-raw CURRENT_ID --data '{"text":"<full new text>"}'`. It holds: task · current state · settled decisions · rejected ideas (and why) · next action.
4. To hand work to another agent, save a brief to FOLDER_ID with `senso kb create-raw` and pass on the returned ID.
5. Never overwrite an idea document; save a new version (V1, V2, …) so the reason an idea was dropped stays visible.
6. Label every number in a document as measured, fixture, or guessed.

Commands (add `--output json` when parsing the result):

```bash
senso kb get-content NODE_ID [--rev N]      # read a document (or an earlier revision)
senso search "question in plain words"      # ask; returns answer + source IDs
senso search "q" --content-ids CONTENT_ID --require-scoped-ids   # scoped search; content_id from `senso kb get NODE_ID`
senso kb create-raw --data '{"title":"T.md","text":"...","kb_folder_node_id":"FOLDER_ID"}'
senso kb patch-raw NODE_ID --data '{"text":"full revised text"}'
senso kb children FOLDER_ID                 # list the folder
```

## Tool-call tracing (ClickHouse)

Hooks (`.claude/settings.json`, `.codex/hooks.json`) send every session, prompt, Edit/Write/Bash call and Semgrep result to ClickHouse `agent_traces.events`. Payloads are redacted before they leave the machine; while ClickHouse is unreachable, rows queue in `.trace/spool.jsonl`.

- Query traces with the read-only `clickhouse` MCP server. NEVER print `~/.config/oct9/clickhouse.env`; it holds the database password.
- When you hand a lesson to an agent, record it: `node tracing/hook.mjs context-injected --lesson-id <ID>`.
- Commits made in a Claude session get an `Agent-Session:` trailer automatically; don't remove it.

## Security scanning (Semgrep Guardian)

Semgrep Guardian scans every file an agent writes (Claude Code plugin + Codex plugin). When it returns findings, fix them before moving on; never suppress a finding without telling the user.
