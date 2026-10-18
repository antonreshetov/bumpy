import type { Project } from '@/projects'
import fs from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getProjectPaths, resolveProjects } from '@/projects'
import { makeConfig, workspaceFiles } from './fixtures'
import { createWorkspace } from './helpers'

function depsOf(projects: Project[], name: string): string[] {
  const project = projects.find(p => p.name === name)
  if (!project)
    throw new Error(`Project ${name} not found`)
  return project.workspaceDeps.map(d => d.name)
}

describe('resolveProjects: workspace deps', () => {
  let dir: string
  const originalCwd = process.cwd()

  beforeEach(async () => {
    dir = await createWorkspace(workspaceFiles)
    process.chdir(dir)
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('does not release ignored packages', async () => {
    const projects = await resolveProjects(makeConfig(), dir)
    expect(projects.map(p => p.name).sort()).toEqual([
      '@acme/ui',
      'admin',
      'client',
      'site',
    ])
  })

  it('follows internal deps transitively', async () => {
    const projects = await resolveProjects(makeConfig(), dir)
    expect(depsOf(projects, 'site')).toEqual(['@acme/pricing', '@acme/core'])
  })

  it('matches npm-style ranges, all dependency fields and survives cycles', async () => {
    const projects = await resolveProjects(makeConfig(), dir)
    expect(depsOf(projects, 'client')).toEqual([
      '@acme/presets',
      '@acme/pricing',
      '@acme/themes',
      '@acme/core',
    ])
  })

  it('does not follow released packages', async () => {
    const projects = await resolveProjects(makeConfig(), dir)
    expect(depsOf(projects, 'admin')).toEqual([])
    expect(depsOf(projects, '@acme/ui')).toEqual(['@acme/core'])
  })

  it('returns project and dependency directories as paths', async () => {
    const projects = await resolveProjects(makeConfig(), dir)
    const site = projects.find(p => p.name === 'site')!
    expect(getProjectPaths(site)).toEqual([
      'apps/site',
      'packages/pricing',
      'packages/core',
    ])
  })

  it('treats packages left out of `projects` as internal', async () => {
    const projects = await resolveProjects(
      makeConfig({ ignore: [] }, { projects: ['apps/*'] }),
      dir,
    )
    expect(projects.map(p => p.name).sort()).toEqual([
      'admin',
      'client',
      'site',
    ])
    expect(depsOf(projects, 'admin')).toEqual(['@acme/ui', '@acme/core'])
  })

  it('can be disabled', async () => {
    const projects = await resolveProjects(
      makeConfig({ includeWorkspaceDeps: false }),
      dir,
    )
    expect(projects.every(p => p.workspaceDeps.length === 0)).toBe(true)
  })

  it('is enabled by default', () => {
    expect(makeConfig().release.includeWorkspaceDeps).toBe(true)
  })
})
