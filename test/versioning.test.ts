import { describe, expect, it } from 'vitest'
import { parseCommits } from '@/utils/commits'
import { recommendBump } from '@/versioning'

function bumpFor(...messages: string[]) {
  return recommendBump(parseCommits(messages.map(m => `${m}\n-hash-\n0`)))
}

describe('recommendBump', () => {
  it('picks the highest bump regardless of commit order', () => {
    expect(bumpFor('fix: a', 'feat: b')).toBe('minor')
    expect(bumpFor('feat: b', 'fix: a')).toBe('minor')
    expect(bumpFor('fix: a', 'feat!: b')).toBe('major')
  })

  it('returns null without releasable commits', () => {
    expect(bumpFor('chore: a', 'docs: b')).toBeNull()
  })
})
