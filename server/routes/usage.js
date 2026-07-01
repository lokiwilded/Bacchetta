'use strict';

const path = require('node:path');
const Database = require('better-sqlite3');

const OPUS_RATE   = { in: 15,  out: 75 };  // USD per million tokens
const OLLAMA_GBP  = 15;                     // £/month Ollama Cloud subscription
const GBP_PER_USD = 0.79;

function opusCost(i, o) { return ((i||0)/1e6*OPUS_RATE.in) + ((o||0)/1e6*OPUS_RATE.out); }
function toGbp(usd)     { return usd * GBP_PER_USD; }

// Classify a model ID into opus / sonnet / haiku bucket.
function modelTier(modelId) {
  if (!modelId) return 'sonnet';
  const m = modelId.toLowerCase();
  if (
    m.includes('opus') || m.includes(':ultra') || m.includes('-ultra') ||
    m.includes('deepseek-v4') || m.includes('deepseek-r1') || m.includes(':r1') ||
    m.includes('kimi-k2') || m.includes('2.5-pro') ||
    (m.includes('-pro') && m.includes(':cloud')) ||
    m.includes('70b') || m.includes('72b') || m.includes('405b')
  ) return 'opus';
  if (
    m.includes('haiku') || m.includes('flash') || m.includes('mini') ||
    m.includes('turbo') || m.includes('lite') || m.includes('minimax') ||
    m.includes('1b') || m.includes('3b') || m.includes('7b') || m.includes('8b')
  ) return 'haiku';
  return 'sonnet';
}

module.exports.handler = async function handler(_req, res, _url, ctx) {
  try {
    const db = new Database(path.join(ctx.dataDir, 'opencode.db'), { readonly: true });

    const byAgent = db.prepare(`
      SELECT COALESCE(agent,'unknown') as agent, json_extract(model,'$.id') as model_id,
        COUNT(*) as sessions, SUM(tokens_input) as input_tokens,
        SUM(tokens_output) as output_tokens, SUM(tokens_cache_read) as cache_read
      FROM session WHERE tokens_input > 0 OR tokens_output > 0
      GROUP BY agent, json_extract(model,'$.id')
      ORDER BY (SUM(tokens_input)+SUM(tokens_output)) DESC
    `).all();

    const byModel = db.prepare(`
      SELECT json_extract(model,'$.id') as model_id, COUNT(*) as sessions,
        SUM(tokens_input) as input_tokens, SUM(tokens_output) as output_tokens,
        SUM(tokens_cache_read) as cache_read
      FROM session WHERE tokens_input > 0 OR tokens_output > 0
      GROUP BY json_extract(model,'$.id')
      ORDER BY (SUM(tokens_input)+SUM(tokens_output)) DESC
    `).all();

    const byDay = db.prepare(`
      SELECT date(time_created/1000,'unixepoch') as day, COUNT(*) as sessions,
        SUM(tokens_input) as input_tokens, SUM(tokens_output) as output_tokens
      FROM session WHERE tokens_input > 0 OR tokens_output > 0
      GROUP BY day ORDER BY day DESC LIMIT 30
    `).all();

    const byProject = db.prepare(`
      SELECT pr.worktree, pr.id as project_id,
        COUNT(s.id) as sessions,
        SUM(s.tokens_input) as input_tokens,
        SUM(s.tokens_output) as output_tokens,
        SUM(s.tokens_cache_read) as cache_read,
        MAX(s.time_updated) as last_active
      FROM project pr
      JOIN session s ON s.project_id = pr.id
      WHERE s.tokens_input > 0 OR s.tokens_output > 0
      GROUP BY pr.id
      ORDER BY (SUM(s.tokens_input)+SUM(s.tokens_output)) DESC
      LIMIT 20
    `).all();

    const topSessionsRaw = db.prepare(`
      SELECT s.id, s.title, COALESCE(s.agent,'unknown') as agent,
        json_extract(s.model,'$.id') as model_id,
        s.tokens_input, s.tokens_output, s.project_id,
        date(s.time_created/1000,'unixepoch') as day
      FROM session s
      WHERE s.tokens_input > 0
      ORDER BY s.tokens_input+s.tokens_output DESC
      LIMIT 200
    `).all();

    // Active time = sum of gaps between consecutive parts where gap <= 5 min.
    const sessionTimes = db.prepare(`
      SELECT s.id, json_extract(s.model,'$.id') as model_id,
        COALESCE(gaps.active_secs, 0) as active_secs
      FROM session s
      LEFT JOIN (
        SELECT session_id,
          SUM(CASE WHEN gap_secs > 0 AND gap_secs <= 300 THEN gap_secs ELSE 0 END) as active_secs
        FROM (
          SELECT session_id,
            (time_created - LAG(time_created, 1, time_created) OVER (
              PARTITION BY session_id ORDER BY time_created
            )) / 1000.0 AS gap_secs
          FROM part
        )
        GROUP BY session_id
      ) gaps ON gaps.session_id = s.id
      WHERE s.tokens_input > 0 OR s.tokens_output > 0
    `).all();

    const totals = db.prepare(`
      SELECT COUNT(*) as total_sessions,
        COUNT(DISTINCT COALESCE(agent,'unknown')) as total_agents,
        COUNT(DISTINCT json_extract(model,'$.id')) as total_models,
        SUM(tokens_input) as total_input, SUM(tokens_output) as total_output,
        SUM(tokens_cache_read) as total_cache_read,
        COUNT(DISTINCT date(time_created/1000,'unixepoch')) as active_days,
        MIN(date(time_created/1000,'unixepoch')) as first_day,
        MAX(date(time_created/1000,'unixepoch')) as last_day
      FROM session WHERE tokens_input>0 OR tokens_output>0
    `).get();

    db.close();

    // Aggregate active time
    const activeById = {};
    let totalActive = 0;
    for (const r of sessionTimes) {
      const secs = r.active_secs || 0;
      activeById[r.id] = secs;
      totalActive += secs;
    }

    const totalIn  = totals?.total_input  || 0;
    const totalOut = totals?.total_output || 0;
    const totalOpusGbp = toGbp(opusCost(totalIn, totalOut));

    const firstDay   = totals?.first_day ? new Date(totals.first_day) : new Date();
    const lastDay    = totals?.last_day  ? new Date(totals.last_day)  : new Date();
    const daysOfData = Math.max(1, Math.round((lastDay - firstDay) / 86400000) + 1);
    const ollamaCost = (daysOfData / 30) * OLLAMA_GBP;

    // Group sessions by project for detail rows
    const byProjMap = {};
    for (const s of topSessionsRaw) {
      if (!byProjMap[s.project_id]) byProjMap[s.project_id] = [];
      byProjMap[s.project_id].push({
        id:            s.id,
        title:         s.title,
        agent:         s.agent,
        model_id:      s.model_id,
        input_tokens:  s.tokens_input,
        output_tokens: s.tokens_output,
        day:           s.day,
        active_secs:   Math.round(activeById[s.id] || 0),
        opus_cost_gbp: toGbp(opusCost(s.tokens_input, s.tokens_output)),
      });
    }

    const data = {
      byAgent: byAgent.map(a => ({
        ...a,
        opus_cost_gbp: toGbp(opusCost(a.input_tokens, a.output_tokens)),
      })),
      byModel: byModel.map(m => ({
        ...m,
        opus_cost_gbp: toGbp(opusCost(m.input_tokens, m.output_tokens)),
      })),
      byDay: [...byDay].reverse(),
      byProject: byProject.map(p => ({
        ...p,
        opus_cost_gbp:   toGbp(opusCost(p.input_tokens, p.output_tokens)),
        sessions_detail: (byProjMap[p.project_id] || []).slice(0, 10),
      })),
      totals: {
        ...totals,
        total_active_secs:     Math.round(totalActive),
        total_opus_cost_gbp:   totalOpusGbp,
        estimated_ollama_cost: ollamaCost,
        days_of_data:          daysOfData,
      },
    };

    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(err) }));
  }
};
