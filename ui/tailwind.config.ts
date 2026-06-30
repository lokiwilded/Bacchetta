import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg:     '#08090f',
        s1:     '#0f1118',
        s2:     '#161922',
        bdr:    '#1e2235',
        accent: '#6366f1',
        green:  '#10b981',
        amber:  '#f59e0b',
        red:    '#ef4444',
        cyan:   '#22d3ee',
        purple: '#a855f7',
        muted:  '#64748b',
        muted2: '#94a3b8',
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config
