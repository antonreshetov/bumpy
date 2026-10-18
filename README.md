# Bumpy

Zero-config, Git-powered versioning for monorepos.

`bumpy` is a CLI tool designed for developers who want streamlined versioning and changelog management without the overhead of complex configurations or the "ceremony" of hidden state files.

## Features

- **Zero Config:** Automatically detects projects using `package.json` workspaces, `pnpm-workspace.yaml`, or standard `apps/*` and `packages/*` structures.
- **Granular Changelogs:** Generates `CHANGELOG.md` for each project based on its own Git history.
- **Internal Packages Awareness:** Changes in unreleased workspace packages count as changes of the projects that depend on them.
- **Conventional Intelligence:** Recommends the next version based on Conventional Commits.
- **Tag-based Boundaries:** Uses tags like `projectName@version` to determine the history range.
- **Customizable Tags:** Override the tag template per repo (e.g. `v{version}` for single-package repos).
- **Prerelease Support:** Built-in support for `prepatch`, `preminor`, and `premajor`.
- **Workspace Changelog:** Optional unified changelog at the root of the monorepo.
- **Dry Run:** Preview all changes before they are applied.

## Why Bumpy?

While tools like **Changesets** or **Nx Release** are powerful, they are optimized for specific workflows that might introduce additional complexity for simpler projects. Bumpy aims for a balance of automation and **predictable interactivity**.

## vs Changesets

Changesets follows a file-based workflow, requiring you to accumulate temporary markdown "intent" files to declare version bumps. This introduces a different set of trade-offs:

- **Interactive Overhead:** Even for a tiny fix, Changesets often requires a repetitive sequence of questions (Major? Minor? Patch?) for each modified package. In large monorepos, this can be time-consuming.

- **Manual Documentation:** It requires manual entry of change descriptions during the CLI flow, which can be redundant if your commit messages are already descriptive.

- **Limited Flexibility:** It’s often difficult to quickly target specific formats like pre-releases or simply enter a custom version on the fly.

**Bumpy** reads your Git history directly at the moment of release.

- **Conventional Intelligence:** It automatically analyzes your commits and recommends the next version (e.g., suggesting a `patch` for a `fix` or a `minor` for a `feat`).

- **One-Step Release:** Confirm pre-selected version bumps and generate instant changelogs in a single view. While Bumpy suggests the most logical choice, you can easily pick a different level or enter a custom version when needed.

## vs Nx Release

Nx Release is a robust solution deeply integrated into the Nx ecosystem, enabling powerful CI automation and dependency graph analysis. However, it is designed around the Nx infrastructure and its specific architectural patterns and configuration files.

**Bumpy** is standalone and lightweight:

- **Zero Lock-in:** It’s a standalone CLI. You don't need to adopt a new build system or add Nx-specific metadata to your packages.

- **Infrastructure Agnostic:** Bumpy adapts to your project, not the other way around. It automatically discovers your packages by scanning `package.json` workspaces or `pnpm-workspace.yaml`. Whether you use Turborepo, pnpm, or npm, Bumpy works with your existing setup out-of-the-box.

- **Lightweight:** No heavy background daemons or complex graphs—just direct Git history analysis when you’re ready to release.

## Installation

You can install it globally or as a dev dependency in your project.

```bash
# Global installation
npm install -g @antonreshetov/bumpy

# Local project installation
pnpm add -D @antonreshetov/bumpy
```

## Configuration (`bumpy.json`)

Configuration is **optional**. By default, `bumpy` resolves projects using your workspace configuration (e.g., `pnpm-workspace.yaml` or `package.json` workspaces).

If you need to customize this (e.g., explicitly define projects, ignore some, or enable workspace changelog), run `bumpy init` to generate a config file:

```json
{
  "projects": ["apps/*", "packages/*"],
  "release": {
    "ignore": ["apps/internal-tool"],
    "includeWorkspaceDeps": true,
    "changelog": {
      "projectChangelogs": true,
      "workspaceChangelog": false
    },
    "git": {
      "commit": true,
      "tag": true,
      "push": true,
      "commitMessage": "chore(release): {tag}",
      "tagFormat": "{name}@{version}"
    }
  }
}
```

### Internal Workspace Packages

Workspace packages that are not released themselves (excluded via `release.ignore` or left out of `projects`) usually ship inside the apps that depend on them. With `includeWorkspaceDeps` enabled (default), Bumpy follows the `dependencies`, `devDependencies`, `peerDependencies` and `optionalDependencies` of each project, transitively, and treats commits in those internal packages as commits of the project:

- they make the project show up as having pending changes;
- they are included in the project's changelog;
- they are taken into account when recommending the next version.

For example, with `"ignore": ["packages/**"]` and `apps/site` depending on `@acme/pricing` (`"workspace:*"`), a commit that only touches `packages/pricing` is released as part of `apps/site`.

Released packages are not followed: they have their own versions and changelogs. Set `includeWorkspaceDeps` to `false` to only consider commits inside the project's own directory.

### Tag Format

`tagFormat` controls the name of the created tag and the tag mask used to find the previous release. Placeholders:

- `{name}`: The name of the project.
- `{version}`: The new version being released (required).

If `tagFormat` is omitted, it is detected from the repository:

| Layout | Default | Example |
| --- | --- | --- |
| Monorepo (multiple packages, or a package outside the root) | `{name}@{version}` | `project-a@1.2.3` |
| Single package in the repository root | `v{version}` | `v1.2.3` |
| Single package that already has `{name}@{version}` tags | `{name}@{version}` | `my-lib@1.2.3` |

Set it explicitly to keep any other convention:

```json
{
  "release": {
    "git": {
      "tagFormat": "release/{version}"
    }
  }
}
```

It can also be overridden per run with `--tag-format`:

```bash
bumpy release --tag-format "v{version}"
```

> **Note:** Changing the tag format changes which tags Bumpy looks for. Existing tags in the old format are no longer matched, so the next release will read the full commit history. To switch an existing repo to a new format, create a tag in the new format on the last release commit first (e.g. `git tag v1.2.3 my-lib@1.2.3`).

### Commit Message Placeholders

When customizing `commitMessage`, you can use the following placeholders:

- `{name}`: The name of the project.
- `{version}`: The new version being released.
- `{tag}`: The full tag name (e.g., `project-a@1.2.3`).

## Usage

### Interactive Mode

Simply run the command to start the interactive release process. It will show only projects with pending changes.

```bash
bumpy
```

### Show Status

See current versions, last tags, and whether there are pending changes for each project:

```bash
bumpy status
```

### CLI Release

Release a specific project non-interactively:

```bash
bumpy release project-a --type minor --yes
```

### Dry Run

Preview changes without modifying any files or Git state:

```bash
bumpy release --dry-run
```

## Options

- `--type <type>`: Bump type (`patch`, `minor`, `major`, `conventional`, `prepatch`, `preminor`, `premajor`, `as-is`, `custom`).
- `--custom <version>`: Specify a custom version (used with `--type custom`).
- `--tag-format <format>`: Tag name template, e.g. `v{version}` or `{name}@{version}`.
- `--commit-message <message>`: Commit message template.
- `--force`: Allow a release even when there are no pending commits.
- `--yes`: Skip all confirmation prompts.
- `--dry-run`: Show what would happen without making any changes.

Copyright (c) 2026-present, [Anton Reshetov](https://github.com/antonreshetov).
