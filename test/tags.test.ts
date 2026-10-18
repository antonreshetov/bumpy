import type { BumpyConfig } from '@/config/schema'
import fs from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BumpyConfigSchema } from '@/config/schema'
import { getLastTag, hasPendingCommits } from '@/git'
import { resolveProjects } from '@/projects'
import {
  formatTag,
  MONOREPO_TAG_FORMAT,
  resolveTagFormat,
  SINGLE_PACKAGE_TAG_FORMAT,
  tagMatchPattern,
} from '@/tags'
import { workspaceFiles } from './fixtures'
import {
  commitAll,
  createWorkspace,
  git,
  initGitRepo,
  writeFiles,
} from './helpers'

function config(git: Record<string, unknown> = {}): BumpyConfig {
  return BumpyConfigSchema.parse({ release: { git } })
}

describe('tag templates', () => {
  it('formats tags', () => {
    expect(formatTag(MONOREPO_TAG_FORMAT, '@acme/ui', '1.2.3')).toBe(
      '@acme/ui@1.2.3',
    )
    expect(formatTag(SINGLE_PACKAGE_TAG_FORMAT, 'my-lib', '1.2.3')).toBe(
      'v1.2.3',
    )
    expect(formatTag('release/{name}/{version}', 'app', '2.0.0-beta.1')).toBe(
      'release/app/2.0.0-beta.1',
    )
  })

  it('builds match patterns for the previous release', () => {
    expect(tagMatchPattern(MONOREPO_TAG_FORMAT, 'site')).toBe('site@*')
    expect(tagMatchPattern(SINGLE_PACKAGE_TAG_FORMAT, 'my-lib')).toBe('v*')
  })

  it('requires the {version} placeholder in config', () => {
    expect(() => config({ tagFormat: '{name}' })).toThrow()
  })
})

describe('resolveTagFormat', () => {
  let dir: string
  const originalCwd = process.cwd()

  async function setup(files: Record<string, unknown>) {
    dir = await createWorkspace(files)
    await initGitRepo(dir)
    await commitAll(dir, 'chore: init')
    process.chdir(dir)
  }

  async function resolve(cfg: BumpyConfig = config(), override?: string) {
    return resolveTagFormat(cfg, await resolveProjects(cfg, dir), override)
  }

  afterEach(async () => {
    process.chdir(originalCwd)
    await fs.rm(dir, { recursive: true, force: true })
  })

  describe('single package in the repository root', () => {
    beforeEach(async () => {
      await setup({ 'package.json': { name: 'my-lib', version: '1.0.0' } })
    })

    it('defaults to v{version} in a new repo', async () => {
      expect(await resolve()).toBe(SINGLE_PACKAGE_TAG_FORMAT)
    })

    it('keeps {name}@{version} when such tags already exist', async () => {
      await git(dir, 'tag', 'my-lib@1.0.0')
      expect(await resolve()).toBe(MONOREPO_TAG_FORMAT)
    })

    it('prefers the CLI override, then the config', async () => {
      await git(dir, 'tag', 'my-lib@1.0.0')
      const cfg = config({ tagFormat: 'release-{version}' })
      expect(await resolve(cfg)).toBe('release-{version}')
      expect(await resolve(cfg, 'v{version}')).toBe('v{version}')
    })

    it('rejects an override without {version}', async () => {
      await expect(resolve(config(), 'latest')).rejects.toThrow('{version}')
    })

    it('finds the previous release and pending commits by the format', async () => {
      await git(dir, 'tag', 'v1.0.0')
      await writeFiles(dir, { 'index.js': 'export {}' })
      await commitAll(dir, 'feat: a')
      await git(dir, 'tag', 'v1.1.0')

      const pattern = tagMatchPattern(await resolve(), 'my-lib')
      expect(await getLastTag(pattern)).toBe('v1.1.0')
      expect(await hasPendingCommits(pattern, ['.'])).toBe(false)

      await writeFiles(dir, { 'index.js': 'export const a = 1' })
      await commitAll(dir, 'fix: b')
      expect(await hasPendingCommits(pattern, ['.'])).toBe(true)
    })
  })

  it('uses {name}@{version} in a monorepo', async () => {
    await setup(workspaceFiles)
    expect(await resolve()).toBe(MONOREPO_TAG_FORMAT)
  })
})
