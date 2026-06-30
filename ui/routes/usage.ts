import { Database } from "bun:sqlite"
import { join } from "path"

const OPUS_IN  = 15   // $ per M tokens
const OPUS_OUT = 75

function opusCost(i: number, o: number) {
  return ((i || 0) / 1e6 * OPUS_IN) + ((o || 0) / 1e6 * OPUS_OUT)
}

const PRICING: Record<string, { in: number; out: number }> = {
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
  'gemini-1.5-flash':  { in: 0.075, out: 0.3 },
}

function modelCost(modelId: string | null, i: number, o: number): number | null {
  const id = (modelId || '').toLowerCase()
  for (const [key, rate] of Object.entries(PRICING)) {
    if (id.includes(key)) return ((i || 0) / 1e6 * rate.in) + ((o || 0) / 1e6 * rate.out)
  }
  return null
}

export async function handler(_req: Request, ctx: { dataDir: string }) {
  try {
    const db = new Database(join(ctx.dataDir, "opencode.db"), { readonly: true })

    const byAgent: any[] = db.query(`
      SELECT COALESCE(agent,'unknown') as agent, json_extract(model,'$.id') as model_id,
        COUNT(*) as sessions, SUM(tokens_input) as input_tokens,
        SUM(tokens_output) as output_tokens, SUM(tokens_cache_read) as cache_read, SUM(cost) as actual_cost
      FROM session WHERE tokens_input > 0 OR tokens_output > 0
      GROUP BY agent, json_extract(model,'$.id')
      ORDER BY (SUM(tokens_input)+SUM(tokens_output)) DESC
    `).all()

    const byModel: any[] = db.query(`
      SELECT json_extract(model,'$.id') as model_id, COUNT(*) as sessions,
        SUM(tokens_input) as input_tokens, SUM(tokens_output) as output_tokens,
        SUM(tokens_cache_read) as cache_read
      FROM session WHERE tokens_input > 0 OR tokens_output > 0
      GROUP BY json_extract(model,'$.id')
      ORDER BY (SUM(tokens_input)+SUM(tokens_output)) DESC
    `).all()

    const byDay: any[] = db.query(`
      SELECT date(time_created/1000,'unixepoch') as day, COUNT(*) as sessions,
        SUM(tokens_input) as input_tokens, SUM(tokens_output) as output_tokens,
        SUM(tokens_cache_read) as cache_read
      FROM session WHERE tokens_input > 0 OR tokens_output > 0
      GROUP BY day ORDER BY day DESC LIMIT 30
    `).all()

    const sessionTimes: any[] = db.query(`
      SELECT s.id, COALESCE(s.agent,'unknown') as agent, json_extract(s.model,'$.id') as model_id,
        MIN((MAX(p.time_created)-MIN(p.time_created))/1000.0, 14400) as active_secs
      FROM session s JOIN part p ON p.session_id = s.id
      WHERE s.tokens_input > 0 OR s.tokens_output > 0
      GROUP BY s.id
    `).all()

    const totals: any = db.query(`
      SELECT COUNT(*) as total_sessions, COUNT(DISTINCT COALESCE(agent,'unknown')) as total_agents,
        COUNT(DISTINCT json_extract(model,'$.id')) as total_models,
        SUM(tokens_input) as total_input, SUM(tokens_output) as total_output,
        SUM(tokens_cache_read) as total_cache_read, SUM(cost) as total_actual_cost,
        COUNT(DISTINCT date(time_created/1000,'unixepoch')) as active_days,
        MIN(date(time_created/1000,'unixepoch')) as first_day,
        MAX(date(time_created/1000,'unixepoch')) as last_day
      FROM session WHERE tokens_input > 0 OR tokens_output > 0
    `).get()

    const topSessions: any[] = db.query(`
      SELECT s.id, s.title, COALESCE(s.agent,'unknown') as agent,
        json_extract(s.model,'$.id') as model_id, s.tokens_input, s.tokens_output,
        date(s.time_created/1000,'unixepoch') as day
      FROM session s WHERE s.tokens_input > 0
      ORDER BY s.tokens_input+s.tokens_output DESC LIMIT 15
    `).all()

    db.close()

    const activeByAgent: Record<string, number> = {}
    for (const r of sessionTimes) {
      const k = `${r.agent}|||${r.model_id}`
      activeByAgent[k] = (activeByAgent[k] || 0) + (r.active_secs || 0)
    }
    const totalActive = sessionTimes.reduce((s, r) => s + (r.active_secs || 0), 0)
    const totalOpusCost = opusCost(totals?.total_input, totals?.total_output)

    return Response.json({
      byAgent: byAgent.map(a => ({
        ...a,
        active_secs: Math.round(activeByAgent[`${a.agent}|||${a.model_id}`] || 0),
        opus_cost: opusCost(a.input_tokens, a.output_tokens),
        model_cost: modelCost(a.model_id, a.input_tokens, a.output_tokens),
      })),
      byModel: byModel.map(m => ({ ...m, opus_cost: opusCost(m.input_tokens, m.output_tokens), model_cost: modelCost(m.model_id, m.input_tokens, m.output_tokens) })),
      byDay,
      totals: {
        ...totals,
        total_active_secs: Math.round(totalActive),
        total_opus_cost: totalOpusCost,
        total_savings: totalOpusCost - (totals?.total_actual_cost || 0),
      },
      topSessions: topSessions.map(s => ({ ...s, opus_cost: opusCost(s.tokens_input, s.tokens_output), model_cost: modelCost(s.model_id, s.tokens_input, s.tokens_output) })),
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
