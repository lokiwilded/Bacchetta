import { useState } from 'react'
import Usage from './pages/Usage'
import Monitor from './pages/Monitor'
import Agents from './pages/Agents'
import Projects from './pages/Projects'

type Tab = 'usage' | 'monitor' | 'agents' | 'projects'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'usage',    label: 'Usage',    icon: '📊' },
  { id: 'monitor',  label: 'Monitor',  icon: '🔭' },
  { id: 'agents',   label: 'Agents',   icon: '🤖' },
  { id: 'projects', label: 'Projects', icon: '📁' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('usage')
  const [status, setStatus] = useState('Loading…')
  const [dot, setDot] = useState<'green' | 'red'>('green')
  const [refreshKey, setRefreshKey] = useState(0)

  function onStatus(msg: string, ok = true) {
    setStatus(msg)
    setDot(ok ? 'green' : 'red')
  }

  return (
    <div className="flex flex-col h-full bg-bg text-slate-200">

      {/* Top bar */}
      <header className="flex-shrink-0 flex items-center gap-2.5 px-4 h-12 bg-s1 border-b border-bdr z-50">
        <span className="font-extrabold tracking-wide text-sm">
          <span className="text-accent">cl</span>ause
        </span>
        <div className={`w-2 h-2 rounded-full flex-shrink-0 animate-pulse ${dot === 'green' ? 'bg-green' : 'bg-red'}`} />
        <span className="ml-auto text-xs text-muted hidden sm:block truncate max-w-[200px]">{status}</span>
        <button
          onClick={() => setRefreshKey(k => k + 1)}
          className="ml-auto sm:ml-2 flex items-center gap-1.5 text-xs text-muted2 border border-bdr rounded-lg px-3 py-1.5 active:bg-s2"
        >
          ↺ <span className="hidden sm:inline">Refresh</span>
        </button>
      </header>

      <div className="flex flex-1 overflow-hidden">

        {/* Desktop sidebar */}
        <nav className="hidden md:flex flex-col w-52 flex-shrink-0 bg-s1 border-r border-bdr overflow-y-auto">
          <div className="pt-3 pb-1 px-4 text-[10px] uppercase tracking-widest text-muted">Overview</div>
          {TABS.slice(0, 2).map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2.5 px-4 py-2.5 text-sm font-medium text-left transition-colors border-l-2 ${
                tab === t.id
                  ? 'bg-accent/10 text-accent border-accent'
                  : 'text-muted2 border-transparent hover:bg-s2 hover:text-slate-200'
              }`}
            >
              <span className="text-base w-5 text-center">{t.icon}</span>
              {t.label}
            </button>
          ))}
          <div className="pt-3 pb-1 px-4 text-[10px] uppercase tracking-widest text-muted">Config</div>
          {TABS.slice(2).map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2.5 px-4 py-2.5 text-sm font-medium text-left transition-colors border-l-2 ${
                tab === t.id
                  ? 'bg-accent/10 text-accent border-accent'
                  : 'text-muted2 border-transparent hover:bg-s2 hover:text-slate-200'
              }`}
            >
              <span className="text-base w-5 text-center">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </nav>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          {tab === 'usage'    && <Usage    key={refreshKey} onStatus={onStatus} />}
          {tab === 'monitor'  && <Monitor  key={refreshKey} onStatus={onStatus} />}
          {tab === 'agents'   && <Agents   key={refreshKey} onStatus={onStatus} />}
          {tab === 'projects' && <Projects key={refreshKey} onStatus={onStatus} />}
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="md:hidden flex-shrink-0 flex bg-s1 border-t border-bdr" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 flex flex-col items-center justify-center gap-1.5 py-3 min-h-[56px] transition-colors active:bg-s2 ${
              tab === t.id ? 'text-accent' : 'text-muted'
            }`}
          >
            <span className="text-[22px] leading-none">{t.icon}</span>
            <span className="text-[10px] font-bold uppercase tracking-wide">
              {t.label}
            </span>
          </button>
        ))}
      </nav>

    </div>
  )
}
