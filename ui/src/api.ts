import type { UsageData, MonitorData, Agent, ModelInfo, ProjectsData, ClauseSettings, ProjectSession, MemoryFile, MemoryChunk, ProfileItem } from './types'

const BASE = ''  // same-origin in prod; Vite proxy in dev

async function get<T>(path: string): Promise<T> {
  const r = await fetch(BASE + path, { cache: 'no-store' })
  return r.json()
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return r.json()
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(BASE + path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return r.json()
}

export const api = {
  usage: () => get<UsageData>('/api/usage'),
  monitor: (sessionId?: string, worktree?: string, history?: boolean) => {
    const p = new URLSearchParams()
    if (sessionId) p.set('session', sessionId)
    if (worktree)  p.set('worktree', worktree)
    if (history)   p.set('history', '1')
    const qs = p.toString()
    return get<MonitorData>(`/api/monitor${qs ? `?${qs}` : ''}`)
  },
  agents: () => get<Agent[]>('/api/agents'),
  models: () => get<{ models: ModelInfo[]; defaultModel?: string }>('/api/models'),
  projects: () => get<ProjectsData>('/api/projects'),
  saveAgent: (name: string, model?: string, systemPrompt?: string, tools?: string[]) =>
    put<{ ok?: boolean; error?: string }>('/api/agents', { name, model, systemPrompt, tools }),
  memory: () => get<MemoryFile[]>('/api/memory'),
  memoryForDir: (dir: string) => get<{ dir: string; content: string; exists: boolean }>(`/api/memory?dir=${encodeURIComponent(dir)}`),
  saveMemory: (dir: string, content: string) =>
    post<{ ok?: boolean; error?: string }>('/api/memory', { dir, content }),
  deleteMemory: (dir: string) =>
    fetch('/api/memory?dir=' + encodeURIComponent(dir), { method: 'DELETE' }).then(r => r.json()) as Promise<{ ok?: boolean }>,
  memorySearch: (q: string, dir?: string) => {
    const p = new URLSearchParams({ q })
    if (dir) p.set('dir', dir)
    return get<{ chunks: MemoryChunk[] }>(`/api/memory/search?${p}`)
  },
  memoryProfile: () => get<{ profile: ProfileItem[] }>('/api/memory/profile'),
  addProject: (directory: string, name?: string) =>
    post<{ ok?: boolean; error?: string }>('/api/projects', { action: 'add', directory, name }),
  removeProject: (id: string) =>
    post<{ ok?: boolean; error?: string }>('/api/projects', { action: 'remove', id }),
  launchProject: (id: string) =>
    post<{ ok?: boolean; port?: number; sessionId?: string; error?: string }>('/api/projects', { action: 'launch', id }),
  stopProject: (port: number) =>
    post<{ ok?: boolean; error?: string }>('/api/projects', { action: 'stop', port }),
  ragStatus: (dir?: string) =>
    get<{ workspace: { indexed: boolean; chunks?: number; age_minutes?: number }; all: any[] }>(
      `/api/rag/status${dir ? `?dir=${encodeURIComponent(dir)}` : ''}`
    ),
  getSettings: () => get<ClauseSettings>('/api/settings'),
  saveSettings: (s: Partial<ClauseSettings>) =>
    post<{ ok?: boolean; settings?: ClauseSettings; error?: string }>('/api/settings', s),
  restartOpencode: () =>
    post<{ ok?: boolean; port?: number; error?: string }>('/api/restart', {}),
  projectSessions: (port: number, directory?: string) =>
    get<{ sessions: ProjectSession[]; directory: string; error?: string }>(
      `/api/sessions?port=${port}${directory ? `&dir=${encodeURIComponent(directory)}` : ''}`
    ),
  abortSession: (sessionId: string, port?: number) =>
    post<{ ok?: boolean; error?: string }>('/api/sessions', { action: 'abort', sessionId, port }),
  currentProject: () =>
    get<{ port: number; isMain: boolean }>('/api/current-project'),
  openCodeMem: () =>
    get<{ running: boolean; port: number; url: string }>('/api/opencode-mem'),
}
