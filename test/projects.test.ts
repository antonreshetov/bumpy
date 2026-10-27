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

describe('resolveProjects: included paths', () => {
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

  it('adds included paths after the project and its deps', async () => {
    const projects = await resolveProjects(
      makeConfig(
        {},
        {
          projects: [
            { path: 'apps/site', include: ['engine', 'Dockerfile'] },
            'apps/admin',
          ],
        },
      ),
      dir,
    )
    expect(projects.map(p => p.name).sort()).toEqual(['admin', 'site'])
    const site = projects.find(p => p.name === 'site')!
    expect(getProjectPaths(site)).toEqual([
      'apps/site',
      'packages/pricing',
      'packages/core',
      'engine',
      'Dockerfile',
    ])
    expect(projects.find(p => p.name === 'admin')!.include).toEqual([])
  })

  it('applies include to every project matched by a pattern', async () => {
    const projects = await resolveProjects(
      makeConfig({}, { projects: [{ path: 'apps/*', include: ['shared'] }] }),
      dir,
    )
    expect(projects.map(p => p.include)).toEqual([
      ['shared'],
      ['shared'],
      ['shared'],
    ])
  })

  it('merges include of entries matching the same project', async () => {
    const projects = await resolveProjects(
      makeConfig(
        {},
        {
          projects: [
            { path: 'apps/*', include: ['shared'] },
            { path: 'apps/site', include: ['engine', 'shared'] },
          ],
        },
      ),
      dir,
    )
    expect(projects.find(p => p.name === 'site')!.include).toEqual([
      'shared',
      'engine',
    ])
  })

  it('rejects unknown keys in a project entry', () => {
    expect(() =>
      makeConfig({}, { projects: [{ path: 'apps/site', includes: [] }] }),
    ).toThrow()
  })
})
