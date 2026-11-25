# Liman

A small self-hosted PaaS: push to GitHub, Liman builds the image, deploys it and serves it on its own subdomain.

> Work in progress. The full plan lives in [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Requirements

- Node.js 26 (see `.nvmrc`)
- pnpm 12 (`npm i -g pnpm@12.19.0`)

## Commands

| Command          | What it does                                              |
| ---------------- | --------------------------------------------------------- |
| `pnpm install`   | Install all workspace dependencies                        |
| `pnpm build`     | Build every package                                       |
| `pnpm lint`      | Run ESLint (typescript-eslint strict)                     |
| `pnpm typecheck` | Type-check every package                                  |
| `pnpm test`      | Run all Vitest projects (needs Docker for database tests) |
| `pnpm format`    | Format the repo with Prettier                             |

## Local stack

Requires Docker. Starts Postgres, Redis, a registry, Traefik, api, worker and web:

```sh
pnpm stack:up      # build and start, wait until healthy
pnpm stack:watch   # same, plus live sync of source changes
pnpm stack:down
```

| URL                                | What                           |
| ---------------------------------- | ------------------------------ |
| http://liman.localhost             | Panel                          |
| http://liman.localhost/api         | API                            |
| http://127.0.0.1:8080              | Traefik dashboard (local only) |
| `localhost:5433`                   | Postgres (`liman` / `liman`)   |
| `localhost:6379`, `localhost:5000` | Redis, registry                |

## GitHub App

Sign-in, repository access and webhooks go through a GitHub App. For development, create your own `liman-dev-06` App and store its credentials in `.env` and `secrets/` (both git-ignored); the steps are in [`docs/github-app-setup.md`](docs/github-app-setup.md).

## Layout

```
apps/api        Express API (webhook, SSE)
apps/worker     Build and deploy worker
apps/web        React panel
packages/shared Zod schemas, types, constants
packages/db     Drizzle schema, migrations, database client
```

## Database

The schema lives in `packages/db/src/schema.ts`; SQL migrations are generated into `packages/db/migrations` and committed.

```sh
pnpm --filter @liman/db generate --name <change>   # write a new migration after editing the schema
pnpm --filter @liman/db migrate                    # apply migrations (uses DATABASE_URL)
```

In the local stack the one-shot `migrate` service applies them before api and worker start.
