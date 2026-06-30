'use strict';

const path = require('node:path');
const Database = require('better-sqlite3');

const OPUS_RATE   = { in: 15,  out: 75 };  // USD per million tokens
const OLLAMA_GBP  = 15;                     // £/month Ollama Cloud subscription
const GBP_PER_USD = 0.79;

// Comparison API rates (USD per million tokens)
const COMPARE = {
  'Claude Opus 4.8': { in: 15,   out: 75,  color: '#f59e0b' },
  'Claude Sonnet 4': { in: 3,    out: 15,  color: '#6366f1' },
  'Gemini 1.5 Pro':  { in: 1.25, out: 5,   color: '#22d3ee' },
  'GPT-4o':          { in: 2.5,  out: 10,  color: '#10b981' },
};

// Subscription prices £/month
const SUBSCRIPTIONS = {
  'Claude Pro':    18,
  'Google One AI': 19,
  'ChatGPT Plus':  16,
};

function opusCost(i, o)       { return ((i||0)/1e6*OPUS_RATE.in) + ((o||0)/1e6*OPUS_RATE.out); }
function apiCost(rate, i, o)  { return ((i||0)/1e6*rate.in)      + ((o||0)/1e6*rate.out); }
function toGbp(usd)           { return usd * GBP_PER_USD; }

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

    const sessionTimes = db.prepare(`
      SELECT s.id,
        MIN((MAX(p.time_created)-MIN(p.time_created))/1000.0,14400) as active_secs
      FROM session s JOIN part p ON p.session_id=s.id
      WHERE s.tokens_input>0 OR s.tokens_output>0
      GROUP BY s.id
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

    const activeById = {};
    let totalActive = 0;
    for (const r of sessionTimes) {
      activeById[r.id] = r.active_secs || 0;
      totalActive += r.active_secs || 0;
    }

    const totalIn  = totals?.total_input  || 0;
    const totalOut = totals?.total_output || 0;
    const totalOpusUsd = opusCost(totalIn, totalOut);
    const totalOpusGbp = toGbp(totalOpusUsd);

    const firstDay   = totals?.first_day ? new Date(totals.first_day) : new Date();
    const lastDay    = totals?.last_day  ? new Date(totals.last_day)  : new Date();
    const daysOfData = Math.max(1, Math.round((lastDay - firstDay) / 86400000) + 1);
    const ollamaCost = (daysOfData / 30) * OLLAMA_GBP;

    // Group sessions by project
    const byProjMap = {};
    for (const s of topSessionsRaw) {
      if (!byProjMap[s.project_id]) byProjMap[s.project_id] = [];
      byProjMap[s.project_id].push({
        id:          s.id,
        title:       s.title,
        agent:       s.agent,
        model_id:    s.model_id,
        input_tokens:  s.tokens_input,
        output_tokens: s.tokens_output,
        day:         s.day,
        active_secs: Math.round(activeById[s.id] || 0),
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
        savings_gbp:           totalOpusGbp - ollamaCost,
        days_of_data:          daysOfData,
      },
      comparisons: Object.entries(COMPARE).map(([name, rate]) => {
        const costUsd = apiCost(rate, totalIn, totalOut);
        return {
          name,
          color:       rate.color,
          cost_gbp:    toGbp(costUsd),
          savings_gbp: toGbp(costUsd) - ollamaCost,
        };
      }),
      subscriptions: Object.entries(SUBSCRIPTIONS).map(([name, monthly]) => ({
        name,
        monthly_gbp: monthly,
        your_monthly: OLLAMA_GBP,
        you_save_monthly: monthly - OLLAMA_GBP,
      })),
      ollama_monthly_gbp: OLLAMA_GBP,
    };

    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(err) }));
  }
};
