import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { MonitorData, Session, Part } from '../types'
import { fmt, rel, agentColor } from '../utils'

interface Props { worktree: string; projectName: string }

type MainTab  = 'live' | 'previous'
type FeedTab  = 'activity' | 'tools' | 'reasoning'

function fmtDuration(secs: number): string {
  if (!secs || secs < 0) return '—'
  if (secs < 60)   return `${secs}s`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60)
  return `${h}h ${m}m`
}

function fmtDay(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function ProjectMonitor({ worktree, projectName }: Props) {
  const [mainTab, setMainTab] = useState<MainTab>('live')
  const [data, setData]       = useState<MonitorData | null>(null)
  const [histData, setHistData] = useState<Session[] | null>(null)
  const [selId, setSelId]     = useState<string | null>(null)
  const [feedTab, setFeedTab] = useState<FeedTab>('activity')
  const timer  = useRef<ReturnType<typeof setTimeout>>()
  const loaded = useRef(false)

  async function loadLive() {
    try {
      const d = await api.monitor(selId ?? undefined, worktree)
      setData(d)
    } catch {}
    timer.current = setTimeout(loadLive, 3000)
  }

  async function loadHistory() {
    if (loaded.current) return
    loaded.current = true
    try {
      const d = await api.monitor(undefined, worktree, true)
      setHistData(d.previousSessions ?? [])
    } catch { setHistData([]) }
  }

  useEffect(() => {
    loadLive()
    return () => clearTimeout(timer.current)
  }, [selId, worktree])

  useEffect(() => {
    if (mainTab === 'previous') loadHistory()
  }, [mainTab])

  const sessions  = data?.sessions ?? []
  const roots     = sessions.filter(s => !s.parent_id)
  const byParent: Record<string, Session[]> = {}
  for (const s of sessions) if (s.parent_id) (byParent[s.parent_id] ??= []).push(s)
  const active    = sessions.filter(s => s.is_active)
  const totalTok  = sessions.reduce((a, s) => a + (s.tokens_input ?? 0) + (s.tokens_output ?? 0), 0)
  const activeSecs = sessions.reduce((a, s) => a + (s.time_active_secs ?? 0), 0)

  // Group previous sessions by day
  const prevByDay: Record<string, Session[]> = {}
  for (const s of histData ?? []) {
    const day = fmtDay(s.time_created)
    ;(prevByDay[day] ??= []).push(s)
  }

  return (
    <div className="mt-3 rounded-xl border border-bdr bg-bg overflow-hidden">

      {/* Header with stats */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-bdr bg-s1 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-widest text-muted">Monitor</span>
          {active.length > 0 && (
            <span className="text-[9px] bg-green/15 text-green border border-green/30 rounded px-1.5 py-0.5 font-bold">
              {active.length} LIVE
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-[10px] text-muted2">
          {totalTok > 0 && <span>⬆ {fmt(totalTok)} tok</span>}
          {activeSecs > 0 && <span>⏱ {fmtDuration(activeSecs)}</span>}
          <span>{sessions.length} session{sessions.length !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {/* Main tab switcher */}
      <div className="flex border-b border-bdr bg-s1">
        {(['live', 'previous'] as MainTab[]).map(t => (
          <button key={t} onClick={() => setMainTab(t)}
            className={`px-4 py-2 text-[11px] font-medium capitalize transition-colors ${
              mainTab === t ? 'text-slate-200 border-b-2 border-accent -mb-px' : 'text-muted hover:text-muted2'
            }`}
          >
            {t === 'live' ? 'Live' : 'Previous'}
          </button>
        ))}
      </div>

      {/* LIVE TAB */}
      {mainTab === 'live' && (
        <>
          {sessions.length === 0 ? (
            <div className="text-xs text-muted text-center py-6">No sessions yet for {projectName}</div>
          ) : (
            <div className="flex flex-col md:flex-row min-h-0" style={{ maxHeight: 420 }}>
              {/* Session list */}
              <div className="md:w-52 flex-shrink-0 border-b md:border-b-0 md:border-r border-bdr overflow-y-auto" style={{ maxHeight: 200 }}>
                {roots.map(s => (
                  <MiniSessItem key={s.id} s={s} kids={byParent}
                    sel={selId} onSel={id => setSelId(selId === id ? null : id)} />
                ))}
              </div>

              {/* Feed */}
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                <div className="flex border-b border-bdr flex-shrink-0">
                  {(['activity', 'tools', 'reasoning'] as FeedTab[]).map(t => (
                    <button key={t} onClick={() => setFeedTab(t)}
                      className={`flex-1 py-2 text-[11px] font-medium capitalize transition-colors ${
                        feedTab === t ? 'text-slate-200 border-b-2 border-accent' : 'text-muted'
                      }`}>
                      {t}
                    </button>
                  ))}
                </div>
                <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1.5">
                  <MiniFeed data={data} tab={feedTab} />
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* PREVIOUS TAB */}
      {mainTab === 'previous' && (
        <div className="overflow-y-auto" style={{ maxHeight: 420 }}>
          {histData === null ? (
            <div className="text-xs text-muted text-center py-8">Loading…</div>
          ) : histData.length === 0 ? (
            <div className="text-xs text-muted text-center py-8">
              No previous sessions.<br />
              <span className="text-[10px] text-muted2">Sessions appear here when you close a chat.</span>
            </div>
          ) : (
            Object.entries(prevByDay).map(([day, daySessions]) => (
              <div key={day}>
                <div className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted2 bg-s1 border-b border-bdr sticky top-0">
                  {day} · {daySessions.length} session{daySessions.length !== 1 ? 's' : ''}
                </div>
                {daySessions.map(s => <PrevSessRow key={s.id} s={s} />)}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

function MiniSessItem({ s, kids, sel, onSel }: {
  s: Session; kids: Record<string, Session[]>
  sel: string | null; onSel: (id: string) => void
}) {
  const color     = agentColor(s.agent)
  const isLive    = !!s.is_active
  const isSel     = sel === s.id
  const childList = kids[s.id] ?? []
  const totalTok  = (s.tokens_input ?? 0) + (s.tokens_output ?? 0)

  return (
    <div>
      <button
        onClick={() => onSel(s.id)}
        className={`w-full text-left px-3 py-2 border-b border-bdr/40 transition-colors ${
          isSel ? 'bg-accent/10 border-l-2 border-l-accent' : isLive ? 'border-l-2 border-l-green hover:bg-s1' : 'hover:bg-s1'
        }`}
      >
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
          <span className="text-[11px] font-semibold truncate" style={{ color }}>{s.agent}</span>
          {isLive && <span className="ml-auto text-[8px] bg-green/20 text-green rounded px-1 animate-pulse">LIVE</span>}
        </div>
        <div className="text-[10px] text-muted2 mt-0.5 pl-3 truncate">{s.title || '(untitled)'}</div>
        {/* Token + time row */}
        <div className="flex items-center gap-2 pl-3 mt-1">
          <span className="text-[10px] text-cyan">↑{fmt(s.tokens_input)}</span>
          <span className="text-[10px] text-purple-400">↓{fmt(s.tokens_output)}</span>
          {totalTok > 0 && <span className="text-[10px] text-muted">={fmt(totalTok)}</span>}
          {(s.time_active_secs ?? 0) > 0 && (
            <span className="text-[10px] text-amber ml-auto">⏱ {fmtDuration(s.time_active_secs)}</span>
          )}
        </div>
        <div className="text-[10px] text-muted2 pl-3 mt-0.5">{rel(s.time_created)}</div>
      </button>
      {childList.length > 0 && (
        <div className="pl-3 border-l border-dashed border-bdr ml-3">
          {childList.map(k => (
            <MiniSessItem key={k.id} s={k} kids={kids} sel={sel} onSel={onSel} />
          ))}
        </div>
      )}
    </div>
  )
}

function PrevSessRow({ s }: { s: Session }) {
  const [open, setOpen] = useState(false)
  const color    = agentColor(s.agent)
  const totalTok = (s.tokens_input ?? 0) + (s.tokens_output ?? 0)
  const dur      = fmtDuration(s.time_active_secs ?? 0)

  return (
    <div className="border-b border-bdr/40 last:border-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full text-left px-3 py-2.5 hover:bg-s1 transition-colors"
      >
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
          <span className="text-[11px] font-semibold" style={{ color }}>{s.agent}</span>
          <span className="text-[10px] text-muted2 truncate flex-1">{s.title || '(untitled)'}</span>
          <span className="text-[10px] text-muted2 flex-shrink-0">{rel(s.time_created)}</span>
          <span className="text-muted2 text-[10px]">{open ? '▲' : '▼'}</span>
        </div>
        {/* Stats row always visible */}
        <div className="flex items-center gap-3 mt-1 pl-3.5">
          <span className="text-[10px] text-cyan">↑ {fmt(s.tokens_input)}</span>
          <span className="text-[10px] text-purple-400">↓ {fmt(s.tokens_output)}</span>
          <span className="text-[10px] text-muted">= {fmt(totalTok)} tok</span>
          <span className="text-[10px] text-amber">⏱ {dur}</span>
          {s.model_id && <span className="text-[10px] text-muted2 ml-auto truncate max-w-[80px]">{s.model_id.split('/').pop()}</span>}
        </div>
      </button>
      {open && (
        <div className="px-4 pb-3 flex flex-col gap-1 bg-bg text-[10px]">
          <div className="flex gap-4 text-muted2">
            <span>Started: {new Date(s.time_created).toLocaleString()}</span>
            <span>Ended: {new Date(s.time_updated).toLocaleString()}</span>
          </div>
          <div className="flex gap-4">
            <span className="text-cyan">Input: {s.tokens_input.toLocaleString()} tok</span>
            <span className="text-purple-400">Output: {s.tokens_output.toLocaleString()} tok</span>
            <span className="text-amber">Duration: {dur}</span>
          </div>
          {s.model_id && <span className="text-muted2 font-mono">{s.model_id}</span>}
        </div>
      )}
    </div>
  )
}

function MiniFeed({ data, tab }: { data: MonitorData | null; tab: FeedTab }) {
  if (!data) return <div className="text-[11px] text-muted text-center py-4">Loading…</div>

  if (tab === 'tools') {
    const tools = data.toolSummary ?? []
    if (!tools.length) return <div className="text-[11px] text-muted text-center py-4">No tool calls yet</div>
    const max = Math.max(...tools.map(t => t.cnt), 1)
    return (
      <>
        {tools.map((t, i) => (
          <div key={i} className="flex items-center gap-2 py-1 border-b border-bdr/30 last:border-0">
            <span className="text-cyan text-[10px] w-24 flex-shrink-0 truncate font-mono">{t.tool}</span>
            <span className="text-[10px] w-16 flex-shrink-0 truncate" style={{ color: agentColor(t.agent) }}>{t.agent}</span>
            <div className="flex-1 h-1 bg-bdr rounded-full overflow-hidden">
              <div className="h-full bg-cyan rounded-full" style={{ width: `${(t.cnt / max) * 100}%` }} />
            </div>
            <span className="text-[10px] text-muted2 w-4 text-right">{t.cnt}</span>
            <span className={`text-[10px] w-14 text-right flex-shrink-0 ${t.status === 'completed' ? 'text-green' : t.status === 'error' ? 'text-red' : 'text-amber'}`}>
              {t.status}
            </span>
          </div>
        ))}
      </>
    )
  }

  const parts = (data.parts ?? []).filter(p =>
    tab === 'reasoning' ? p.type === 'reasoning' : true
  )
  if (!parts.length) return <div className="text-[11px] text-muted text-center py-4">No {tab} yet</div>
  return <>{parts.map(p => <MiniPartCard key={p.id} p={p} />)}</>
}

function MiniPartCard({ p }: { p: Part }) {
  const [open, setOpen]     = useState(false)
  const icon        = p.type === 'tool' ? '⚙' : p.type === 'text' ? '💬' : '🧠'
  const accentColor = p.type === 'tool' ? '#22d3ee' : p.type === 'text' ? '#6366f1' : '#a855f7'

  const reasoningBlocks = p.type === 'reasoning' && p.text
    ? p.text.split(/\n{2,}/).filter(b => b.trim())
    : null

  const preview = p.type === 'text' ? p.text?.slice(0, 80)
                : p.type === 'tool' ? p.tool
                : p.text?.split('\n')[0]?.slice(0, 80)

  return (
    <div className="rounded-lg border border-bdr/60 overflow-hidden text-[11px]"
      style={{ borderLeftColor: accentColor, borderLeftWidth: 2 }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 bg-s1 text-left hover:bg-s2 transition-colors"
      >
        <span className="flex-shrink-0">{icon}</span>
        <span className="font-semibold flex-shrink-0" style={{ color: agentColor(p.agent) }}>{p.agent}</span>
        {p.type === 'tool' && <span className="text-cyan font-mono flex-shrink-0">{p.tool}</span>}
        {p.tool_status && (
          <span className={`text-[10px] flex-shrink-0 ${p.tool_status === 'completed' ? 'text-green' : p.tool_status === 'error' ? 'text-red' : 'text-amber'}`}>
            {p.tool_status}
          </span>
        )}
        {preview && !p.tool && (
          <span className="text-muted truncate flex-1 text-[10px]">{preview}</span>
        )}
        <span className="ml-auto text-[10px] text-muted2 flex-shrink-0">{rel(p.time_created)}</span>
        <span className="text-muted2 flex-shrink-0 ml-1 text-[10px]">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-2.5 py-2 bg-bg font-mono text-[10px] text-muted2 leading-relaxed flex flex-col gap-2">
          {p.type === 'reasoning' && reasoningBlocks ? (
            reasoningBlocks.map((block, i) => (
              <p key={i} className="whitespace-pre-wrap break-words text-purple-400 border-b border-bdr/40 pb-2 last:border-0 last:pb-0">
                {block}
              </p>
            ))
          ) : p.text ? (
            <p className="whitespace-pre-wrap break-words" style={{ color: p.type === 'reasoning' ? '#a855f7' : undefined }}>
              {p.text.slice(0, 1200)}{p.text.length > 1200 ? '…' : ''}
            </p>
          ) : null}
          {p.tool_input && (
            <pre className="bg-s2 rounded p-1.5 overflow-x-auto text-[10px] max-h-24 text-cyan">{p.tool_input}</pre>
          )}
          {p.tool_output && (
            <pre className="bg-s2 rounded p-1.5 overflow-x-auto text-[10px] max-h-24 text-green">{p.tool_output}</pre>
          )}
        </div>
      )}
    </div>
  )
}
