import type { ReleaseType } from 'semver'
import type { ParsedCommit } from '@/utils/commits'
import semver from 'semver'

export type BumpType = ReleaseType | 'conventional' | 'as-is' | 'custom'

export function computeNextVersion(
  currentVersion: string,
  type: BumpType,
  commits: ParsedCommit[] = [],
  customVersion?: string,
  identifier: string = 'beta',
): string {
  if (type === 'as-is')
    return currentVersion
  if (type === 'custom' && customVersion) {
    if (!semver.valid(customVersion)) {
      throw new Error(`Invalid custom version: ${customVersion}`)
    }
    return customVersion
  }

  if (type === 'conventional') {
    const recommendation = recommendBump(commits)
    if (!recommendation)
      return currentVersion
    return semver.inc(currentVersion, recommendation) || currentVersion
  }

  if (type.startsWith('pre') || type === 'prerelease') {
    return (
      semver.inc(currentVersion, type as ReleaseType, identifier)
      || currentVersion
    )
  }

  return semver.inc(currentVersion, type as ReleaseType) || currentVersion
}

export function recommendBump(commits: ParsedCommit[]): ReleaseType | null {
  let bump: ReleaseType | null = null

  for (const commit of commits) {
    const isBreaking
      = commit.notes.some(n => n.title === 'BREAKING CHANGE')
        || commit.header?.includes('!')

    if (isBreaking)
      return 'major'

    if (commit.type === 'feat')
      bump = 'minor'
    else if (commit.type === 'fix' && !bump)
      bump = 'patch'
  }

  return bump
}
