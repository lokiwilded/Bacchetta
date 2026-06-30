import { useEffect, useRef, useState } from 'react'
import type { MonitorData, Part, Session } from '../types'
import { rel, agentColor } from '../utils'
import { api } from '../api'

interface Props { onStatus: (msg: string, ok?: boolean) => void }

// A "step" in the flow = one agent doing one thing
interface FlowStep {
  id: string
  agent: string
  color: string
  type: 'tool' | 'text' | 'reasoning' | 'delegate'
  label: string        // tool name, or text snippet
  detail?: string      // tool input/output summary
  ts: number
  sessionId: string
  isLive: boolean
}

function buildFlow(parts: Part[], sessions: Session[]): FlowStep[] {
  const sessionMap = new Map(sessions.map(s => [s.id, s]))
  const steps: FlowStep[] = []

  for (const p of parts) {
    const sess = sessionMap.get(p.session_id)
    const agent = p.agent ?? 'unknown'
    const color = agentColor(agent)
    const isLive = !!(sess?.is_active)

    if (p.type === 'tool') {
      const toolName = p.tool ?? 'tool'
      // Collapse duplicate consecutive tool calls from same agent+tool
      const last = steps[steps.length - 1]
      if (last?.agent === agent && last?.label === toolName && last?.type === 'tool') {
        last.detail = (last.detail ?? '') + ' +'
        continue
      }
      let detail = ''
      if (p.tool_input) {
        try {
          const inp = JSON.parse(p.tool_input)
          const first = Object.values(inp)[0]
          detail = typeof first === 'string' ? first.slice(0, 60) : ''
        } catch { detail = p.tool_input.slice(0, 60) }
      }
      steps.push({ id: p.id, agent, color, type: 'tool', label: toolName, detail, ts: p.time_created, sessionId: p.session_id, isLive })
    }

    else if (p.type === 'text' && p.text?.trim()) {
      // Only show non-empty text that's meaningful (skip tiny whitespace-only)
      const preview = p.text.trim().slice(0, 80)
      if (!preview) continue
      const last = steps[steps.length - 1]
      // Don't repeat text from same agent if already there
      if (last?.agent === agent && last?.type === 'text') { last.label = preview; continue }
      steps.push({ id: p.id, agent, color, type: 'text', label: preview, ts: p.time_created, sessionId: p.session_id, isLive })
    }

    else if (p.type === 'reasoning' && p.text?.trim()) {
      // Show just the first line of reasoning as a step
      const first = p.text.trim().split('\n')[0].slice(0, 60)
      const last = steps[steps.length - 1]
      if (last?.agent === agent && last?.type === 'reasoning') continue
      steps.push({ id: p.id, agent, color, type: 'reasoning', label: first, ts: p.time_created, sessionId: p.session_id, isLive })
    }
  }

  return steps
}

const TYPE_ICON: Record<string, string> = {
  tool: '⚙',
  text: '💬',
  reasoning: '🧠',
  delegate: '→',
}

const TYPE_LABEL_COLOR: Record<string, string> = {
  tool: '#22d3ee',
  text: '#94a3b8',
  reasoning: '#a855f7',
}

export default function Monitor({ onStatus }: Props) {
  const [parts, setParts]         = useState<Part[]>([])
  const [sessions, setSessions]   = useState<Session[]>([])
  const [flowBase, setFlowBase]   = useState<number>(Date.now() - 900_000)
  const [lastSessCount, setLastSessCount] = useState(0)
  const [animReset, setAnimReset] = useState(false)
  const [stopping, setStopping]   = useState<Set<string>>(new Set())
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const bottomRef = useRef<HTMLDivElement>(null)

  async function stopSession(sessionId: string) {
    setStopping(prev => new Set(prev).add(sessionId))
    try {
      const r = await api.abortSession(sessionId)
      if (r.ok) onStatus('Session stopped')
      else onStatus(r.error || 'Stop failed', false)
    } catch (e) { onStatus(String(e), false) }
    setStopping(prev => { const s = new Set(prev); s.delete(sessionId); return s })
  }

  async function load() {
    try {
      const qs = new URLSearchParams({ order: 'asc', since: String(flowBase) })
      const r = await fetch(`/api/monitor?${qs}`, { cache: 'no-store' })
      const d: MonitorData = await r.json()
      const newSessions = d.sessions ?? []
      const newParts    = d.parts    ?? []

      // Detect a new burst (new active session appeared) → reset flow
      const activeSessions = newSessions.filter(s => s.is_active)
      if (activeSessions.length > lastSessCount && lastSessCount > 0) {
        const newestTs = Math.min(...activeSessions.map(s => s.time_created))
        setFlowBase(newestTs)
        setAnimReset(true)
        setTimeout(() => setAnimReset(false), 600)
      }
      setLastSessCount(activeSessions.length)
      setSessions(newSessions)
      setParts(newParts)

      if (newSessions.some(s => s.is_active)) {
        onStatus('Live · ' + new Date().toLocaleTimeString())
      }
    } catch {}
    timer.current = setTimeout(load, 2500)
  }

  useEffect(() => {
    load()
    return () => clearTimeout(timer.current)
  }, [flowBase])

  // Auto-scroll to bottom as new steps arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [parts.length])

  const flow = buildFlow(parts, sessions)
  const activeSessions = sessions.filter(s => s.is_active)
  const isLive = activeSessions.length > 0

  function resetNow() {
    setFlowBase(Date.now())
    setAnimReset(true)
    setTimeout(() => setAnimReset(false), 600)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-bg">

      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-bdr">
        <div>
          <h1 className="text-sm font-bold">Agent Flow</h1>
          <p className="text-[11px] text-muted">
            {isLive
              ? `${activeSessions.length} active · auto-resets on new message`
              : 'Waiting for activity…'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isLive && (
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-green animate-pulse" />
              <span className="text-[11px] text-green font-semibold">Live</span>
            </div>
          )}
          <button
            onClick={resetNow}
            className="text-[11px] text-muted border border-bdr rounded-lg px-2.5 py-1.5 hover:bg-s1 active:bg-s2"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Active sessions with stop buttons */}
      {activeSessions.length > 0 && (
        <div className="flex-shrink-0 border-b border-bdr px-4 py-2 flex flex-wrap gap-2">
          {activeSessions.map(s => (
            <div key={s.id} className="flex items-center gap-1.5 bg-s1 border border-bdr rounded-lg px-2.5 py-1">
              <div className="w-1.5 h-1.5 rounded-full bg-green animate-pulse flex-shrink-0" />
              <span className="text-[11px] font-semibold" style={{ color: agentColor(s.agent ?? 'unknown') }}>{s.agent}</span>
              <span className="text-[11px] text-muted truncate max-w-[140px]">{s.title || 'untitled'}</span>
              <button
                onClick={() => stopSession(s.id)}
                disabled={stopping.has(s.id)}
                className="ml-1 text-[10px] px-1.5 py-0.5 rounded border border-red/30 text-red/70 hover:bg-red/10 active:bg-red/20 disabled:opacity-40 transition-colors"
              >
                {stopping.has(s.id) ? '…' : '■ stop'}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Flow canvas */}
      <div className={`flex-1 overflow-y-auto px-4 py-4 transition-opacity duration-300 ${animReset ? 'opacity-0' : 'opacity-100'}`}>
        {flow.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <div className="text-4xl opacity-20">◉</div>
            <p className="text-sm text-muted">No activity in the last 15 minutes</p>
            <p className="text-[11px] text-muted2">Send a message in OpenCode and the agent flow will appear here</p>
          </div>
        ) : (
          <div className="flex flex-col gap-0 max-w-2xl mx-auto">
            {flow.map((step, i) => (
              <FlowNode key={step.id} step={step} index={i} isLast={i === flow.length - 1} isFirst={i === 0} />
            ))}
            {/* Live tail */}
            {isLive && (
              <div className="flex items-center gap-3 pl-1 pt-1">
                <div className="flex flex-col items-center w-7 flex-shrink-0">
                  <div className="w-px h-4 bg-bdr" />
                  <div className="w-2 h-2 rounded-full bg-green animate-pulse" />
                </div>
                <span className="text-[11px] text-green animate-pulse">thinking…</span>
              </div>
            )}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Agent legend */}
      {flow.length > 0 && (
        <div className="flex-shrink-0 border-t border-bdr px-4 py-2 flex flex-wrap gap-x-4 gap-y-1">
          {[...new Set(flow.map(f => f.agent))].map(agent => (
            <div key={agent} className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full" style={{ background: agentColor(agent) }} />
              <span className="text-[10px] text-muted2">{agent}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function FlowNode({ step, index, isFirst, isLast }: {
  step: FlowStep; index: number; isFirst: boolean; isLast: boolean
}) {
  const [expanded, setExpanded] = useState(false)

  const nodeSize = step.type === 'text' ? 'w-3.5 h-3.5' : step.type === 'tool' ? 'w-3 h-3' : 'w-2.5 h-2.5'
  const nodeOpacity = step.type === 'reasoning' ? 'opacity-60' : ''

  return (
    <div className="flex gap-3">
      {/* Spine */}
      <div className="flex flex-col items-center w-7 flex-shrink-0">
        {!isFirst && <div className="w-px flex-1 min-h-[8px]" style={{ background: step.color + '40' }} />}
        <div
          className={`rounded-full flex-shrink-0 ${nodeSize} ${nodeOpacity} ${step.isLive ? 'animate-pulse' : ''}`}
          style={{ background: step.color, boxShadow: step.isLive ? `0 0 6px ${step.color}` : undefined }}
        />
        {!isLast && <div className="w-px flex-1 min-h-[12px]" style={{ background: step.color + '40' }} />}
      </div>

      {/* Content */}
      <button
        onClick={() => step.detail && setExpanded(e => !e)}
        className={`flex-1 pb-3 pt-0.5 text-left min-w-0 ${step.detail ? 'cursor-pointer' : 'cursor-default'}`}
      >
        <div className="flex items-baseline gap-2 flex-wrap">
          {/* Agent name */}
          <span className="text-[11px] font-bold flex-shrink-0" style={{ color: step.color }}>
            {step.agent}
          </span>

          {/* Type badge for non-text */}
          {step.type !== 'text' && (
            <span
              className="text-[10px] font-mono px-1.5 py-0.5 rounded flex-shrink-0"
              style={{ color: TYPE_LABEL_COLOR[step.type] ?? step.color, background: (TYPE_LABEL_COLOR[step.type] ?? step.color) + '18' }}
            >
              {TYPE_ICON[step.type]} {step.label}
            </span>
          )}

          {/* Text preview inline */}
          {step.type === 'text' && (
            <span className="text-xs text-slate-300 truncate min-w-0">
              {step.label}{step.label.length >= 80 ? '…' : ''}
            </span>
          )}

          {/* Timestamp */}
          <span className="text-[10px] text-muted2 ml-auto flex-shrink-0">{rel(step.ts)}</span>
        </div>

        {/* Expanded detail */}
        {expanded && step.detail && (
          <div className="mt-1 ml-0 text-[10px] text-muted2 font-mono bg-s1 rounded px-2 py-1.5 border border-bdr truncate">
            {step.detail}
          </div>
        )}
      </button>
    </div>
  )
}
