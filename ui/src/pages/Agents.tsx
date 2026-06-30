import { useEffect, useState } from 'react'
import { api } from '../api'
import type { Agent, ModelInfo, ClauseSettings, MemoryFile, MemoryChunk, ProfileItem } from '../types'
import { agentColor } from '../utils'

interface Props { onStatus: (msg: string, ok?: boolean) => void }

type AgentsTab = 'agents' | 'tools' | 'memory' | 'settings'

// Tool list used for the per-agent access checklist
const TOOL_LIST = [
  { name: 'search_code',     group: 'RAG',    color: '#22d3ee' },
  { name: 'index_workspace', group: 'RAG',    color: '#22d3ee' },
  { name: 'rag_status',      group: 'RAG',    color: '#22d3ee' },
  { name: 'read_cached',     group: 'Cache',  color: '#f59e0b' },
  { name: 'bash_cached',     group: 'Cache',  color: '#f59e0b' },
  { name: 'cache_status',    group: 'Cache',  color: '#f59e0b' },
  { name: 'read',            group: 'Read',   color: '#6366f1' },
  { name: 'glob',            group: 'Read',   color: '#6366f1' },
  { name: 'grep',            group: 'Read',   color: '#6366f1' },
  { name: 'edit',            group: 'Write',  color: '#10b981' },
  { name: 'bash',            group: 'Write',  color: '#10b981' },
  { name: 'task',            group: 'Agents', color: '#a855f7' },
  { name: 'delegate',        group: 'Agents', color: '#a855f7' },
  { name: 'delegation_read', group: 'Agents', color: '#a855f7' },
]
const ALL_TOOL_NAMES = TOOL_LIST.map(t => t.name)
const TOOL_GROUPS = [...new Set(TOOL_LIST.map(t => t.group))]

export default function Agents({ onStatus }: Props) {
  const [tab, setTab] = useState<AgentsTab>('agents')
  const [agents, setAgents] = useState<Agent[]>([])
  const [models, setModels] = useState<ModelInfo[]>([])
  const [settings, setSettings] = useState<ClauseSettings | null>(null)

  useEffect(() => {
    Promise.all([api.agents(), api.models(), api.getSettings()])
      .then(([a, m, s]) => {
        setAgents(Array.isArray(a) ? a : [])
        setModels(m.models ?? [])
        setSettings(s)
        onStatus('Loaded')
      })
      .catch(e => onStatus(String(e), false))
  }, [])

  const TABS: { id: AgentsTab; label: string }[] = [
    { id: 'agents',   label: 'Agents' },
    { id: 'tools',    label: 'Tools Reference' },
    { id: 'memory',   label: 'Memory' },
    { id: 'settings', label: 'Settings' },
  ]

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Sub-tabs */}
      <div className="flex-shrink-0 flex gap-0 border-b border-bdr bg-s1 px-4">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-3 text-xs font-semibold border-b-2 transition-colors ${
              tab === t.id
                ? 'border-accent text-accent'
                : 'border-transparent text-muted hover:text-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === 'agents' && (
          <div className="p-4 pb-24 md:pb-6 flex flex-col gap-3">
            <p className="text-xs text-muted">Save auto-restarts OpenCode · new chats pick up changes immediately</p>
            {agents.length === 0 && <div className="text-xs text-muted text-center py-8">Loading…</div>}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {agents.map(a => (
                <AgentCard key={a.name} agent={a} models={models} onStatus={onStatus} />
              ))}
            </div>
          </div>
        )}

        {tab === 'tools' && <ToolsReference />}

        {tab === 'memory' && <MemoryPanel onStatus={onStatus} />}

        {tab === 'settings' && (
          <SettingsPanel
            settings={settings}
            models={models}
            onSaved={(s) => { setSettings(s); onStatus('Settings saved · restart OpenCode to apply') }}
            onError={(e) => onStatus(e, false)}
          />
        )}
      </div>
    </div>
  )
}

// ─── Agent Card ──────────────────────────────────────────────────────────────

function AgentCard({ agent, models, onStatus }: { agent: Agent; models: ModelInfo[]; onStatus: (m: string, ok?: boolean) => void }) {
  const [model, setModel]           = useState(agent.model)
  const [prompt, setPrompt]         = useState(agent.systemPrompt)
  const [showPrompt, setShow]       = useState(false)
  const [selectedTools, setTools]   = useState<string[]>(agent.tools ?? [])
  const [showTools, setShowTools]   = useState(false)
  const [dirty, setDirty]           = useState(false)
  const [saving, setSaving]         = useState(false)
  const [msg, setMsg]               = useState('')
  const color = agentColor(agent.name)

  function toggleTool(name: string) {
    setTools(prev => {
      // empty = all allowed; clicking a tool restricts from "all" to "all except this"
      const base = prev.length === 0 ? ALL_TOOL_NAMES : prev
      const next = base.includes(name) ? base.filter(t => t !== name) : [...base, name]
      // if all selected again, reset to empty (unrestricted)
      return next.length === ALL_TOOL_NAMES.length ? [] : next
    })
    setDirty(true)
  }

  async function save() {
    setSaving(true)
    setMsg('Saving…')
    try {
      const r = await api.saveAgent(
        agent.name,
        model,
        showPrompt ? prompt : undefined,
        agent.hasPermission ? undefined : (showTools ? selectedTools : undefined),
      )
      if (r.error) throw new Error(r.error)
      setDirty(false)
      setMsg('Restarting…')
      onStatus('Saved ' + agent.name + ' · restarting OpenCode…')
      const restart = await api.restartOpencode()
      if (restart.error) throw new Error('saved but restart failed: ' + restart.error)
      setMsg('✓ applied'); onStatus('✓ ' + agent.name + ' updated · new chats will use ' + (model || 'updated config'))
      setTimeout(() => setMsg(''), 3000)
    } catch (e) { setMsg('✗ ' + String(e)); onStatus(String(e), false) }
    setSaving(false)
  }

  return (
    <div className="bg-s1 border border-bdr rounded-xl overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-bdr">
        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
        <span className="font-bold text-sm">{agent.name}</span>
        <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded font-semibold border ${
          agent.mode === 'primary'
            ? 'bg-accent/15 text-accent border-accent/30'
            : 'bg-s2 text-muted2 border-bdr'
        }`}>{agent.mode}</span>
      </div>
      <div className="px-4 py-3 flex flex-col gap-3">
        <div>
          <label className="block text-[11px] text-muted mb-1.5">Model</label>
          <select value={model} onChange={e => { setModel(e.target.value); setDirty(true) }}
            className="w-full bg-s2 border border-bdr rounded-lg px-3 py-2 text-xs text-slate-200 focus:border-accent outline-none">
            <option value="">— {agent.model || 'not set'} —</option>
            {models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <div>
          <button onClick={() => setShow(p => !p)} className="text-xs text-accent flex items-center gap-1">
            <span>{showPrompt ? '▼' : '▶'}</span> System Prompt
          </button>
          {showPrompt && (
            <textarea value={prompt} onChange={e => { setPrompt(e.target.value); setDirty(true) }}
              rows={6}
              className="mt-2 w-full bg-s2 border border-bdr rounded-lg px-3 py-2 text-xs font-mono text-slate-200 focus:border-accent outline-none resize-y leading-relaxed" />
          )}
        </div>
        <div>
          {agent.hasPermission ? (
            <div className="flex items-center gap-1.5 text-xs text-muted">
              <span className="text-amber">⚠</span> Tool access controlled by{' '}
              <code className="text-[10px] font-mono bg-s2 border border-bdr px-1 py-0.5 rounded">permission:</code>{' '}
              block — edit in the agent file directly.
            </div>
          ) : (
            <>
              <button onClick={() => setShowTools(p => !p)} className="text-xs text-accent flex items-center gap-1.5">
                <span>{showTools ? '▼' : '▶'}</span> Tool Access
                <span className="text-muted2 font-normal">
                  {selectedTools.length === 0 ? '(all)' : `${selectedTools.length} / ${ALL_TOOL_NAMES.length}`}
                </span>
              </button>
              {showTools && (
                <div className="mt-2 flex flex-col gap-2.5">
                  <p className="text-[10px] text-muted">Unchecked = blocked. Empty = all allowed.</p>
                  {TOOL_GROUPS.map(group => (
                    <div key={group}>
                      <div className="text-[10px] text-muted uppercase tracking-widest mb-1.5">{group}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {TOOL_LIST.filter(t => t.group === group).map(tool => {
                          const allowed = selectedTools.length === 0 || selectedTools.includes(tool.name)
                          return (
                            <button
                              key={tool.name}
                              onClick={() => toggleTool(tool.name)}
                              className="text-[10px] font-mono px-1.5 py-0.5 rounded border transition-all"
                              style={{
                                color: allowed ? tool.color : tool.color + '55',
                                background: allowed ? tool.color + '18' : 'transparent',
                                borderColor: allowed ? tool.color + '40' : tool.color + '25',
                                textDecoration: allowed ? 'none' : 'line-through',
                              }}
                            >
                              {tool.name}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={save} disabled={saving || !dirty}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${
              dirty ? 'bg-accent/15 border border-accent/40 text-accent active:bg-accent/25'
                    : 'bg-s2 border border-bdr text-muted cursor-not-allowed'}`}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          {dirty && !msg && <span className="text-[11px] text-amber">unsaved</span>}
          {msg && <span className={`text-[11px] ${msg.startsWith('✓') ? 'text-green' : 'text-red'}`}>{msg}</span>}
        </div>
      </div>
    </div>
  )
}

// ─── Settings Panel ───────────────────────────────────────────────────────────

const SETTING_DEFS = [
  {
    group: 'Context',
    items: [
      { key: 'compact_after', label: 'Auto-compact after N turns', desc: 'Summarizes conversation history every N completed AI responses. Lower = smaller context, faster responses, small risk of losing early detail.', min: 5, max: 50, step: 1, unit: 'turns' },
    ]
  },
  {
    group: 'RAG (Semantic Search)',
    items: [
      { key: 'rag_chunk_lines', label: 'Chunk size', desc: 'Lines of code per indexed chunk. Smaller = more precise search results but less surrounding context per match.', min: 20, max: 120, step: 10, unit: 'lines' },
      { key: 'rag_top_k', label: 'Search results', desc: 'How many code chunks are returned per search_code call. More = more context but higher token usage per query.', min: 1, max: 8, step: 1, unit: 'results' },
      { key: 'rag_max_file_kb', label: 'Max file size', desc: 'Files larger than this are skipped during indexing. Prevents huge generated files (lockfiles, bundles) from flooding the index.', min: 20, max: 500, step: 10, unit: 'KB' },
    ]
  },
  {
    group: 'Cache Plugin',
    items: [
      { key: 'cache_read_cap_chars', label: 'File read cap', desc: 'Maximum characters returned by read_cached. Files larger than this are truncated — agent sees a note to use search_code for specifics.', min: 5000, max: 100000, step: 5000, unit: 'chars' },
      { key: 'cache_bash_cap_chars', label: 'Bash output cap', desc: 'Maximum characters returned by bash_cached. Caps noisy command output (npm install, git log, test runners) from bloating context.', min: 5000, max: 100000, step: 5000, unit: 'chars' },
    ]
  },
  {
    group: 'Memory Extraction',
    items: [
      { key: 'memory_idle_minutes', label: 'Idle trigger', desc: 'Extract memory from a session after it has been quiet for this many minutes. Lower = more frequent extraction.', min: 1, max: 30, step: 1, unit: 'min' },
      { key: 'memory_top_k', label: 'Semantic results', desc: 'How many memory chunks are returned per semantic search query. More = richer context retrieval.', min: 1, max: 10, step: 1, unit: 'results' },
    ]
  },
]

const MEMORY_MODEL_SELECTS = [
  { key: 'memory_model',  label: 'Extraction model', desc: 'Model used to extract memory from sessions. Auto = primary agent\'s model.' },
  { key: 'profile_model', label: 'Profile model',    desc: 'Model used to extract self-improving profile patterns. Auto = extraction model.' },
]

function SettingsPanel({ settings, models, onSaved, onError }: {
  settings: ClauseSettings | null
  models: ModelInfo[]
  onSaved: (s: ClauseSettings) => void
  onError: (e: string) => void
}) {
  const [values, setValues] = useState<Partial<ClauseSettings>>({})
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (settings) setValues({ ...settings })
  }, [settings])

  function setNum(key: string, val: number) {
    setValues(v => ({ ...v, [key]: val }))
    setDirty(true)
  }

  function setStr(key: string, val: string) {
    setValues(v => ({ ...v, [key]: val }))
    setDirty(true)
  }

  async function save() {
    setSaving(true)
    try {
      const r = await api.saveSettings(values as ClauseSettings)
      if (r.error) throw new Error(r.error)
      onSaved(r.settings!)
      setDirty(false)
    } catch (e) { onError(String(e)) }
    setSaving(false)
  }

  if (!settings) return <div className="flex items-center justify-center h-32 text-muted text-sm">Loading…</div>

  return (
    <div className="p-4 pb-24 md:pb-6 flex flex-col gap-5">
      <div className="bg-amber/10 border border-amber/30 rounded-xl px-4 py-3 text-xs text-amber">
        Restart OpenCode after saving — plugins load settings at startup.
      </div>

      {SETTING_DEFS.map(group => (
        <div key={group.group} className="bg-s1 border border-bdr rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-bdr bg-s2">
            <span className="text-[11px] font-bold uppercase tracking-widest text-muted">{group.group}</span>
          </div>
          <div className="divide-y divide-bdr">
            {group.items.map(item => {
              const val = (values[item.key as keyof ClauseSettings] ?? 0) as number
              return (
                <div key={item.key} className="px-4 py-3 flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold">{item.label}</div>
                      <div className="text-[11px] text-muted mt-0.5">{item.desc}</div>
                    </div>
                    <div className="flex-shrink-0 text-right">
                      <span className="text-sm font-bold text-accent tabular-nums">
                        {item.unit === 'chars' ? (val >= 1000 ? (val / 1000).toFixed(0) + 'K' : val) : val}
                      </span>
                      <span className="text-[10px] text-muted ml-1">{item.unit}</span>
                    </div>
                  </div>
                  <input
                    type="range"
                    min={item.min} max={item.max} step={item.step}
                    value={val}
                    onChange={e => setNum(item.key, Number(e.target.value))}
                    className="w-full accent-accent h-1.5 rounded"
                  />
                  <div className="flex justify-between text-[10px] text-muted2">
                    <span>{item.unit === 'chars' ? (item.min / 1000) + 'K' : item.min}</span>
                    <span>{item.unit === 'chars' ? (item.max / 1000) + 'K' : item.max}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {/* Memory model selectors */}
      <div className="bg-s1 border border-bdr rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-bdr bg-s2">
          <span className="text-[11px] font-bold uppercase tracking-widest text-muted">Memory Models</span>
        </div>
        <div className="divide-y divide-bdr">
          {MEMORY_MODEL_SELECTS.map(item => {
            const val = (values[item.key as keyof ClauseSettings] ?? '') as string
            return (
              <div key={item.key} className="px-4 py-3 flex flex-col gap-1.5">
                <div className="text-xs font-semibold">{item.label}</div>
                <div className="text-[11px] text-muted">{item.desc}</div>
                <select
                  value={val}
                  onChange={e => setStr(item.key, e.target.value)}
                  className="w-full bg-s2 border border-bdr rounded-lg px-3 py-2 text-xs text-slate-200 focus:border-accent outline-none"
                >
                  <option value="">auto</option>
                  {models.map(m => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}
                </select>
              </div>
            )
          })}
          {/* Embedding model stays as text — Ollama embed models aren't in the chat models list */}
          <div className="px-4 py-3 flex flex-col gap-1.5">
            <div className="text-xs font-semibold">Embedding model</div>
            <div className="text-[11px] text-muted">Ollama model used to embed memory chunks for semantic search.</div>
            <input
              type="text"
              value={(values.memory_embed_model ?? '') as string}
              onChange={e => setStr('memory_embed_model', e.target.value)}
              placeholder="bge-m3"
              className="w-full bg-s2 border border-bdr rounded-lg px-3 py-2 text-xs font-mono text-slate-200 focus:border-accent outline-none"
            />
          </div>
        </div>
      </div>

      <button
        onClick={save}
        disabled={saving || !dirty}
        className={`w-full py-3 rounded-xl text-sm font-bold transition-colors ${
          dirty ? 'bg-accent/20 border border-accent/40 text-accent active:bg-accent/30'
                : 'bg-s1 border border-bdr text-muted cursor-not-allowed'}`}>
        {saving ? 'Saving…' : dirty ? 'Save Settings' : 'No changes'}
      </button>
    </div>
  )
}

// ─── Memory Panel ────────────────────────────────────────────────────────────

function MemoryPanel({ onStatus }: { onStatus: (m: string, ok?: boolean) => void }) {
  const [files, setFiles]         = useState<MemoryFile[]>([])
  const [profile, setProfile]     = useState<ProfileItem[]>([])
  const [open, setOpen]           = useState<string | null>(null)
  const [editing, setEditing]     = useState<Record<string, string>>({})
  const [saving, setSaving]       = useState<string | null>(null)
  const [searchQ, setSearchQ]     = useState('')
  const [searchRes, setSearchRes] = useState<MemoryChunk[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [showProfile, setShowP]   = useState(false)
  const [omem, setOmem]           = useState<{ running: boolean; url: string } | null>(null)

  useEffect(() => {
    Promise.all([
      api.memory().catch(() => [] as MemoryFile[]),
      api.memoryProfile().catch(() => ({ profile: [] as ProfileItem[] })),
      api.openCodeMem().catch(() => ({ running: false, port: 4747, url: 'http://localhost:4747' })),
    ]).then(([files, { profile }, omemStatus]) => {
      setFiles(Array.isArray(files) ? files : [])
      setProfile(Array.isArray(profile) ? profile : [])
      setOmem(omemStatus)
    }).catch(e => onStatus(String(e), false))
  }, [])

  async function doSearch() {
    if (!searchQ.trim()) { setSearchRes(null); return }
    setSearching(true)
    try {
      const { chunks } = await api.memorySearch(searchQ)
      setSearchRes(chunks)
    } catch (e) { onStatus(String(e), false) }
    setSearching(false)
  }

  async function save(dir: string) {
    setSaving(dir)
    try {
      await api.saveMemory(dir, editing[dir] ?? '')
      onStatus('Memory saved')
      setFiles(f => f.map(m => m.dir === dir ? { ...m, content: editing[dir] ?? '' } : m))
    } catch (e) { onStatus(String(e), false) }
    setSaving(null)
  }

  async function del(dir: string) {
    try {
      await api.deleteMemory(dir)
      setFiles(f => f.filter(m => m.dir !== dir))
      if (open === dir) setOpen(null)
      onStatus('Memory cleared')
    } catch (e) { onStatus(String(e), false) }
  }

  return (
    <div className="p-4 pb-24 md:pb-6 flex flex-col gap-4">

      {/* opencode-mem status */}
      <div className={`border rounded-xl p-4 flex items-center gap-3 ${omem?.running ? 'bg-green/5 border-green/20' : 'bg-s1 border-bdr'}`}>
        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${omem?.running ? 'bg-green animate-pulse' : 'bg-muted'}`} />
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-semibold ${omem?.running ? 'text-green' : 'text-muted2'}`}>
            opencode-mem {omem?.running ? '· running' : omem === null ? '· checking…' : '· not running'}
          </div>
          <div className="text-[11px] text-muted mt-0.5">
            {omem?.running
              ? 'Auto-capturing memories from your conversations. User profile learning active.'
              : 'Will start automatically with OpenCode. Captures memories from every session.'}
          </div>
        </div>
        {omem?.running && (
          <a
            href={omem.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-shrink-0 bg-green/10 border border-green/30 text-green text-xs font-semibold px-3 py-2 rounded-lg hover:bg-green/20 transition-colors"
          >
            Open UI →
          </a>
        )}
      </div>

      <p className="text-xs text-muted">
        Clause also extracts structured memory before context compression, embedded with bge-m3 for semantic search.
      </p>

      {/* Search */}
      <div className="bg-s1 border border-bdr rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-bdr bg-s2">
          <span className="text-[11px] font-bold uppercase tracking-widest text-muted">Semantic Search</span>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && doSearch()}
              placeholder="Search across all memory…"
              className="flex-1 bg-s2 border border-bdr rounded-lg px-3 py-2 text-xs text-slate-200 focus:border-accent outline-none"
            />
            <button
              onClick={doSearch}
              disabled={searching}
              className="px-4 py-2 rounded-lg text-xs font-semibold bg-accent/15 border border-accent/40 text-accent active:bg-accent/25 disabled:opacity-50"
            >
              {searching ? '…' : 'Search'}
            </button>
            {searchRes && (
              <button onClick={() => { setSearchRes(null); setSearchQ('') }}
                className="px-3 py-2 rounded-lg text-xs border border-bdr text-muted hover:text-slate-200">
                ✕
              </button>
            )}
          </div>
          {searchRes && (
            <div className="flex flex-col gap-2">
              {searchRes.length === 0 && <p className="text-xs text-muted text-center py-2">No matches</p>}
              {searchRes.map(c => (
                <div key={c.id} className="bg-s2 border border-bdr rounded-lg px-3 py-2.5">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[10px] font-bold text-accent">{c.section}</span>
                    <span className="text-[10px] text-muted ml-auto">{c.dir.split(/[/\\]/).pop()}</span>
                    <span className="text-[10px] font-mono text-muted2">{(c.similarity * 100).toFixed(0)}%</span>
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">{c.content.slice(0, 300)}{c.content.length > 300 ? '…' : ''}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* User Profile */}
      {profile.length > 0 && (
        <div className="bg-s1 border border-bdr rounded-xl overflow-hidden">
          <button
            onClick={() => setShowP(p => !p)}
            className="w-full px-4 py-2.5 border-b border-bdr bg-s2 flex items-center justify-between"
          >
            <span className="text-[11px] font-bold uppercase tracking-widest text-muted">User Profile</span>
            <span className="text-[10px] text-muted2">{profile.length} patterns · {showProfile ? '▲' : '▼'}</span>
          </button>
          {showProfile && (
            <div className="divide-y divide-bdr">
              {profile.map(item => (
                <div key={item.key} className="px-4 py-2.5 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[10px] font-mono text-accent">{item.key}</span>
                      <span className="text-[10px] text-muted2">×{item.count}</span>
                    </div>
                    <p className="text-[11px] text-slate-300">{item.value}</p>
                  </div>
                  <div className="flex-shrink-0 flex flex-col items-end gap-1 mt-0.5">
                    <span className="text-[10px] font-semibold" style={{ color: `hsl(${item.confidence * 120}, 70%, 60%)` }}>
                      {Math.round(item.confidence * 100)}%
                    </span>
                    <div className="w-16 h-1.5 bg-s2 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${item.confidence * 100}%`, background: `hsl(${item.confidence * 120}, 70%, 50%)` }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Memory Files */}
      <div className="flex flex-col gap-2">
        <div className="text-[11px] font-bold uppercase tracking-widest text-muted">Project Memory Files</div>
        {files.length === 0 && (
          <div className="text-xs text-muted text-center py-8 bg-s1 border border-bdr rounded-xl">
            No memory files yet — extracted automatically when sessions go idle or approach the auto-compact threshold.
          </div>
        )}

        {files.map(f => {
          const isOpen = open === f.dir
          const content = editing[f.dir] ?? f.content
          const isDirty = (editing[f.dir] ?? f.content) !== f.content
          return (
            <div key={f.dir} className="bg-s1 border border-bdr rounded-xl overflow-hidden">
              <button
                onClick={() => {
                  setOpen(isOpen ? null : f.dir)
                  if (!editing[f.dir]) setEditing(e => ({ ...e, [f.dir]: f.content }))
                }}
                className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-s2 transition-colors"
              >
                <div className="w-2 h-2 rounded-full bg-accent/60 flex-shrink-0 mt-1" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold truncate">{f.dir.split(/[/\\]/).pop()}</div>
                  <div className="text-[10px] text-muted font-mono truncate">{f.dir}</div>
                  {f.lastExtracted && (
                    <div className="text-[10px] text-muted2 mt-0.5">
                      extracted {new Date(f.lastExtracted).toLocaleString()}
                    </div>
                  )}
                </div>
                <span className="text-[10px] text-muted2 flex-shrink-0">{isOpen ? '▲' : '▼'}</span>
              </button>

              {isOpen && (
                <div className="px-4 pb-4 flex flex-col gap-2 border-t border-bdr">
                  <textarea
                    value={content}
                    onChange={e => setEditing(ed => ({ ...ed, [f.dir]: e.target.value }))}
                    rows={12}
                    className="mt-3 w-full bg-s2 border border-bdr rounded-lg px-3 py-2 text-xs font-mono text-slate-200 focus:border-accent outline-none resize-y leading-relaxed"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => save(f.dir)}
                      disabled={saving === f.dir || !isDirty}
                      className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${
                        isDirty ? 'bg-accent/15 border border-accent/40 text-accent active:bg-accent/25'
                                : 'bg-s2 border border-bdr text-muted cursor-not-allowed'}`}
                    >
                      {saving === f.dir ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      onClick={() => del(f.dir)}
                      className="px-4 py-2 rounded-lg text-xs font-semibold border border-red/30 text-red/70 hover:bg-red/10 active:bg-red/20"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Tools Reference ─────────────────────────────────────────────────────────

const TOOLS = [
  {
    group: 'RAG Plugin (clause-rag)',
    color: '#22d3ee',
    desc: 'Semantic code search using local bge-m3 embeddings. Use instead of grep/glob for exploration.',
    tools: [
      {
        name: 'search_code',
        sig: 'search_code(query, directory, top_k?)',
        desc: 'Semantic search over the indexed codebase. Returns the most relevant code chunks for a natural-language query.',
        example: 'search_code("token expiry logic", "/path/to/project")',
        tip: 'Use this FIRST before any read/grep. Returns file:line references you can then read_cached.',
      },
      {
        name: 'index_workspace',
        sig: 'index_workspace(directory, force?)',
        desc: 'Index a project directory for semantic search. Run once per project — skips if already indexed.',
        example: 'index_workspace("/path/to/project")',
        tip: 'Run at the start of any new project session. Force re-index with force: true.',
      },
      {
        name: 'rag_status',
        sig: 'rag_status()',
        desc: 'List all indexed workspaces with chunk counts and age.',
        example: 'rag_status()',
        tip: 'Check this before search_code to confirm the project is indexed.',
      },
    ],
  },
  {
    group: 'Cache Plugin (clause-cache)',
    color: '#f59e0b',
    desc: 'Cached reads and shell commands. Reduces repeated file reads and command executions in context.',
    tools: [
      {
        name: 'read_cached',
        sig: 'read_cached(path)',
        desc: 'Read a file with caching — instant on repeated reads if file is unchanged. Always prefer over built-in read.',
        example: 'read_cached("/path/to/src/auth.ts")',
        tip: 'Use after search_code narrows down which file to read. Capped at configurable size.',
      },
      {
        name: 'bash_cached',
        sig: 'bash_cached(command, ttl_seconds?, cwd?)',
        desc: 'Run a shell command and cache the output. For repeated status checks that won\'t change.',
        example: 'bash_cached("git status", 30, "/path/to/project")',
        tip: 'Do NOT use for commands with side effects (edits, installs). Use plain bash for those.',
      },
      {
        name: 'cache_status',
        sig: 'cache_status()',
        desc: 'List what is currently in the cache — useful for debugging stale results.',
        example: 'cache_status()',
        tip: '',
      },
    ],
  },
  {
    group: 'Built-in: Read',
    color: '#6366f1',
    desc: 'File system reads. Prefer cached/RAG versions — use these when you need fresh or uncached content.',
    tools: [
      {
        name: 'read',
        sig: 'read(path, offset?, limit?)',
        desc: 'Read a file. Use read_cached instead unless you just edited the file.',
        example: 'read("/path/to/file.ts", 0, 50)',
        tip: 'offset and limit are line numbers — useful for reading a specific function after search_code found the line range.',
      },
      {
        name: 'glob',
        sig: 'glob(pattern, path?)',
        desc: 'Find files matching a pattern.',
        example: 'glob("**/*.test.ts", "/project")',
        tip: 'Use to find files by name pattern. search_code is better for finding code by meaning.',
      },
      {
        name: 'grep',
        sig: 'grep(pattern, path?, options?)',
        desc: 'Search file contents with regex.',
        example: 'grep("export function auth", "/project/src")',
        tip: 'Best for finding exact symbols. search_code is better for conceptual queries.',
      },
    ],
  },
  {
    group: 'Built-in: Write',
    color: '#10b981',
    desc: 'File and shell modifications. Always read the file first before editing.',
    tools: [
      {
        name: 'edit',
        sig: 'edit(file, old_string, new_string)',
        desc: 'Replace exact text in a file. old_string must be unique — add surrounding context if needed.',
        example: 'edit("/src/auth.ts", "const TTL = 3600", "const TTL = 86400")',
        tip: 'Read the file first to get the exact text. Never edit blind.',
      },
      {
        name: 'bash',
        sig: 'bash(command)',
        desc: 'Run a shell command with side effects — builds, installs, git commits, tests.',
        example: 'bash("bun run build")',
        tip: 'Use bash_cached for read-only status checks. Use bash for anything that changes state.',
      },
    ],
  },
  {
    group: 'Built-in: Agents',
    color: '#a855f7',
    desc: 'Delegate work to subagents. task = blocking with write access. delegate = async read-only.',
    tools: [
      {
        name: 'task',
        sig: 'task(prompt, agent?)',
        desc: 'Spawn a subagent to handle a task. Blocking — waits for result. Subagent has full write access and its own clean context.',
        example: 'task("Fix the auth TTL bug in src/auth.ts line 84. Expected: 24h TTL.", "coder")',
        tip: 'Always include: working directory, specific file paths, and exactly what done looks like. Available agents: coder, quick, test-writer, docs, vision.',
      },
      {
        name: 'delegate',
        sig: 'delegate(prompt, agent?)',
        desc: 'Fire a read-only background agent asynchronously. Returns an ID immediately — use delegation_read(id) to get the result.',
        example: 'delegate("Trace how auth tokens are validated in /project/src", "researcher")',
        tip: 'Fire multiple delegates in parallel — they run simultaneously. Use for researcher and reviewer agents. Available: researcher, reviewer, vision.',
      },
      {
        name: 'delegation_read',
        sig: 'delegation_read(id)',
        desc: 'Get the result of a completed delegation.',
        example: 'delegation_read("abc123")',
        tip: 'Check after each delegate call. Blocks until result is ready.',
      },
    ],
  },
]

function ToolsReference() {
  const [open, setOpen] = useState<string | null>(null)

  return (
    <div className="p-4 pb-24 md:pb-6 flex flex-col gap-4">
      <p className="text-xs text-muted">Reference for writing agent system prompts. Click any tool to see usage details.</p>

      {TOOLS.map(group => (
        <div key={group.group} className="bg-s1 border border-bdr rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-bdr flex items-center gap-2.5">
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: group.color }} />
            <div>
              <div className="text-xs font-bold">{group.group}</div>
              <div className="text-[11px] text-muted mt-0.5">{group.desc}</div>
            </div>
          </div>
          <div className="divide-y divide-bdr">
            {group.tools.map(tool => {
              const id = group.group + tool.name
              const isOpen = open === id
              return (
                <div key={tool.name}>
                  <button
                    onClick={() => setOpen(isOpen ? null : id)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-s2 transition-colors"
                  >
                    <span className="text-[10px] font-bold font-mono px-1.5 py-0.5 rounded flex-shrink-0"
                      style={{ color: group.color, background: group.color + '18' }}>
                      {tool.name}
                    </span>
                    <span className="text-[11px] text-muted truncate flex-1">{tool.desc}</span>
                    <span className="text-[10px] text-muted2 flex-shrink-0">{isOpen ? '▲' : '▼'}</span>
                  </button>

                  {isOpen && (
                    <div className="px-4 pb-4 flex flex-col gap-3 bg-s2/50">
                      <div>
                        <div className="text-[10px] text-muted uppercase tracking-widest mb-1">Signature</div>
                        <code className="text-xs font-mono text-cyan-300">{tool.sig}</code>
                      </div>
                      <div>
                        <div className="text-[10px] text-muted uppercase tracking-widest mb-1">Example</div>
                        <div className="bg-s1 border border-bdr rounded-lg px-3 py-2 text-xs font-mono text-slate-300">
                          {tool.example}
                        </div>
                      </div>
                      {tool.tip && (
                        <div className="flex gap-2 bg-accent/8 border border-accent/20 rounded-lg px-3 py-2">
                          <span className="text-accent flex-shrink-0 text-xs">→</span>
                          <span className="text-[11px] text-slate-300">{tool.tip}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
