# Liman

[![CI](https://github.com/Enesyldrm00/Liman-Mini-Pass/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Enesyldrm00/Liman-Mini-Pass/actions/workflows/ci.yml)

A small self-hosted PaaS: push to GitHub, Liman builds the image, deploys it and serves it on its own subdomain.

> Work in progress. The full plan lives in [`docs/ROADMAP.md`](docs/ROADMAP.md).

## How it works

1. You sign in with GitHub, install the Liman GitHub App and pick a repository and branch.
2. A `push` to that branch reaches the API as a signed webhook. The API records a build and queues it.
3. The worker clones the commit, builds an image with the repository's `Dockerfile` and pushes it to Liman's registry.
4. The worker starts the new version, waits for its health check and only then moves traffic to it. If the check fails, the old version keeps running.
5. The app is served at `<subdomain>.<your-domain>`. Build logs stream live to the panel.

PostgreSQL is the source of truth for every state change; Redis carries the job queue and live logs.

## Status

| Phase | What                                                       | Version  | State   |
| ----- | ---------------------------------------------------------- | -------- | ------- |
| 0     | Skeleton: monorepo, local stack, GitHub sign-in, repo list | `v0.1.0` | Done    |
| 1     | Build and deploy with Docker                               | `v0.2.0` | Next    |
| 2     | Kubernetes (k3s), isolated builds                          | `v0.3.0` | Planned |
| 3     | Observability, Helm, self-deploy                           | `v0.4.0` | Planned |
| 4     | Live on a VPS with TLS and backups                         | `v1.0.0` | Planned |

Today the panel signs you in and lists your repositories; builds and deploys arrive in Phase 1.

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

Requires Docker and a filled-in `.env` (copy `.env.example`; GitHub values from [`docs/github-app-setup.md`](docs/github-app-setup.md)). Without it the API refuses to start. Starts Postgres, Redis, a registry, Traefik, api, worker and web:

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

Sign-in, repository access and webhooks go through a GitHub App. For development, create your own development App (ours is `liman-dev-06`) and store its credentials in `.env` and `secrets/` (both git-ignored); the steps are in [`docs/github-app-setup.md`](docs/github-app-setup.md).

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

## App contract

A repository deployed on Liman must follow these rules:

- A `Dockerfile` at the repository root (no buildpacks).
- The app listens on `0.0.0.0:$PORT`, not `127.0.0.1`. Liman sets `PORT` to the port configured for the app.
- The health path (default `/`) returns 200–399 once the app is ready; traffic only moves to a healthy version.
- On `SIGTERM` the app shuts down cleanly within 25 seconds.
- The app is stateless; the container disk is lost on restart.
- Secrets are not needed at build time; environment variables are given only at runtime.
- It fits within 256 MB of memory and 0.5 CPU by default.

## Documentation

- [`docs/ROADMAP.md`](docs/ROADMAP.md): scope, architecture, state machines and the phase plan (Turkish)
- [`docs/adr/`](docs/adr/): architecture decision records (Turkish)
- [`docs/NOTES.md`](docs/NOTES.md): phase notes and known weak spots (Turkish)
- [`docs/github-app-setup.md`](docs/github-app-setup.md): creating the development GitHub App
