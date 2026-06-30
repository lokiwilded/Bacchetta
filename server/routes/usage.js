'use strict';

const path = require('node:path');
const Database = require('better-sqlite3');

// Per-million-token pricing for common models (input, output)
const PRICING = {
  'claude-opus-4':     { in: 15,   out: 75  },
  'claude-opus-3-5':   { in: 15,   out: 75  },
  'claude-sonnet-4':   { in: 3,    out: 15  },
  'claude-sonnet-3-5': { in: 3,    out: 15  },
  'claude-haiku-4':    { in: 0.8,  out: 4   },
  'claude-haiku-3-5':  { in: 0.8,  out: 4   },
  'gpt-4o':            { in: 2.5,  out: 10  },
  'gpt-4o-mini':       { in: 0.15, out: 0.6 },
  'gpt-4-turbo':       { in: 10,   out: 30  },
  'o1':                { in: 15,   out: 60  },
  'o1-mini':           { in: 3,    out: 12  },
  'gemini-1.5-pro':    { in: 1.25, out: 5   },
  'gemini-1.5-flash':  { in: 0.075,out: 0.3 },
};

// Fallback "premium" rate for savings comparison — equivalent to Claude Opus
const OPUS_RATE = { in: 15, out: 75 };

function modelCost(modelId, i, o) {
  const id = (modelId || '').toLowerCase();
  for (const [key, rate] of Object.entries(PRICING)) {
    if (id.includes(key)) return ((i || 0) / 1e6 * rate.in) + ((o || 0) / 1e6 * rate.out);
  }
  return null;
}

function opusCost(i, o) {
  return ((i || 0) / 1e6 * OPUS_RATE.in) + ((o || 0) / 1e6 * OPUS_RATE.out);
}

module.exports.handler = async function handler(_req, res, _url, ctx) {
  try {
    const db = new Database(path.join(ctx.dataDir, 'opencode.db'), { readonly: true });

    const byAgent = db.prepare(`
      SELECT COALESCE(agent,'unknown') as agent, json_extract(model,'$.id') as model_id,
        COUNT(*) as sessions, SUM(tokens_input) as input_tokens,
        SUM(tokens_output) as output_tokens, SUM(tokens_cache_read) as cache_read,
        SUM(cost) as actual_cost
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
        SUM(tokens_input) as input_tokens, SUM(tokens_output) as output_tokens,
        SUM(tokens_cache_read) as cache_read
      FROM session WHERE tokens_input > 0 OR tokens_output > 0
      GROUP BY day ORDER BY day DESC LIMIT 30
    `).all();

    const sessionTimes = db.prepare(`
      SELECT s.id, COALESCE(s.agent,'unknown') as agent, json_extract(s.model,'$.id') as model_id,
        MIN((MAX(p.time_created)-MIN(p.time_created))/1000.0, 14400) as active_secs
      FROM session s JOIN part p ON p.session_id = s.id
      WHERE s.tokens_input > 0 OR s.tokens_output > 0
      GROUP BY s.id
    `).all();

    const totals = db.prepare(`
      SELECT COUNT(*) as total_sessions, COUNT(DISTINCT COALESCE(agent,'unknown')) as total_agents,
        COUNT(DISTINCT json_extract(model,'$.id')) as total_models,
        SUM(tokens_input) as total_input, SUM(tokens_output) as total_output,
        SUM(tokens_cache_read) as total_cache_read, SUM(cost) as total_actual_cost,
        COUNT(DISTINCT date(time_created/1000,'unixepoch')) as active_days,
        MIN(date(time_created/1000,'unixepoch')) as first_day,
        MAX(date(time_created/1000,'unixepoch')) as last_day
      FROM session WHERE tokens_input > 0 OR tokens_output > 0
    `).get();

    const topSessions = db.prepare(`
      SELECT s.id, s.title, COALESCE(s.agent,'unknown') as agent,
        json_extract(s.model,'$.id') as model_id, s.tokens_input, s.tokens_output,
        date(s.time_created/1000,'unixepoch') as day
      FROM session s WHERE s.tokens_input > 0
      ORDER BY s.tokens_input+s.tokens_output DESC LIMIT 15
    `).all();

    db.close();

    const activeByAgent = {};
    for (const r of sessionTimes) {
      const k = `${r.agent}|||${r.model_id}`;
      activeByAgent[k] = (activeByAgent[k] || 0) + (r.active_secs || 0);
    }
    const totalActive = sessionTimes.reduce((s, r) => s + (r.active_secs || 0), 0);
    const totalOpusCost = opusCost(totals?.total_input, totals?.total_output);

    const data = {
      byAgent: byAgent.map(a => ({
        ...a,
        active_secs: Math.round(activeByAgent[`${a.agent}|||${a.model_id}`] || 0),
        opus_cost:   opusCost(a.input_tokens, a.output_tokens),
        model_cost:  modelCost(a.model_id, a.input_tokens, a.output_tokens),
      })),
      byModel: byModel.map(m => ({
        ...m,
        opus_cost:  opusCost(m.input_tokens, m.output_tokens),
        model_cost: modelCost(m.model_id, m.input_tokens, m.output_tokens),
      })),
      byDay,
      totals: {
        ...totals,
        total_active_secs: Math.round(totalActive),
        total_opus_cost:   totalOpusCost,
        total_savings:     totalOpusCost - (totals?.total_actual_cost || 0),
      },
      topSessions: topSessions.map(s => ({
        ...s,
        opus_cost:  opusCost(s.tokens_input, s.tokens_output),
        model_cost: modelCost(s.model_id, s.tokens_input, s.tokens_output),
      })),
    };

    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(err) }));
  }
};
