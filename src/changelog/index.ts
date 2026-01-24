import type { ParsedCommit } from '../utils/commits.js'
import fs from 'node:fs/promises'
import path from 'node:path'

export interface UpdateChangelogOptions {
  projectName?: string
  repoUrl?: string
}

export async function updateChangelog(
  projectDir: string,
  newVersion: string,
  commits: ParsedCommit[],
  dryRun: boolean,
  options: UpdateChangelogOptions = {},
): Promise<{ path: string, content: string }> {
  const { projectName, repoUrl } = options
  const changelogPath = path.join(projectDir, 'CHANGELOG.md')
  const date = new Date().toISOString().split('T')[0]

  const sections: Record<string, string[]> = {
    'Features': [],
    'Bug Fixes': [],
    'Breaking Changes': [],
    'Other': [],
  }

  for (const commit of commits) {
    const scope = commit.scope ? `**${commit.scope}:** ` : ''
    const subject
      = commit.subject || commit.header || commit.raw.split('\n')[0]

    const hash = commit.hash?.substring(0, 7) || 'n/a'
    const hashLink
      = repoUrl && commit.hash
        ? `[${hash}](${repoUrl}/commit/${commit.hash})`
        : hash

    const message = `${scope}${subject} (${hashLink})`

    if (
      commit.notes.some(n => n.title === 'BREAKING CHANGE')
      || commit.header?.includes('!')
    ) {
      sections['Breaking Changes'].push(message)
    }
    else if (commit.type === 'feat') {
      sections.Features.push(message)
    }
    else if (commit.type === 'fix') {
      sections['Bug Fixes'].push(message)
    }
    else {
      sections.Other.push(message)
    }
  }

  const titlePrefix = projectName ? `${projectName} ` : ''
  let newContent = `## ${titlePrefix}${newVersion} (${date})\n\n`

  for (const [title, msgs] of Object.entries(sections)) {
    if (msgs.length > 0) {
      newContent += `### ${title}\n\n`
      newContent += `${msgs.map(m => `- ${m}`).join('\n')}\n\n`
    }
  }

  if (commits.length === 0) {
    newContent += '_No significant changes._\n\n'
  }

  if (dryRun) {
    return { path: changelogPath, content: newContent }
  }

  let existingContent = ''
  try {
    existingContent = await fs.readFile(changelogPath, 'utf-8')
  }
  catch {
    existingContent = `# Changelog\n\nAll notable changes to this project will be documented in this file.\n\n`
  }

  const headerMatch = existingContent.match(/^# Changelog\n\n/)
  if (headerMatch) {
    const header = headerMatch[0]
    const rest = existingContent.slice(header.length)
    await fs.writeFile(changelogPath, header + newContent + rest)
  }
  else {
    await fs.writeFile(changelogPath, newContent + existingContent)
  }

  return { path: changelogPath, content: newContent }
}

export async function updateWorkspaceChangelog(
  cwd: string,
  projectName: string,
  newVersion: string,
  commits: ParsedCommit[],
  dryRun: boolean,
  repoUrl?: string,
): Promise<{ path: string, content: string }> {
  return updateChangelog(cwd, newVersion, commits, dryRun, {
    projectName,
    repoUrl,
  })
}
