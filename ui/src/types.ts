export interface ProjectSession {
  id: string
  title: string
  directory: string
  time: { created: number; updated: number }
}

export interface UsageData {
  totals: {
    total_sessions: number
    total_agents: number
    total_models: number
    total_input: number
    total_output: number
    total_cache_read: number
    total_active_secs: number
    total_opus_cost: number
    total_savings: number
    total_actual_cost: number
    active_days: number
    first_day: string
    last_day: string
  }
  byAgent: AgentStat[]
  byModel: ModelStat[]
  byDay: DayStat[]
  topSessions: TopSession[]
  error?: string
}

export interface AgentStat {
  agent: string
  model_id: string
  sessions: number
  input_tokens: number
  output_tokens: number
  active_secs: number
  opus_cost: number
}

export interface ModelStat {
  model_id: string
  sessions: number
  input_tokens: number
  output_tokens: number
  opus_cost: number
}

export interface DayStat {
  day: string
  sessions: number
  input_tokens: number
  output_tokens: number
}

export interface TopSession {
  id: string
  title: string
  agent: string
  model_id: string
  tokens_input: number
  tokens_output: number
  day: string
  opus_cost: number
}

export interface MonitorData {
  sessions: Session[]
  previousSessions: Session[]
  parts: Part[]
  toolSummary: ToolStat[]
  latestTs: number
  error?: string
}

export interface Session {
  id: string
  parent_id: string | null
  agent: string
  model_id: string
  title: string
  tokens_input: number
  tokens_output: number
  time_created: number
  time_updated: number
  is_active: number
  time_active_secs: number
}

export interface Part {
  id: string
  session_id: string
  time_created: number
  type: 'tool' | 'text' | 'reasoning'
  agent: string
  model_id: string
  session_title: string
  text: string | null
  tool: string | null
  tool_status: string | null
  tool_input: string | null
  tool_output: string | null
}

export interface ToolStat {
  tool: string
  status: string
  cnt: number
  agent: string
}

export interface Agent {
  name: string
  mode: string
  model: string
  description: string
  systemPrompt: string
  tools: string[]
  hasPermission: boolean
}

export interface MemoryFile {
  file: string
  dir: string
  lastExtracted: string | null
  content: string
}

export interface MemoryChunk {
  id: string
  dir: string
  section: string
  content: string
  similarity: number
}

export interface ProfileItem {
  key: string
  value: string
  confidence: number
  count: number
  last_seen: number
}

export interface ModelInfo {
  id: string
  name: string
  provider: string
}

export interface Project {
  id: string
  name: string
  directory: string
  addedAt: number
  running: boolean
  runningPort: number | null
  version: string | null
}

export interface RunningInstance {
  port: number
  version: string
  project: { worktree: string; name?: string } | null
}

export interface ProjectsData {
  projects: Project[]
  running: RunningInstance[]
  error?: string
}

export interface ClauseSettings {
  compact_after: number
  rag_chunk_lines: number
  rag_top_k: number
  rag_max_file_kb: number
  cache_read_cap_chars: number
  cache_bash_cap_chars: number
  memory_idle_minutes: number
  memory_top_k: number
  memory_model: string
  profile_model: string
  memory_embed_model: string
}

export interface RagProgress {
  phase: 'checking' | 'walking' | 'indexing' | 'done' | 'error' | 'idle'
  message?: string
  file?: string
  indexed?: number
  total?: number
  chunks?: number
  pct?: number
  already?: boolean
}
