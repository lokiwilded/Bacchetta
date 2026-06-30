# clause-cache

**Type:** Local OpenCode plugin  
**Location:** `~/.config/opencode/plugin/clause-cache.ts`  
**Runtime:** Bun (loaded by OpenCode at startup)

## What it does

Wraps file reads and shell commands with an in-memory cache keyed on file mtime or TTL. Prevents repeated identical reads from bloating context. Also caps large outputs so agents don't receive 100K token files.

## Tools exposed

| Tool | Signature | Description |
|------|-----------|-------------|
| `read_cached` | `(path)` | Read a file with caching. Returns truncated content with a note if over cap. |
| `bash_cached` | `(command, ttl_seconds?, cwd?)` | Run a read-only shell command and cache output. Do NOT use for side-effect commands. |
| `cache_status` | `()` | List what is currently in cache. |

## Settings (in `clause-settings.json`)

| Key | Default | Description |
|-----|---------|-------------|
| `cache_read_cap_chars` | 40000 | Max chars returned per file read |
| `cache_bash_cap_chars` | 20000 | Max chars returned per bash output |

## Notes

- Always prefer `read_cached` over the built-in `read` tool
- Use `bash_cached` only for status checks: `git status`, `ls`, `cat` — never for `npm install`, edits, or git commits
- Use plain `bash` for anything that changes state
