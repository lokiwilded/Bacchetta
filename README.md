# clause

A minimal overlay on [opencode](https://github.com/opencode-ai/opencode) that adds:
- Combined usage/savings dashboard
- Swarm monitor (live session tree, tool calls, reasoning)
- Agent model config UI
- PWA/mobile support
- `clause` CLI to start everything in one command

## How the fork works

We fork `opencode-ai/opencode` and make **exactly two changes** to their code:

1. `packages/web/server/_chunks/renderer-template.mjs` — add one floating button to the HTML template
2. `packages/web/public/dashboard.html` — our dashboard (new file, zero conflict)

Everything else is unmodified upstream code. When they ship an update:

```bash
git fetch upstream
git rebase upstream/main
# resolve conflicts in renderer-template.mjs only (one line)
```

## Setup (Docker — recommended)

```bash
git clone https://github.com/yourname/clause
cd clause
cp .env.example .env
# edit .env — add your OLLAMA_API_KEY
docker compose up
# open http://localhost:3000/dashboard.html
```

## Setup (local)

```bash
npm install -g opencode-ai
npx clause          # or: bun run clause/cli/index.ts
```

## Project layout

```
clause/
├── docker-compose.yml      # runs opencode + clause-ui together
├── .env.example
├── overlay/                # the ONLY files we change from upstream
│   ├── apply.sh            # patches a fresh opencode checkout
│   └── renderer-patch.js   # the one-line HTML template addition
├── ui/                     # standalone dashboard server (Bun)
│   ├── Dockerfile
│   ├── server.ts           # entry point
│   ├── routes/
│   │   ├── usage.ts
│   │   ├── monitor.ts
│   │   ├── agents.ts
│   │   └── models.ts
│   └── public/
│       └── dashboard.html
└── cli/
    ├── index.ts            # `clause` command
    └── package.json
```
