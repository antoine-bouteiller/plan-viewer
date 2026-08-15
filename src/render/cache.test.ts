import { describe, expect, test } from 'bun:test'

import { cachedRender } from './cache'

describe('cachedRender', () => {
  test('returns the cached value for matching keys and stamps', () => {
    let calls = 0
    const compute = () => ({ value: ++calls })
    const stamp = { mtimeMs: 1, size: 10 }

    const first = cachedRender('same-stamp:first', stamp, compute)
    const second = cachedRender('same-stamp:first', stamp, compute)

    expect(calls).toBe(1)
    expect(second).toBe(first)
  })

  test('recomputes when either part of the stamp changes', () => {
    let calls = 0
    const compute = () => ++calls

    cachedRender('changed-stamp:mtime', { mtimeMs: 1, size: 10 }, compute)
    cachedRender('changed-stamp:mtime', { mtimeMs: 2, size: 10 }, compute)
    cachedRender('changed-stamp:size', { mtimeMs: 1, size: 10 }, compute)
    cachedRender('changed-stamp:size', { mtimeMs: 1, size: 20 }, compute)

    expect(calls).toBe(4)
  })

  test('evicts the oldest entry after 100 entries', () => {
    let calls = 0
    const compute = () => ++calls

    for (let index = 0; index < 101; index++) {
      cachedRender(`eviction:first:${index}`, { mtimeMs: 1, size: index }, compute)
    }
    cachedRender('eviction:first:0', { mtimeMs: 1, size: 0 }, compute)

    expect(calls).toBe(102)
  })

  test('replacing a stamp keeps one entry in its original insertion position', () => {
    let calls = 0
    const compute = () => ++calls
    const key = 'restamped:target'

    cachedRender(key, { mtimeMs: 1, size: 10 }, compute)
    cachedRender(key, { mtimeMs: 2, size: 10 }, compute)

    for (let index = 0; index < 100; index++) {
      cachedRender(`restamped:filler:${index}`, { mtimeMs: 1, size: index }, compute)
    }
    cachedRender(key, { mtimeMs: 2, size: 10 }, compute)

    expect(calls).toBe(103)
  })
})
