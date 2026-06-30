const PALETTE = ['#6366f1','#22d3ee','#f59e0b','#10b981','#ef4444','#a855f7','#fb923c','#14b8a6','#f43f5e','#84cc16']

export function agentColor(name: string): string {
  let h = 5381
  for (let i = 0; i < name.length; i++) h = ((h << 5) + h) ^ name.charCodeAt(i)
  return PALETTE[Math.abs(h) % PALETTE.length]
}

export function fmt(n: number | null | undefined): string {
  if (!n) return '0'
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return String(Math.round(n))
}

export function usd(n: number | null | undefined): string {
  return '$' + (n ?? 0).toFixed(2)
}

export function hrs(secs: number | null | undefined): string {
  if (!secs) return '0m'
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  return h ? `${h}h ${m}m` : `${m}m`
}

export function rel(ms: number | null | undefined): string {
  if (!ms) return '—'
  const d = (Date.now() - ms) / 1000
  if (d < 60) return `${Math.round(d)}s ago`
  if (d < 3600) return `${Math.round(d / 60)}m ago`
  if (d < 86400) return `${Math.round(d / 3600)}h ago`
  return `${Math.round(d / 86400)}d ago`
}

export function shortModel(id: string | null | undefined): string {
  if (!id) return '—'
  return id.split('/').pop()?.replace(/:cloud$/, '') ?? id
}
