# @tarquinen/opencode-dcp (DCP)

**Type:** npm OpenCode plugin  
**Package:** `@tarquinen/opencode-dcp` v3.1.14  
**Installed at:** `~/.config/opencode/node_modules/@tarquinen/opencode-dcp/`  
**Config:** `~/.config/opencode/dcp.jsonc`

## What it does

Dynamic Context Prioritisation — intelligently manages which parts of the conversation context get preserved when approaching token limits. Prioritises recent tool outputs, active file edits, and key decisions over older less-relevant content.

## Config (`dcp.jsonc`)

All settings have sensible defaults and are applied automatically. Our config:
```jsonc
{
  "$schema": "..."
}
```
(Minimal config — DCP applies all defaults.)

## Notes

- No agent-facing tools
- Works transparently in the background during long sessions
- Complements `clause-compact` — DCP manages context priority, compact triggers summarization
