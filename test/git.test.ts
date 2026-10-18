import type { BumpyConfig } from '@/config/schema'
import type { Project } from '@/projects'
import fs from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getCommits, hasPendingCommits } from '@/git'
import { getProjectPaths, resolveProjects } from '@/projects'
import { MONOREPO_TAG_FORMAT, tagMatchPattern } from '@/tags'
import { parseCommits } from '@/utils/commits'
import { recommendBump } from '@/versioning'
import { makeConfig, workspaceFiles } from './fixtures'
import {
  commitAll,
  createWorkspace,
  git,
  initGitRepo,
  writeFiles,
} from './helpers'

describe('pending commits with workspace deps', () => {
  let dir: string
  const originalCwd = process.cwd()

  async function getProject(
    name: string,
    config: BumpyConfig = makeConfig(),
  ): Promise<Project> {
    const projects = await resolveProjects(config, dir)
    return projects.find(p => p.name === name)!
  }

  async function pending(name: string, config?: BumpyConfig): Promise<boolean> {
    const project = await getProject(name, config)
    return hasPendingCommits(
      tagMatchPattern(MONOREPO_TAG_FORMAT, project.name),
      getProjectPaths(project),
    )
  }

  async function commitsSinceTag(name: string) {
    const project = await getProject(name)
    return parseCommits(
      await getCommits(`${name}@1.0.0..HEAD`, getProjectPaths(project)),
    )
  }

  beforeEach(async () => {
    dir = await createWorkspace(workspaceFiles)
    await initGitRepo(dir)
    await commitAll(dir, 'chore: init')
    for (const app of ['site', 'client', 'admin'])
      await git(dir, 'tag', `${app}@1.0.0`)
    process.chdir(dir)
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('has no pending commits right after a release', async () => {
    expect(await pending('site')).toBe(false)
    expect(await pending('client')).toBe(false)
    expect(await pending('admin')).toBe(false)
  })

  it('marks dependents of a changed internal package as pending', async () => {
    await writeFiles(dir, { 'packages/core/index.js': 'export {}' })
    await commitAll(dir, 'fix(core): rounding')

    expect(await pending('site')).toBe(true)
    expect(await pending('client')).toBe(true)
    // admin depends on core only through the released @acme/ui
    expect(await pending('admin')).toBe(false)
  })

  it('ignores internal packages when disabled', async () => {
    await writeFiles(dir, { 'packages/pricing/index.js': 'export {}' })
    await commitAll(dir, 'fix(pricing): rounding')

    expect(
      await pending('site', makeConfig({ includeWorkspaceDeps: false })),
    ).toBe(false)
  })

  it('includes dependency commits in history and bump recommendation', async () => {
    await writeFiles(dir, { 'apps/site/index.js': 'export {}' })
    await commitAll(dir, 'fix(site): typo')
    await writeFiles(dir, { 'packages/presets/index.js': 'export {}' })
    await commitAll(dir, 'feat(presets): new preset')
    await writeFiles(dir, { 'packages/pricing/index.js': 'export {}' })
    await commitAll(dir, 'fix(pricing): rounding')

    const site = await commitsSinceTag('site')
    expect(site.map(c => c.header)).toEqual([
      'fix(pricing): rounding',
      'fix(site): typo',
    ])
    expect(recommendBump(site)).toBe('patch')

    const client = await commitsSinceTag('client')
    expect(client.map(c => c.header)).toEqual([
      'fix(pricing): rounding',
      'feat(presets): new preset',
    ])
    expect(recommendBump(client)).toBe('minor')
  })
})
