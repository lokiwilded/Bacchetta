import { useEffect, useState, useRef } from 'react'
import { api } from '../api'
import type { ProjectsData, RunningInstance, Project, RagProgress, ProjectSession } from '../types'
import { rel } from '../utils'
import ProjectMonitor from '../components/ProjectMonitor'

interface Props { onStatus: (msg: string, ok?: boolean) => void }

// Direct link to the opencode chat UI — navigate to the specific session if we have one.
// OpenCode's SPA route is /:base64dir/session/:id (the /session/:id path hits the REST API, not the SPA).
function chatUrl(port: number, sessionId?: string, directory?: string): string {
  const base = `http://${window.location.hostname}:${port}`
  if (!sessionId || !directory) return base
  // OpenCode encodes the directory as base64 of the Windows path (backslashes)
  const winDir = directory.replace(/\//g, '\\')
  const b64dir = btoa(unescape(encodeURIComponent(winDir)))
  return `${base}/${b64dir}/session/${sessionId}`
}

async function launchProject(id: string): Promise<{ port?: number; error?: string }> {
  const r = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'launch', id }),
  })
  return r.json()
}

function streamRagIndex(directory: string, onEvent: (e: RagProgress) => void): () => void {
  const ctrl = new AbortController()
  fetch('/api/rag/index', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ directory }),
    signal: ctrl.signal,
  }).then(async res => {
    if (!res.body) return
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const parts = buf.split('\n\n')
      buf = parts.pop() ?? ''
      for (const part of parts) {
        const lines = part.split('\n')
        let event = 'message', data = ''
        for (const l of lines) {
          if (l.startsWith('event: ')) event = l.slice(7)
          if (l.startsWith('data: '))  data  = l.slice(6)
        }
        if (!data) continue
        try {
          const parsed = JSON.parse(data)
          onEvent({ phase: event as any, ...parsed })
        } catch {}
      }
    }
  }).catch(() => {})
  return () => ctrl.abort()
}

function RagBar({ rag }: { rag: RagProgress }) {
  if (rag.phase === 'idle') return null
  const isDone  = rag.phase === 'done'
  const isErr   = rag.phase === 'error'
  const pct     = rag.pct ?? (isDone ? 100 : 0)
  const color   = isErr ? 'bg-red' : isDone ? 'bg-green' : 'bg-accent'
  const textCol = isErr ? 'text-red' : isDone ? 'text-green' : 'text-accent'

  return (
    <div className="mt-3 rounded-xl border border-bdr bg-s2 p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className={`text-xs font-semibold ${textCol} flex items-center gap-1.5`}>
          {!isDone && !isErr && (
            <span className="inline-block w-3 h-3 rounded-full border-2 border-accent border-t-transparent animate-spin" />
          )}
          {isDone && <span>✓</span>}
          {isErr  && <span>✗</span>}
          <span>
            {rag.phase === 'checking' && (rag.message ?? 'RAG: checking Ollama…')}
            {rag.phase === 'walking'  && 'RAG: scanning files…'}
            {rag.phase === 'indexing' && `RAG: indexing… ${rag.indexed ?? 0}/${rag.total ?? '?'} files`}
            {isDone && (rag.already ? `RAG: already indexed (${rag.chunks} chunks)` : `RAG: indexed ${rag.files ?? rag.chunks} files → ${rag.chunks} chunks`)}
            {isErr  && `RAG: ${rag.message}`}
          </span>
        </div>
        {rag.phase === 'indexing' && (
          <span className="text-[10px] text-muted">{pct}%</span>
        )}
      </div>

      {/* Progress bar */}
      <div className="h-1 rounded-full bg-s1 overflow-hidden">
        <div
          className={`h-full rounded-full ${color} transition-all duration-300`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {rag.file && rag.phase === 'indexing' && (
        <div className="text-[10px] text-muted font-mono truncate">{rag.file}</div>
      )}
    </div>
  )
}

export default function Projects({ onStatus }: Props) {
  const [data, setData]         = useState<ProjectsData | null>(null)
  const [showAdd, setShowAdd]   = useState(false)
  const [dirInput, setDirInput] = useState('')
  const [nameInput, setNameInput] = useState('')
  const [addErr, setAddErr]     = useState('')
  const [adding, setAdding]     = useState(false)
  const [launching, setLaunching]   = useState<string | null>(null)
  const [stopping, setStopping]     = useState<number | null>(null)
  const [openMonitor, setOpenMonitor] = useState<string | null>(null)
  const [openSessions, setOpenSessions] = useState<string | null>(null)
  const [sessionsData, setSessionsData] = useState<Record<string, ProjectSession[]>>({})
  const [launchErr, setLaunchErr]   = useState<Record<string, string>>({})
  const [ragState, setRagState]     = useState<Record<string, RagProgress>>({})
  // justLaunched carries the port so we can show "Open Chat Now" even if the
  // worktree match hasn't resolved yet (common path-case mismatch on Windows)
  const [justLaunched, setJustLaunched] = useState<{ id: string; port: number; sessionId?: string } | null>(null)
  const cancelRag = useRef<Record<string, () => void>>({})

  async function load() {
    try {
      const d = await api.projects()
      setData(d)
    } catch (e) { onStatus(String(e), false) }
  }

  useEffect(() => { load() }, [])

  async function addProject() {
    if (!dirInput.trim()) { setAddErr('Enter a directory path'); return }
    setAdding(true); setAddErr('')
    try {
      const r = await api.addProject(dirInput.trim(), nameInput.trim() || undefined)
      if (r.error) throw new Error(r.error)
      setDirInput(''); setNameInput(''); setShowAdd(false)
      onStatus('Project added')
      load()
    } catch (e) { setAddErr(String(e)) }
    setAdding(false)
  }

  async function handleLaunch(p: Project) {
    setLaunching(p.id)
    setLaunchErr(prev => ({ ...prev, [p.id]: '' }))
    setRagState(prev => ({ ...prev, [p.id]: { phase: 'checking', message: 'Starting OpenCode…' } }))
    onStatus(`Starting OpenCode for ${p.name}…`)

    try {
      const r = await launchProject(p.id)
      if (r.error) throw new Error(r.error)

      await load()
      onStatus(`✓ ${p.name} ready on :${r.port} — click Open Chat to start coding`)
      setJustLaunched({ id: p.id, port: r.port!, sessionId: r.sessionId })
      setTimeout(() => setJustLaunched(null), 30_000)
      setLaunching(null)

      // RAG runs in the background — Open Chat is already available
      const cancel = streamRagIndex(p.directory, (evt) => {
        setRagState(prev => ({ ...prev, [p.id]: evt }))
        if (evt.phase === 'done') {
          delete cancelRag.current[p.id]
          setTimeout(() => setRagState(prev => { const n = {...prev}; delete n[p.id]; return n }), 4000)
        }
        if (evt.phase === 'error') delete cancelRag.current[p.id]
      })
      cancelRag.current[p.id] = cancel
    } catch (e) {
      const msg = String(e).replace('Error: ', '')
      setLaunchErr(prev => ({ ...prev, [p.id]: msg }))
      setRagState(prev => { const n = {...prev}; delete n[p.id]; return n })
      onStatus(msg, false)
      setLaunching(null)
    }
  }

  async function handleStop(port: number) {
    setStopping(port)
    onStatus(`Stopping OpenCode on :${port}…`)
    try {
      await api.stopProject(port)
      onStatus(`Stopped :${port}`)
      await load()
    } catch (e) { onStatus(String(e), false) }
    setStopping(null)
  }

  async function toggleSessions(p: Project) {
    if (openSessions === p.id) { setOpenSessions(null); return }
    setOpenSessions(p.id)
    try {
      // Sessions route queries SQLite by dir — works even when project is stopped.
      // Pass runningPort if available, otherwise 4000 (port is ignored when dir is provided).
      const r = await api.projectSessions(p.runningPort ?? 4000, p.directory)
      if (r.sessions) setSessionsData(prev => ({ ...prev, [p.id]: r.sessions }))
    } catch {}
  }

  async function remove(id: string) {
    if (cancelRag.current[id]) { cancelRag.current[id](); delete cancelRag.current[id] }
    await api.removeProject(id)
    load()
  }

  return (
    <div className="p-4 pb-24 md:pb-6 flex flex-col gap-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-sm font-bold">Projects</h1>
          <p className="text-xs text-muted mt-0.5">Add folders · launch OpenCode · RAG indexed</p>
        </div>
        <button
          onClick={() => { setShowAdd(v => !v); setAddErr('') }}
          className="bg-accent/15 border border-accent/40 text-accent text-xs font-semibold px-3 py-2 rounded-lg active:bg-accent/25"
        >
          {showAdd ? '✕ Cancel' : '+ Add'}
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="bg-s1 border border-bdr rounded-xl p-4 flex flex-col gap-3">
          <div className="text-xs font-semibold text-muted2">Add Project Directory</div>
          <div>
            <label className="block text-[11px] text-muted mb-1">Name (optional)</label>
            <input
              type="text" value={nameInput} onChange={e => setNameInput(e.target.value)}
              placeholder="My Project"
              className="w-full bg-s2 border border-bdr rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-accent outline-none"
            />
          </div>
          <div>
            <label className="block text-[11px] text-muted mb-1">Path</label>
            <input
              type="text" value={dirInput} onChange={e => setDirInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addProject()}
              placeholder="C:/Users/lokid/dev/my-project"
              className="w-full bg-s2 border border-bdr rounded-lg px-3 py-2 text-sm font-mono text-slate-200 focus:border-accent outline-none"
            />
          </div>
          {addErr && <p className="text-xs text-red">{addErr}</p>}
          <button
            onClick={addProject} disabled={adding}
            className="bg-accent/15 border border-accent/40 text-accent text-sm font-semibold py-2.5 rounded-lg active:bg-accent/25 disabled:opacity-50"
          >
            {adding ? 'Adding…' : 'Add Project'}
          </button>
        </div>
      )}

      {/* Running instances */}
      {(data?.running ?? []).length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-[10px] uppercase tracking-widest text-muted">Running Now</div>
          {data!.running.map(r => (
            <RunningCard
              key={r.port} r={r}
              stopping={stopping === r.port}
              monitorOpen={openMonitor === `run-${r.port}`}
              onStop={() => handleStop(r.port)}
              onToggleMonitor={() => setOpenMonitor(p => p === `run-${r.port}` ? null : `run-${r.port}`)}
            />
          ))}
        </div>
      )}

      {data && data.running.length === 0 && !data.projects.length && (
        <div className="bg-amber/5 border border-amber/20 rounded-xl p-4 text-xs text-amber">
          <div className="font-semibold mb-1">No projects yet</div>
          <div className="text-amber/70">
            Click <strong>+ Add</strong>, enter a project folder path, then hit <strong>Launch</strong>.<br />
            OpenCode will start and the codebase will be indexed with bge-m3 for semantic search.
          </div>
        </div>
      )}

      {/* Saved projects */}
      {(data?.projects ?? []).length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-[10px] uppercase tracking-widest text-muted">Projects</div>
          {data!.projects.map(p => (
            <ProjectCard
              key={p.id} p={p}
              launching={launching === p.id}
              stopping={p.runningPort !== null && stopping === p.runningPort}
              monitorOpen={openMonitor === p.id}
              sessionsOpen={openSessions === p.id}
              sessions={sessionsData[p.id]}
              launchErr={launchErr[p.id]}
              rag={ragState[p.id]}
              justLaunched={justLaunched?.id === p.id ? { port: justLaunched.port, sessionId: justLaunched.sessionId } : undefined}
              onLaunch={() => handleLaunch(p)}
              onStop={() => p.runningPort && handleStop(p.runningPort)}
              onToggleMonitor={() => setOpenMonitor(prev => prev === p.id ? null : p.id)}
              onToggleSessions={() => toggleSessions(p)}
              onRemove={() => remove(p.id)}
            />
          ))}
        </div>
      )}

      {data && data.projects.length === 0 && !showAdd && (
        <div className="text-xs text-muted text-center py-10">
          No projects yet.<br className="mb-1" />Click <span className="text-accent font-semibold">+ Add</span> to bookmark a project folder.
        </div>
      )}
    </div>
  )
}

function RunningCard({ r, stopping, monitorOpen, onStop, onToggleMonitor }: {
  r: RunningInstance; stopping: boolean; monitorOpen: boolean
  onStop: () => void; onToggleMonitor: () => void
}) {
  const isMain = r.port === 4000
  const [confirm, setConfirm] = useState(false)

  function handleStop() {
    if (isMain && !confirm) { setConfirm(true); return }
    setConfirm(false); onStop()
  }

  return (
    <div className={`border rounded-xl overflow-hidden ${isMain ? 'bg-amber/5 border-amber/25' : 'bg-green/5 border-green/20'}`}>
      <div className="flex items-center gap-3 p-4">
        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 animate-pulse ${isMain ? 'bg-amber' : 'bg-green'}`} />
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-semibold ${isMain ? 'text-amber' : 'text-green'}`}>
            {isMain ? '⚠ Main instance' : 'OpenCode'} v{r.version} · :{r.port}
          </div>
          {r.project?.worktree && (
            <div className="text-[11px] text-muted mt-0.5 truncate font-mono">{r.project.worktree}</div>
          )}
        </div>
        <div className="flex flex-col gap-1.5 flex-shrink-0">
          <a href={chatUrl(r.port, (r as any).sessionId, r.project?.worktree)} target="_blank" rel="noopener noreferrer"
            className="bg-accent/15 border border-accent/40 text-accent text-xs font-semibold px-3 py-2 rounded-lg text-center">
            Open Chat →
          </a>
          <button onClick={onToggleMonitor}
            className={`text-[11px] border rounded-lg px-3 py-1.5 text-center transition-colors ${monitorOpen ? 'bg-accent/15 border-accent/40 text-accent' : 'border-bdr text-muted'}`}>
            {monitorOpen ? 'Hide Monitor' : 'Monitor'}
          </button>
          <button onClick={handleStop} disabled={stopping}
            className={`text-[11px] border rounded-lg px-3 py-1.5 disabled:opacity-50 text-center active:opacity-80 ${confirm ? 'bg-red/20 border-red/50 text-red font-semibold' : 'text-red/70 border-red/25'}`}>
            {stopping ? 'Stopping…' : confirm ? 'Tap again' : 'Stop'}
          </button>
        </div>
      </div>
      {isMain && confirm && (
        <div className="mx-4 mb-3 text-[11px] text-amber bg-amber/10 border border-amber/25 rounded-lg px-3 py-2">
          ⚠ Stopping the main instance disconnects the dashboard. Tap Stop again to confirm.
        </div>
      )}
      {monitorOpen && r.project?.worktree && (
        <div className="px-4 pb-4">
          <ProjectMonitor worktree={r.project.worktree} projectName={`port ${r.port}`} />
        </div>
      )}
    </div>
  )
}

function ProjectCard({
  p, launching, stopping, monitorOpen, sessionsOpen, sessions, launchErr, rag, justLaunched,
  onLaunch, onStop, onToggleMonitor, onToggleSessions, onRemove
}: {
  p: Project; launching: boolean; stopping: boolean; monitorOpen: boolean
  sessionsOpen: boolean; sessions?: ProjectSession[]
  launchErr?: string
  rag?: RagProgress
  justLaunched?: { port: number; sessionId?: string }
  onLaunch: () => void; onStop: () => void; onToggleMonitor: () => void
  onToggleSessions: () => void; onRemove: () => void
}) {
  const isIndexing = rag && rag.phase !== 'idle' && rag.phase !== 'done' && rag.phase !== 'error'
  const activePort = justLaunched?.port ?? p.runningPort ?? null
  const activeSession = justLaunched?.sessionId ?? (p as any).sessionId ?? undefined
  const isRunning  = p.running || !!justLaunched
  const isMain     = activePort === 4000
  const [confirmStop, setConfirmStop] = useState(false)

  function handleStop() {
    if (isMain && !confirmStop) { setConfirmStop(true); return }
    setConfirmStop(false); onStop()
  }

  return (
    <div className={`bg-s1 border rounded-xl p-4 flex flex-col gap-0 transition-colors ${isRunning ? 'border-green/30' : 'border-bdr'}`}>
      <div className="flex items-start gap-3">
        <span className="text-2xl flex-shrink-0 mt-0.5">📁</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">{p.name}</span>
            {isRunning && activePort && (
              <span className="text-[9px] bg-green/15 text-green border border-green/30 rounded px-1.5 py-0.5 font-bold">
                LIVE :{activePort}
              </span>
            )}
            {isIndexing && (
              <span className="text-[9px] bg-accent/15 text-accent border border-accent/30 rounded px-1.5 py-0.5 font-bold animate-pulse">
                INDEXING
              </span>
            )}
          </div>
          <div className="text-[11px] text-muted mt-0.5 font-mono break-all">{p.directory}</div>
          <div className="text-[10px] text-muted2 mt-1">Added {rel(p.addedAt)}</div>
          {launchErr && <div className="text-[11px] text-red mt-1.5">✗ {launchErr}</div>}
        </div>

        <div className="flex flex-col gap-2 flex-shrink-0 min-w-[80px]">
          {isRunning && activePort ? (
            <>
              <a
                href={chatUrl(activePort, activeSession, p.directory)} target="_blank" rel="noopener noreferrer"
                className={`text-xs font-semibold px-3 py-2 rounded-lg text-center block transition-all ${
                  justLaunched
                    ? 'bg-green/20 border border-green text-green animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.4)]'
                    : 'bg-accent/15 border border-accent/40 text-accent'
                }`}
              >
                {justLaunched ? '▶ Open Chat Now' : 'Open Chat'}
              </a>
              <button
                onClick={onToggleMonitor}
                className={`text-[11px] border rounded-lg px-3 py-1.5 text-center transition-colors ${monitorOpen ? 'bg-accent/15 border-accent/40 text-accent' : 'border-bdr text-muted'}`}
              >
                {monitorOpen ? 'Hide Monitor' : 'Monitor'}
              </button>
              <button
                onClick={handleStop} disabled={stopping}
                className={`text-[11px] border rounded-lg px-3 py-1.5 disabled:opacity-50 text-center active:opacity-80 ${
                  confirmStop ? 'bg-red/20 border-red/50 text-red font-semibold' : 'text-red/70 border-red/25'
                }`}
              >
                {stopping ? 'Stopping…' : confirmStop ? 'Confirm stop' : 'Stop'}
              </button>
            </>
          ) : (
            <button
              onClick={onLaunch} disabled={launching}
              className="bg-green/10 border border-green/30 text-green text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-60 active:bg-green/20 text-center"
            >
              {launching ? (
                <span className="flex items-center gap-1 justify-center">
                  <span className="animate-spin">⟳</span> Starting…
                </span>
              ) : 'Launch'}
            </button>
          )}
          {/* Sessions: always visible — queries DB directly, works when stopped */}
          <button
            onClick={onToggleSessions}
            className={`text-[11px] border rounded-lg px-3 py-1.5 text-center transition-colors ${sessionsOpen ? 'bg-accent/15 border-accent/40 text-accent' : 'border-bdr text-muted'}`}
          >
            {sessionsOpen ? 'Hide Sessions' : 'Sessions'}
          </button>
          <button
            onClick={onRemove}
            className="text-[11px] text-red/60 border border-red/20 rounded-lg px-3 py-1.5 active:bg-red/10 text-center"
          >
            Remove
          </button>
        </div>
      </div>

      {/* RAG progress bar */}
      {rag && <RagBar rag={rag} />}

      {/* Sessions panel */}
      {sessionsOpen && (
        <div className="mt-3 rounded-xl border border-bdr bg-s2 overflow-hidden">
          {!sessions ? (
            <div className="px-4 py-3 text-xs text-muted">Loading sessions…</div>
          ) : sessions.length === 0 ? (
            <div className="px-4 py-3 text-xs text-muted">No sessions yet.</div>
          ) : (
            <div className="flex flex-col divide-y divide-bdr">
              {sessions.map(s => {
                const url = activePort ? chatUrl(activePort, s.id, p.directory) : undefined
                const date = new Date(s.time.updated)
                const label = s.title.replace(/^New session - /, '').replace('T', ' ').slice(0, 16)
                return (
                  <a key={s.id} href={url} target={url ? '_blank' : undefined} rel="noopener noreferrer"
                    title={url ? undefined : 'Start this project to open session'}
                    className={`flex items-center gap-3 px-4 py-2.5 transition-colors group ${url ? 'hover:bg-s1' : 'opacity-50 cursor-default'}`}>
                    <span className="text-accent text-xs flex-shrink-0">▶</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate group-hover:text-accent transition-colors">
                        {s.title.startsWith('New session') ? `Session ${label}` : s.title}
                      </div>
                      <div className="text-[10px] text-muted mt-0.5">
                        {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                    <span className="text-[10px] text-muted2 flex-shrink-0 group-hover:text-accent transition-colors">Open →</span>
                  </a>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Inline monitor */}
      {monitorOpen && p.running && (
        <ProjectMonitor worktree={p.directory} projectName={p.name} />
      )}
    </div>
  )
}
