import { Database } from "bun:sqlite"
import { join } from "path"

const OPUS_IN  = 15   // $ per M tokens
const OPUS_OUT = 75

function opusCost(i: number, o: number) {
  return ((i || 0) / 1e6 * OPUS_IN) + ((o || 0) / 1e6 * OPUS_OUT)
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
      })),
      byModel: byModel.map(m => ({ ...m, opus_cost: opusCost(m.input_tokens, m.output_tokens) })),
      byDay,
      totals: {
        ...totals,
        total_active_secs: Math.round(totalActive),
        total_opus_cost: totalOpusCost,
        total_savings: totalOpusCost - (totals?.total_actual_cost || 0),
      },
      topSessions: topSessions.map(s => ({ ...s, opus_cost: opusCost(s.tokens_input, s.tokens_output) })),
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
