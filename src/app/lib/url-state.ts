import { useCallback, useEffect, useState } from 'react'

import { type Tab } from '@/lib/plan'

interface UrlState {
  wt?: string
  tab?: Tab
  doc?: string
  diff?: 'true'
}

const KEYS = ['wt', 'tab', 'doc', 'diff'] as const

const read = (): UrlState => {
  const params = new URLSearchParams(location.search)
  const state: UrlState = {}
  for (const key of KEYS) {
    const value = params.get(key)
    if (value && key === 'wt') {
      state.wt = value
    }
    if (value && key === 'tab' && (value === 'plans' || value === 'specs')) {
      state.tab = value
    }
    if (value && key === 'doc') {
      state.doc = value
    }
    if (value === 'true' && key === 'diff') {
      state.diff = value
    }
  }
  return state
}

const useUrlState = () => {
  const [state, setState] = useState<UrlState>(read)
  const update = useCallback(
    (patch: UrlState) => {
      setState((current) => {
        const next = { ...current, ...patch }
        const params = new URLSearchParams()
        let query = ''
        for (const key of KEYS) {
          if (next[key]) {
            params.set(key, next[key])
          }
        }
        query = params.toString()
        history.replaceState(null, '', query ? `?${query}` : location.pathname)
        return next
      })
    },
    [setState]
  )

  useEffect(() => {
    const onPop = () => setState(read())
    addEventListener('popstate', onPop)
    return () => removeEventListener('popstate', onPop)
  }, [])

  return [state, update] as const
}

export { useUrlState }
