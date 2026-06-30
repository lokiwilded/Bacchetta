# opencode-synced

**Type:** npm OpenCode plugin  
**Package:** `opencode-synced` v0.9.0  
**Installed at:** `~/.config/opencode/node_modules/opencode-synced/`  
**One-time setup:** Run `/sync-init` in an OpenCode session after first install

## What it does

Syncs OpenCode configuration (agents, settings, keybindings) across machines via a configured backend (Git repo, S3, etc.). Useful for keeping your agent definitions and preferences consistent across multiple installs.

## Setup

After adding to the plugin list and restarting OpenCode, run:
```
/sync-init
```
This initialises the sync backend and creates an initial snapshot.

## Notes

- Loads without error even before `/sync-init` is run
- Config is stored in `~/.config/opencode/` (the same dir as `opencode.json`)
- No agent-facing tools — operates via slash commands in the OpenCode UI
