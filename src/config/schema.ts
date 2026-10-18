import { z } from 'zod'

export const BumpyConfigSchema = z
  .object({
    projects: z.array(z.string()).optional(),
    release: z
      .object({
        ignore: z.array(z.string()).default([]),
        includeWorkspaceDeps: z.boolean().default(true),
        changelog: z
          .object({
            projectChangelogs: z.boolean().default(true),
            workspaceChangelog: z.boolean().default(false),
          })
          .default({
            projectChangelogs: true,
            workspaceChangelog: false,
          }),
        git: z
          .object({
            commit: z.boolean().default(true),
            tag: z.boolean().default(true),
            push: z.boolean().default(true),
            commitMessage: z.string().optional(),
            tagFormat: z
              .string()
              .refine(v => v.includes('{version}'), {
                message: 'tagFormat must include the {version} placeholder',
              })
              .optional(),
          })
          .default({
            commit: true,
            tag: true,
            push: true,
          }),
      })
      .default({
        ignore: [],
        includeWorkspaceDeps: true,
        changelog: {
          projectChangelogs: true,
          workspaceChangelog: false,
        },
        git: {
          commit: true,
          tag: true,
          push: true,
        },
      }),
  })
  .strict()

export type BumpyConfig = z.infer<typeof BumpyConfigSchema>
