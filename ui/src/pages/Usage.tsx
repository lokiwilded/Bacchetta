import { useEffect, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts'
import { api } from '../api'
import type { UsageData } from '../types'
import { fmt, usd, hrs, agentColor, shortModel } from '../utils'

interface Props { onStatus: (msg: string, ok?: boolean) => void }

export default function Usage({ onStatus }: Props) {
  const [data, setData] = useState<UsageData | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    setData(null)
    api.usage()
      .then(d => { setData(d); onStatus('Updated ' + new Date().toLocaleTimeString()) })
      .catch(e => onStatus(String(e), false))
  }, [refreshKey])

  if (!data) return <div className="flex items-center justify-center h-full text-muted text-sm">Loading…</div>
  if (data.error) return <div className="p-4 text-red text-sm">{data.error}</div>

  const t = data.totals
  const days = [...(data.byDay ?? [])].reverse()
  const agentPie = (data.byAgent ?? [])
    .filter(a => (a.input_tokens ?? 0) + (a.output_tokens ?? 0) > 0)
    .slice(0, 8)

  return (
    <div className="p-4 pb-24 md:pb-6 flex flex-col gap-4">

      {/* Page header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-base font-bold">Usage & Savings</h1>
          <p className="text-xs text-muted mt-0.5">vs Claude Opus 4.8 · $15/M input · $75/M output</p>
        </div>
        <button
          onClick={() => setRefreshKey(k => k + 1)}
          className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold bg-s2 border border-bdr text-muted2 hover:text-slate-200 hover:border-accent/40 transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Hero */}
      <div className="rounded-xl border border-green/20 bg-green/5 p-4 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-4xl font-extrabold text-green leading-none">{usd(t.total_savings)}</div>
          <div className="text-sm text-muted2 mt-1.5">Saved using Ollama Cloud (free)</div>
          <div className="text-xs text-muted mt-1">
            {fmt(t.total_input)} in · {fmt(t.total_output)} out · {hrs(t.total_active_secs)} active
          </div>
        </div>
        <div className="text-right">
          <div className="text-xl font-bold text-muted2">{usd(t.total_opus_cost)}</div>
          <div className="text-xs text-muted mt-1">Opus 4.8 equivalent</div>
        </div>
      </div>

      {/* Stat grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: 'Input Tokens',  value: fmt(t.total_input) },
          { label: 'Output Tokens', value: fmt(t.total_output) },
          { label: 'Active Time',   value: hrs(t.total_active_secs) },
          { label: 'Sessions',      value: String(t.total_sessions ?? 0) },
          { label: 'Active Days',   value: String(t.active_days ?? 0) },
          { label: 'Agents',        value: String(t.total_agents ?? 0) },
          { label: 'Models',        value: String(t.total_models ?? 0) },
          { label: 'Cache Reads',   value: fmt(t.total_cache_read) },
        ].map(s => (
          <div key={s.label} className="bg-s2 border border-bdr rounded-lg p-3">
            <div className="text-[11px] text-muted mb-1.5">{s.label}</div>
            <div className="text-xl font-bold leading-none">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

        {/* Daily bar */}
        <div className="bg-s1 border border-bdr rounded-xl p-4">
          <div className="text-xs font-semibold text-muted2 mb-3">Daily Tokens (30d)</div>
          {days.length === 0
            ? <div className="text-xs text-muted text-center py-8">No data</div>
            : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={days} margin={{ top: 0, right: 0, left: -30, bottom: 0 }}>
                  <XAxis dataKey="day" tick={{ fontSize: 9, fill: '#64748b' }} tickFormatter={d => d.slice(5)} />
                  <YAxis tick={{ fontSize: 9, fill: '#64748b' }} tickFormatter={v => fmt(v)} />
                  <Tooltip
                    contentStyle={{ background: '#0f1118', border: '1px solid #1e2235', borderRadius: 8, fontSize: 11 }}
                    formatter={(v: number) => fmt(v)}
                  />
                  <Bar dataKey="input_tokens"  fill="#6366f1" name="Input"  radius={[3,3,0,0]} />
                  <Bar dataKey="output_tokens" fill="#10b981" name="Output" radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
        </div>

        {/* By agent donut */}
        <div className="bg-s1 border border-bdr rounded-xl p-4">
          <div className="text-xs font-semibold text-muted2 mb-3">By Agent</div>
          {agentPie.length === 0
            ? <div className="text-xs text-muted text-center py-8">No data</div>
            : (
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie
                    data={agentPie}
                    dataKey="input_tokens"
                    nameKey="agent"
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={70}
                    strokeWidth={0}
                  >
                    {agentPie.map(a => (
                      <Cell key={a.agent} fill={agentColor(a.agent)} />
                    ))}
                  </Pie>
                  <Legend
                    iconSize={8}
                    formatter={(v: string) => <span style={{ fontSize: 10, color: '#94a3b8' }}>{v}</span>}
                  />
                  <Tooltip
                    contentStyle={{ background: '#0f1118', border: '1px solid #1e2235', borderRadius: 8, fontSize: 11 }}
                    formatter={(v: number) => fmt(v)}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
        </div>
      </div>

      {/* Model table */}
      <div className="bg-s1 border border-bdr rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-bdr text-xs font-semibold text-muted2">By Model</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted border-b border-bdr">
                {['Model', 'Input', 'Output', 'Sessions', 'Opus equiv'].map(h => (
                  <th key={h} className="text-left px-4 py-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data.byModel ?? []).map(m => (
                <tr key={m.model_id} className="border-b border-bdr/50 last:border-0">
                  <td className="px-4 py-2 text-cyan font-mono">{shortModel(m.model_id)}</td>
                  <td className="px-4 py-2 text-muted2">{fmt(m.input_tokens)}</td>
                  <td className="px-4 py-2 text-muted2">{fmt(m.output_tokens)}</td>
                  <td className="px-4 py-2 text-green">{m.sessions}</td>
                  <td className="px-4 py-2 text-amber">{usd(m.opus_cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(data.byModel ?? []).length === 0 && (
            <div className="text-muted text-xs text-center py-6">No data</div>
          )}
        </div>
      </div>

      {/* Top sessions */}
      {(data.topSessions ?? []).length > 0 && (
        <div className="bg-s1 border border-bdr rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-bdr text-xs font-semibold text-muted2">Heaviest Sessions</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted border-b border-bdr">
                  {['Session', 'Agent', 'Input', 'Output', 'Date'].map(h => (
                    <th key={h} className="text-left px-4 py-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.topSessions.map(s => (
                  <tr key={s.id} className="border-b border-bdr/50 last:border-0">
                    <td className="px-4 py-2 text-slate-200 max-w-[140px] truncate">{s.title || '(untitled)'}</td>
                    <td className="px-4 py-2" style={{ color: agentColor(s.agent) }}>{s.agent}</td>
                    <td className="px-4 py-2 text-muted2">{fmt(s.tokens_input)}</td>
                    <td className="px-4 py-2 text-muted2">{fmt(s.tokens_output)}</td>
                    <td className="px-4 py-2 text-muted">{s.day}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
