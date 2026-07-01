'use strict';

const path     = require('node:path');
const os       = require('node:os');
const fs       = require('node:fs');
const Database = require('better-sqlite3');

const CLAUSE_PROJECTS_PATH = path.join(os.homedir(), '.config', 'opencode', 'clause-projects.json');

function loadClauseProjects() {
  try {
    if (fs.existsSync(CLAUSE_PROJECTS_PATH))
      return JSON.parse(fs.readFileSync(CLAUSE_PROJECTS_PATH, 'utf8')).projects || [];
  } catch {}
  return [];
}

function normPath(p) {
  return (p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

// Build worktree → { name, id } map from clause-projects.json
function buildProjectMap() {
  const map = new Map();
  for (const p of loadClauseProjects()) {
    if (p.directory) map.set(normPath(p.directory), { name: p.name, id: p.id });
  }
  return map;
}

module.exports.handler = async function handler(_req, res, url, ctx) {
  try {
    const sessionId  = url.searchParams.get('session') || null;
    const sinceParam = url.searchParams.get('since');
    const sinceTs    = sinceParam ? parseInt(sinceParam, 10) : Date.now() - 3_600_000;

    const db = new Database(path.join(ctx.dataDir, 'opencode.db'), { readonly: true });

    // Root sessions only (parent_id IS NULL), newest first, with project info
    const sessions = db.prepare(`
      SELECT s.id, s.parent_id, s.project_id,
        COALESCE(s.agent,'unknown') as agent,
        json_extract(s.model,'$.id') as model_id, s.title,
        CAST(COALESCE(s.tokens_input,0)  AS INTEGER) as tokens_input,
        CAST(COALESCE(s.tokens_output,0) AS INTEGER) as tokens_output,
        CAST(s.time_created AS INTEGER) as time_created,
        CAST(s.time_updated AS INTEGER) as time_updated,
        CASE WHEN CAST(s.time_updated AS INTEGER) > (unixepoch('now')*1000 - 45000) THEN 1 ELSE 0 END as is_active,
        CAST((CAST(s.time_updated AS INTEGER) - CAST(s.time_created AS INTEGER)) / 1000 AS INTEGER) as time_active_secs,
        p.worktree as project_worktree
      FROM session s
      LEFT JOIN project p ON p.id = s.project_id
      WHERE s.parent_id IS NULL
      ORDER BY s.time_updated DESC LIMIT 200
    `).all();

    // Parts: for a specific session fetch root + all children combined
    let parts = [];
    if (sessionId) {
      const sid  = sessionId.replace(/'/g, "''");
      const rows = db.prepare(`
        SELECT p.id, p.session_id, CAST(p.time_created AS INTEGER) as time_created,
          json_extract(p.data,'$.type') as type, p.data,
          COALESCE(s.agent,'unknown') as agent,
          json_extract(s.model,'$.id') as model_id, s.title as session_title, s.parent_id
        FROM part p JOIN session s ON s.id = p.session_id
        WHERE (p.session_id = '${sid}' OR s.parent_id = '${sid}')
          AND json_extract(p.data,'$.type') IN ('tool','text','reasoning')
        ORDER BY p.time_created ASC LIMIT 1000
      `).all();
      parts = rows.map(mapPart);
    } else {
      // Live feed — recent parts across all sessions
      const rows = db.prepare(`
        SELECT p.id, p.session_id, CAST(p.time_created AS INTEGER) as time_created,
          json_extract(p.data,'$.type') as type, p.data,
          COALESCE(s.agent,'unknown') as agent,
          json_extract(s.model,'$.id') as model_id, s.title as session_title, s.parent_id
        FROM part p JOIN session s ON s.id = p.session_id
        WHERE CAST(p.time_created AS INTEGER) > ${sinceTs}
          AND json_extract(p.data,'$.type') IN ('tool','text','reasoning')
        ORDER BY p.time_created ASC LIMIT 200
      `).all();
      parts = rows.map(mapPart);
    }

    const latest = db.prepare(`SELECT MAX(CAST(time_created AS INTEGER)) as ts FROM part`).get();
    db.close();

    // Enrich sessions with clause project names (overrides raw opencode worktree label)
    const projectMap = buildProjectMap();
    for (const s of sessions) {
      const key = normPath(s.project_worktree);
      const match = key ? projectMap.get(key) : null;
      s.clause_project_name = match ? match.name : null;
      s.clause_project_id   = match ? match.id   : null;
    }

    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({
      sessions,
      previousSessions: [],
      parts,
      toolSummary: [],
      latestTs: latest?.ts || Date.now(),
      serverTime: Date.now(),
    }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(err), sessions: [], previousSessions: [], parts: [], toolSummary: [] }));
  }
};

function mapPart(p) {
  let parsed = {};
  try { parsed = JSON.parse(p.data); } catch {}
  return {
    id: p.id, session_id: p.session_id, time_created: p.time_created,
    type: p.type, agent: p.agent, model_id: p.model_id,
    session_title: p.session_title, parent_id: p.parent_id,
    text:        parsed.text || null,
    tool:        parsed.tool || null,
    tool_status: parsed.state?.status || null,
    tool_input:  parsed.state?.input  ? JSON.stringify(parsed.state.input).substring(0, 400) : null,
    tool_output: parsed.state?.output ? String(parsed.state.output).substring(0, 600) : null,
  };
}
