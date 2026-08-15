import { useEffect, useState } from 'react'

import { cn } from '@/lib/utils'

type Mode = 'light' | 'dark' | 'system'

const KEY = 'plan-viewer.theme'
const MODES: Mode[] = ['light', 'dark', 'system']

const apply = (mode: Mode) => {
  const root = document.documentElement
  if (mode === 'system') {
    root.removeAttribute('data-theme')
    localStorage.removeItem(KEY)
  } else {
    root.setAttribute('data-theme', mode)
    localStorage.setItem(KEY, mode)
  }
}

const ThemeSelector = () => {
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem(KEY) as Mode | null) ?? 'system')

  useEffect(() => apply(mode), [mode])

  return (
    <div className="bg-elevated ml-auto inline-flex h-7 items-center gap-0.5 rounded-md border p-0.5" role="radiogroup" aria-label="Theme">
      {MODES.map((modeOption) => (
        <button
          key={modeOption}
          type="button"
          role="radio"
          aria-checked={mode === modeOption}
          onClick={() => setMode(modeOption)}
          className={cn(
            'rounded-[4px] px-2 py-0.5 font-mono text-[11px] capitalize transition-colors',
            mode === modeOption ? 'border-b-2 border-accent bg-bg text-fg' : 'text-muted hover:text-fg'
          )}
        >
          {modeOption}
        </button>
      ))}
    </div>
  )
}

export { ThemeSelector }
