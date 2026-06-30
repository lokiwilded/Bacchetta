#!/usr/bin/env bash
# Apply clause overlay to a fresh opencode checkout.
# Run from the root of the forked opencode repo.
# After pulling upstream updates: git rebase upstream/main && bash clause/overlay/apply.sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAUSE_DIR="$(dirname "$SCRIPT_DIR")"
WEB="packages/web"

echo "→ Applying clause overlay..."

# 1. Copy dashboard.html into opencode's public dir
cp "$CLAUSE_DIR/ui/public/dashboard.html" "$WEB/public/dashboard.html"
echo "  ✓ dashboard.html"

# 2. Register dashboard.html in Nitro's static asset registry (index.mjs)
# We use node to do the patch safely rather than sed
node "$SCRIPT_DIR/patch-index.mjs" "$WEB/server/index.mjs"
echo "  ✓ index.mjs patched"

# 3. Add dashboard button to the HTML template
node "$SCRIPT_DIR/patch-template.mjs" "$WEB/server/_chunks/renderer-template.mjs"
echo "  ✓ renderer-template.mjs patched"

echo "→ Done. Restart the web server to pick up changes."
