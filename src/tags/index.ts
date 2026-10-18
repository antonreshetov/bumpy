import type { BumpyConfig } from '@/config/schema'
import type { Project } from '@/projects'
import { listTags } from '@/git'

export const MONOREPO_TAG_FORMAT = '{name}@{version}'
export const SINGLE_PACKAGE_TAG_FORMAT = 'v{version}'

export function assertTagFormat(format: string): void {
  if (!format.includes('{version}')) {
    throw new Error(
      `Invalid tag format "${format}": the {version} placeholder is required.`,
    )
  }
}

export async function resolveTagFormat(
  config: BumpyConfig,
  projects: Project[],
  override?: string,
): Promise<string> {
  const format = override || config.release.git.tagFormat

  if (format) {
    assertTagFormat(format)
    return format
  }

  const isSinglePackageRepo
    = projects.length === 1 && projects[0].directory === '.'

  if (!isSinglePackageRepo)
    return MONOREPO_TAG_FORMAT

  // Repos released before tagFormat existed keep their tags, otherwise the
  // next release would lose its boundary and break tag-triggered CI
  const legacyTags = await listTags(
    tagMatchPattern(MONOREPO_TAG_FORMAT, projects[0].name),
  )

  return legacyTags.length > 0
    ? MONOREPO_TAG_FORMAT
    : SINGLE_PACKAGE_TAG_FORMAT
}

export function formatTag(
  format: string,
  name: string,
  version: string,
): string {
  return format.replaceAll('{name}', name).replaceAll('{version}', version)
}

/**
 * Glob for `git describe --match`, which uses fnmatch: the version part is
 * unknown at lookup time, so it becomes a wildcard.
 */
export function tagMatchPattern(format: string, name: string): string {
  return format.replaceAll('{name}', name).replaceAll('{version}', '*')
}
