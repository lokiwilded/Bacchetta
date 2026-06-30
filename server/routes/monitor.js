'use strict';

const path     = require('node:path');
const Database = require('better-sqlite3');

module.exports.handler = async function handler(_req, res, url, ctx) {
  try {
    const sessionId  = url.searchParams.get('session')  || null;
    const worktree   = url.searchParams.get('worktree') || null;
    const history    = url.searchParams.get('history')  === '1';
    const sinceParam = url.searchParams.get('since');
    const sinceTs    = sinceParam ? parseInt(sinceParam, 10) : Date.now() - 3_600_000;
    const order      = url.searchParams.get('order') === 'asc' ? 'ASC' : 'DESC';
    const limit      = 120;

    const db = new Database(path.join(ctx.dataDir, 'opencode.db'), { readonly: true });

    const wtJoin = worktree ? `JOIN project pr ON pr.id = s.project_id` : '';

    const sessionsStmt = worktree
      ? db.prepare(`
          SELECT s.id, s.parent_id, COALESCE(s.agent,'unknown') as agent,
            json_extract(s.model,'$.id') as model_id, s.title,
            CAST(COALESCE(s.tokens_input,0)  AS INTEGER) as tokens_input,
            CAST(COALESCE(s.tokens_output,0) AS INTEGER) as tokens_output,
            CAST(s.time_created AS INTEGER) as time_created,
            CAST(s.time_updated AS INTEGER) as time_updated,
            CASE WHEN CAST(s.time_updated AS INTEGER) > (unixepoch('now')*1000 - 120000) THEN 1 ELSE 0 END as is_active,
            CAST((CAST(s.time_updated AS INTEGER) - CAST(s.time_created AS INTEGER)) / 1000 AS INTEGER) as time_active_secs
          FROM session s JOIN project pr ON pr.id = s.project_id
          WHERE CAST(s.time_created AS INTEGER) > (unixepoch('now')*1000 - 86400000)
            AND pr.worktree = ?
          ORDER BY s.time_created DESC LIMIT 80
        `)
      : db.prepare(`
          SELECT s.id, s.parent_id, COALESCE(s.agent,'unknown') as agent,
            json_extract(s.model,'$.id') as model_id, s.title,
            CAST(COALESCE(s.tokens_input,0)  AS INTEGER) as tokens_input,
            CAST(COALESCE(s.tokens_output,0) AS INTEGER) as tokens_output,
            CAST(s.time_created AS INTEGER) as time_created,
            CAST(s.time_updated AS INTEGER) as time_updated,
            CASE WHEN CAST(s.time_updated AS INTEGER) > (unixepoch('now')*1000 - 120000) THEN 1 ELSE 0 END as is_active,
            CAST((CAST(s.time_updated AS INTEGER) - CAST(s.time_created AS INTEGER)) / 1000 AS INTEGER) as time_active_secs
          FROM session s
          WHERE CAST(s.time_created AS INTEGER) > (unixepoch('now')*1000 - 86400000)
          ORDER BY s.time_created DESC LIMIT 80
        `);
    const sessions = worktree ? sessionsStmt.all(worktree) : sessionsStmt.all();

    let previousSessions = [];
    if (history) {
      previousSessions = worktree
        ? db.prepare(`
            SELECT s.id, s.parent_id, COALESCE(s.agent,'unknown') as agent,
              json_extract(s.model,'$.id') as model_id, s.title,
              CAST(COALESCE(s.tokens_input,0)  AS INTEGER) as tokens_input,
              CAST(COALESCE(s.tokens_output,0) AS INTEGER) as tokens_output,
              CAST(s.time_created AS INTEGER) as time_created,
              CAST(s.time_updated AS INTEGER) as time_updated,
              0 as is_active,
              CAST((CAST(s.time_updated AS INTEGER) - CAST(s.time_created AS INTEGER)) / 1000 AS INTEGER) as time_active_secs
            FROM session s JOIN project pr ON pr.id = s.project_id
            WHERE CAST(s.time_created AS INTEGER) > (unixepoch('now')*1000 - 2592000000)
              AND CAST(s.time_updated AS INTEGER) < (unixepoch('now')*1000 - 120000)
              AND s.parent_id IS NULL
              AND pr.worktree = ?
            ORDER BY s.time_created DESC LIMIT 200
          `).all(worktree)
        : db.prepare(`
            SELECT s.id, s.parent_id, COALESCE(s.agent,'unknown') as agent,
              json_extract(s.model,'$.id') as model_id, s.title,
              CAST(COALESCE(s.tokens_input,0)  AS INTEGER) as tokens_input,
              CAST(COALESCE(s.tokens_output,0) AS INTEGER) as tokens_output,
              CAST(s.time_created AS INTEGER) as time_created,
              CAST(s.time_updated AS INTEGER) as time_updated,
              0 as is_active,
              CAST((CAST(s.time_updated AS INTEGER) - CAST(s.time_created AS INTEGER)) / 1000 AS INTEGER) as time_active_secs
            FROM session s
            WHERE CAST(s.time_created AS INTEGER) > (unixepoch('now')*1000 - 2592000000)
              AND CAST(s.time_updated AS INTEGER) < (unixepoch('now')*1000 - 120000)
              AND s.parent_id IS NULL
            ORDER BY s.time_created DESC LIMIT 200
          `).all();
    }

    let rows;
    if (sessionId) {
      rows = db.prepare(`
        SELECT p.id, p.session_id, CAST(p.time_created AS INTEGER) as time_created,
          json_extract(p.data,'$.type') as type, p.data,
          COALESCE(s.agent,'unknown') as agent,
          json_extract(s.model,'$.id') as model_id, s.title as session_title, s.parent_id
        FROM part p JOIN session s ON s.id = p.session_id
        WHERE CAST(p.time_created AS INTEGER) > ?
          AND p.session_id = ?
          AND json_extract(p.data,'$.type') IN ('tool','text','reasoning')
        ORDER BY p.time_created ${order} LIMIT ${limit}
      `).all(sinceTs, sessionId);
    } else if (worktree) {
      rows = db.prepare(`
        SELECT p.id, p.session_id, CAST(p.time_created AS INTEGER) as time_created,
          json_extract(p.data,'$.type') as type, p.data,
          COALESCE(s.agent,'unknown') as agent,
          json_extract(s.model,'$.id') as model_id, s.title as session_title, s.parent_id
        FROM part p JOIN session s ON s.id = p.session_id
          JOIN project pr2 ON pr2.id = s.project_id
        WHERE CAST(p.time_created AS INTEGER) > ?
          AND pr2.worktree = ?
          AND json_extract(p.data,'$.type') IN ('tool','text','reasoning')
        ORDER BY p.time_created ${order} LIMIT ${limit}
      `).all(sinceTs, worktree);
    } else {
      rows = db.prepare(`
        SELECT p.id, p.session_id, CAST(p.time_created AS INTEGER) as time_created,
          json_extract(p.data,'$.type') as type, p.data,
          COALESCE(s.agent,'unknown') as agent,
          json_extract(s.model,'$.id') as model_id, s.title as session_title, s.parent_id
        FROM part p JOIN session s ON s.id = p.session_id
        WHERE CAST(p.time_created AS INTEGER) > ?
          AND json_extract(p.data,'$.type') IN ('tool','text','reasoning')
        ORDER BY p.time_created ${order} LIMIT ${limit}
      `).all(sinceTs);
    }

    const parts = rows.map(p => {
      let parsed = {};
      try { parsed = JSON.parse(p.data); } catch {}
      return {
        id: p.id, session_id: p.session_id, time_created: p.time_created,
        type: p.type, agent: p.agent, model_id: p.model_id,
        session_title: p.session_title, parent_id: p.parent_id,
        text:        parsed.text || null,
        tool:        parsed.tool || null,
        tool_status: parsed.state?.status || null,
        tool_input:  parsed.state?.input  ? JSON.stringify(parsed.state.input).substring(0, 300) : null,
        tool_output: parsed.state?.output ? String(parsed.state.output).substring(0, 500) : null,
      };
    });

    let toolSummary = [];
    try {
      toolSummary = db.prepare(`
        SELECT json_extract(p.data,'$.tool') as tool,
          CAST(json_extract(p.data,'$.state.status') AS TEXT) as status,
          COUNT(*) as cnt, COALESCE(s.agent,'unknown') as agent
        FROM part p JOIN session s ON s.id = p.session_id
        WHERE json_extract(p.data,'$.type') = 'tool'
          AND CAST(p.time_created AS INTEGER) > (unixepoch('now')*1000 - 3600000)
        GROUP BY json_extract(p.data,'$.tool'), CAST(json_extract(p.data,'$.state.status') AS TEXT), s.agent
        ORDER BY cnt DESC LIMIT 30
      `).all();
    } catch {}

    const latest = db.prepare(`SELECT MAX(CAST(time_created AS INTEGER)) as ts FROM part`).get();
    db.close();

    const data = { sessions, previousSessions, parts, toolSummary, latestTs: latest?.ts || Date.now(), serverTime: Date.now() };
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(err), sessions: [], previousSessions: [], parts: [], toolSummary: [] }));
  }
};
