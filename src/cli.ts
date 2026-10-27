/* eslint-disable node/prefer-global/process */
import type { Project } from '@/projects'
import type { BumpType } from '@/versioning'
import fs from 'node:fs/promises'
import path from 'node:path'
import * as p from '@clack/prompts'
import { Command } from 'commander'
import color from 'picocolors'
import { updateChangelog, updateWorkspaceChangelog } from '@/changelog'
import { initConfig, loadConfig } from '@/config'
import {
  commitFiles,
  createTag,
  getCommits,
  getLastTag,
  hasPendingCommits,
  hasRemote,
  isWorkingTreeClean,
  push,
} from '@/git'
import { getProjectPaths, resolveProjects } from '@/projects'
import { formatTag, resolveTagFormat, tagMatchPattern } from '@/tags'
import { parseCommits } from '@/utils/commits'
import { computeNextVersion, recommendBump } from '@/versioning'

const pkg = JSON.parse(
  await fs.readFile(new URL('../package.json', import.meta.url), 'utf-8'),
)

const program = new Command()

program
  .name('bumpy')
  .description('Zero-config, Git-powered versioning for monorepos')
  .version(pkg.version)

async function runRelease(projectName: string | undefined, options: any) {
  try {
    const config = await loadConfig()
    const projects = await resolveProjects(config)
    const tagFormat = await resolveTagFormat(
      config,
      projects,
      options.tagFormat,
    )

    if (projects.length > 1 && !tagFormat.includes('{name}')) {
      p.log.warn(
        color.yellow(
          `Tag format "${tagFormat}" has no {name} placeholder, so all projects will share the same tags.`,
        ),
      )
    }

    if (options.force) {
      p.note('Commit check skipped', color.yellow('Force mode'))
    }

    let project: Project | undefined

    if (projectName) {
      project = projects.find(p => p.name === projectName)
      if (!project) {
        p.cancel(`Project ${projectName} not found in configuration.`)
        return
      }
    }
    else {
      let candidates: Project[]

      if (options.force) {
        candidates = projects
      }
      else {
        const changes = await Promise.all(
          projects.map(p =>
            hasPendingCommits(
              tagMatchPattern(tagFormat, p.name),
              getProjectPaths(p),
            ),
          ),
        )
        candidates = projects.filter((_, i) => changes[i])
      }

      if (candidates.length === 0) {
        p.note('No projects with pending changes found', color.blue('Info'))
        return
      }

      const selectedProject = await p.select({
        message: 'Select project to release',
        options: candidates.map(p => ({
          value: p,
          label: `${p.name} (${p.version})`,
        })),
      })
      if (p.isCancel(selectedProject))
        return
      project = selectedProject as Project
    }

    if (!options.dryRun && !options.yes && !(await isWorkingTreeClean())) {
      const confirm = await p.confirm({
        message: 'Working tree is dirty. Continue anyway?',
        initialValue: false,
      })
      if (p.isCancel(confirm) || !confirm) {
        p.cancel('Aborted')
        return
      }
    }

    const lastTag = await getLastTag(tagMatchPattern(tagFormat, project.name))
    const range = lastTag ? `${lastTag}..HEAD` : 'HEAD'
    const rawCommits = await getCommits(range, getProjectPaths(project))
    const commits = parseCommits(rawCommits)

    let commitsSummary = `${commits.length}`
    if (getProjectPaths(project).length > 1 && commits.length > 0) {
      const ownCommits = await getCommits(range, [project.directory])
      const withDeps
        = project.include.length > 0
          ? await getCommits(
              range,
              getProjectPaths({ ...project, include: [] }),
            )
          : commits
      // A commit touching both a dependency and an included path counts once,
      // as a dependency commit
      const sources = [
        [withDeps.length - ownCommits.length, 'from workspace deps'],
        [commits.length - withDeps.length, 'from included paths'],
      ] as const
      const details = sources
        .filter(([count]) => count > 0)
        .map(([count, label]) => `${count} ${label}`)
      if (details.length > 0)
        commitsSummary += ` (${details.join(', ')})`
    }

    if (commits.length === 0 && !options.force) {
      p.note('No commits found since last release', color.blue('Info'))
      p.cancel('Release aborted.')
      return
    }

    let bumpType = options.type
    let customVersion = options.custom

    if (!bumpType) {
      const recommendation = commits.length > 0 ? recommendBump(commits) : null
      const nextPatch = computeNextVersion(project.version, 'patch')
      const nextMinor = computeNextVersion(project.version, 'minor')
      const nextMajor = computeNextVersion(project.version, 'major')
      const nextConv = recommendation
        ? computeNextVersion(project.version, recommendation)
        : null

      const bumpOptions = [
        ...(commits.length > 0
          ? [
              {
                value: 'conventional',
                label: `conventional ${nextConv ? `(${recommendation}: ${nextConv})` : '(none)'}`,
              },
            ]
          : []),
        { value: 'major', label: `major ${nextMajor}` },
        { value: 'minor', label: `minor ${nextMinor}` },
        { value: 'patch', label: `patch ${nextPatch}` },
        {
          value: 'prepatch',
          label: `pre-patch ${computeNextVersion(project.version, 'prepatch')}`,
        },
        {
          value: 'preminor',
          label: `pre-minor ${computeNextVersion(project.version, 'preminor')}`,
        },
        {
          value: 'premajor',
          label: `pre-major ${computeNextVersion(project.version, 'premajor')}`,
        },
        { value: 'as-is', label: `as-is ${project.version}` },
        { value: 'custom', label: 'custom ...' },
      ]

      const selectedBump = await p.select({
        message: `Select bump type for ${project.name} (current ${project.version})`,
        options: bumpOptions,
      })
      if (p.isCancel(selectedBump))
        return
      bumpType = selectedBump as string
    }

    if (bumpType === 'custom' && !customVersion) {
      const result = await p.text({
        message: 'Enter custom version',
        placeholder: '1.2.3',
        validate: val => (val ? undefined : 'Version is required'),
      })
      if (p.isCancel(result))
        return
      customVersion = result as string
    }

    const nextVersion = computeNextVersion(
      project.version,
      bumpType as BumpType,
      commits,
      customVersion,
    )

    const tagName = formatTag(tagFormat, project.name, nextVersion)

    const gitActions = [
      `Commit: ${config.release.git.commit ? color.green('Yes') : color.red('No')}`,
      `Tag: ${config.release.git.tag ? color.green('Yes') : color.red('No')}`,
      `Push: ${config.release.git.push ? color.green('Yes') : color.red('No')}`,
    ].join(' | ')

    p.note(
      `Project: ${project.name}\n`
      + `Version: ${project.version} -> ${color.green(nextVersion)}\n`
      + `Tag: ${color.green(tagName)}\n`
      + `New Commits: ${commitsSummary}\n${
        project.workspaceDeps.length > 0
          ? `Workspace Deps: ${project.workspaceDeps.map(d => d.name).join(', ')}\n`
          : ''
      }${
        project.include.length > 0
          ? `Included Paths: ${project.include.join(', ')}\n`
          : ''
      }\n`
      + `${gitActions}`,
      options.dryRun
        ? color.yellow('Release (Dry Run)')
        : color.yellow('Release'),
    )

    if (!options.yes) {
      const confirmRelease = await p.confirm({
        message: 'Proceed with release?',
        initialValue: true,
      })
      if (p.isCancel(confirmRelease) || !confirmRelease)
        return
    }

    const changedFiles: string[] = []
    const cwd = process.cwd()

    if (!options.dryRun) {
      const s = p.spinner()
      s.start('Releasing...')

      // 1. Update package.json
      const pkg = JSON.parse(
        await fs.readFile(project.packageJsonPath, 'utf-8'),
      )
      pkg.version = nextVersion
      await fs.writeFile(
        project.packageJsonPath,
        `${JSON.stringify(pkg, null, 2)}\n`,
      )
      s.message(
        `Updated ${color.cyan(path.relative(cwd, project.packageJsonPath))}`,
      )
      changedFiles.push(project.packageJsonPath)

      // 2. Update Project Changelog
      if (config.release.changelog.projectChangelogs) {
        const result = await updateChangelog(
          project.directory,
          nextVersion,
          commits,
          false,
          { repoUrl: project.repoUrl },
        )
        s.message(`Updated ${color.cyan(path.relative(cwd, result.path))}`)
        changedFiles.push(result.path)
      }

      // 3. Update Workspace Changelog
      if (config.release.changelog.workspaceChangelog) {
        const result = await updateWorkspaceChangelog(
          process.cwd(),
          project.name,
          nextVersion,
          commits,
          false,
          project.repoUrl,
        )
        s.message(`Updated ${color.cyan(path.relative(cwd, result.path))}`)
        changedFiles.push(result.path)
      }

      s.stop('Files updated')
    }
    else {
      // Dry Run Logic
      p.log.info(
        `Would update ${color.cyan(path.relative(cwd, project.packageJsonPath))} to version ${color.green(nextVersion)}`,
      )
      changedFiles.push(project.packageJsonPath)

      if (config.release.changelog.projectChangelogs) {
        const result = await updateChangelog(
          project.directory,
          nextVersion,
          commits,
          true,
          { repoUrl: project.repoUrl },
        )
        p.log.info(
          `Would update ${color.cyan(path.relative(cwd, result.path))}`,
        )
        p.note(result.content, 'New Changelog Content')
        changedFiles.push(result.path)
      }

      if (config.release.changelog.workspaceChangelog) {
        const result = await updateWorkspaceChangelog(
          process.cwd(),
          project.name,
          nextVersion,
          commits,
          true,
          project.repoUrl,
        )
        p.log.info(
          `Would update ${color.cyan(path.relative(cwd, result.path))}`,
        )
        if (!config.release.changelog.projectChangelogs) {
          p.note(result.content, 'New Workspace Changelog Content')
        }
        changedFiles.push(result.path)
      }
    }

    // 4. Git operations
    const uniqueFiles = Array.from(new Set(changedFiles))
    let commitMsg = `chore(release): ${tagName}`

    const rawCommitMsg
      = options.commitMessage || config.release.git.commitMessage

    if (rawCommitMsg) {
      commitMsg = rawCommitMsg
        .replace('{version}', nextVersion)
        .replace('{name}', project.name)
        .replace('{tag}', tagName)
    }

    if (config.release.git.commit) {
      const relFiles = uniqueFiles
        .map(f => color.cyan(path.relative(cwd, f)))
        .join(', ')
      p.log.step(
        `${options.dryRun ? 'Would commit' : 'Committing'}: ${relFiles}`,
      )
      p.log.step(`Message: ${commitMsg}`)
      await commitFiles(uniqueFiles, commitMsg, options.dryRun)
    }

    if (config.release.git.tag) {
      p.log.step(
        `${options.dryRun ? 'Would tag' : 'Tagging'}: ${color.green(tagName)}`,
      )
      await createTag(tagName, commitMsg, options.dryRun)
    }

    if (config.release.git.push) {
      const remoteExists = await hasRemote()
      if (remoteExists) {
        if (!options.dryRun) {
          const sPush = p.spinner()
          sPush.start('Pushing...')
          await push(options.dryRun)
          sPush.stop('Pushed')
        }
        else {
          p.log.step(`Would push commits and tags`)
        }
      }
      else {
        p.log.warn(color.yellow('No git remote found. Push skipped.'))
      }
    }

    p.outro(
      options.dryRun
        ? `Dry run finished for ${color.green(tagName)}`
        : `Successfully released ${color.green(tagName)}`,
    )
  }
  catch (e: any) {
    p.cancel(`Error: ${e.message}`)
  }
}

program
  .command('init')
  .description('Initialize bumpy.json')
  .action(async () => {
    try {
      await initConfig()
      p.note('bumpy.json created')
    }
    catch (e: any) {
      p.cancel(`Error: ${e.message}`)
    }
  })

program
  .command('status')
  .description('Show projects and their current versions')
  .action(async () => {
    try {
      const config = await loadConfig()
      const projects = await resolveProjects(config)
      const tagFormat = await resolveTagFormat(config, projects)

      const statusData = await Promise.all(
        projects.map(async (p) => {
          const tagPattern = tagMatchPattern(tagFormat, p.name)
          const lastTag = await getLastTag(tagPattern)
          const pending = await hasPendingCommits(
            tagPattern,
            getProjectPaths(p),
          )
          return {
            'Project': p.name,
            'Version': p.version,
            'Last Tag': lastTag || 'none',
            'Pending Changes': pending ? 'Yes' : 'No',
          }
        }),
      )

      console.log('')
      console.table(statusData)
      console.log('')
    }
    catch (e: any) {
      p.cancel(`Error: ${e.message}`)
    }
  })

program
  .command('release')
  .description('Release a project')
  .argument('[project]', 'Project name')
  .option(
    '--type <type>',
    'Bump type (patch, minor, major, conventional, as-is, custom, etc.)',
  )
  .option('--custom <version>', 'Custom version if type is custom')
  .option('--commit-message <message>', 'Commit message template')
  .option(
    '--tag-format <format>',
    'Tag name template, e.g. "v{version}" or "{name}@{version}"',
  )
  .option('--dry-run', 'Don\'t perform any changes', false)
  .option('--yes', 'Skip confirmation prompts', false)
  .option('--force', 'Allow release without pending commits', false)
  .action(runRelease)

// Handle default/interactive mode
if (process.argv.length === 2) {
  // If no args (just 'bumpy'), run interactive release
  runRelease(undefined, { dryRun: false, yes: false })
}
else {
  program.parse()
}
