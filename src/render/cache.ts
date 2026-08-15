const cache = new Map<string, { mtimeMs: number; size: number; result: unknown }>()

const maxEntries = 100

export const cachedRender = <Result>(key: string, stamp: { mtimeMs: number; size: number }, compute: () => Result): Result => {
  const entry = cache.get(key)

  if (entry && entry.mtimeMs === stamp.mtimeMs && entry.size === stamp.size) {
    return entry.result as Result
  }

  const result = compute()
  cache.set(key, { ...stamp, result })

  if (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value

    if (oldestKey !== undefined) {
      cache.delete(oldestKey)
    }
  }

  return result
}
