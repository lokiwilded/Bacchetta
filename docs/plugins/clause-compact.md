# clause-compact

**Type:** Local OpenCode plugin  
**Location:** `~/.config/opencode/plugin/clause-compact.ts`  
**Runtime:** Bun (loaded by OpenCode at startup)

## What it does

Listens to the `session.idle` event from OpenCode and automatically calls `client.session.summarize()` when a session reaches the `compact_after` turn threshold. This keeps context windows manageable without manual intervention.

## No tools — event-driven only

This plugin has no agent-facing tools. It runs silently in the background.

## Settings (in `clause-settings.json`)

| Key | Default | Description |
|-----|---------|-------------|
| `compact_after` | 20 | Summarize after this many completed AI responses |

## Notes

- Compaction trigger is also used by the clause memory extraction job — before compacting, clause extracts memory from the session
- Set higher if you want longer uninterrupted conversations; lower if you hit context limits frequently
