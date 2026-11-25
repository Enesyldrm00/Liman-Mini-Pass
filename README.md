# Liman

A small self-hosted PaaS: push to GitHub, Liman builds the image, deploys it and serves it on its own subdomain.

> Work in progress. The full plan lives in [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Requirements

- Node.js 26 (see `.nvmrc`)
- pnpm 12 (`npm i -g pnpm@12.19.0`)

## Commands

| Command          | What it does                          |
| ---------------- | ------------------------------------- |
| `pnpm install`   | Install all workspace dependencies    |
| `pnpm build`     | Build every package                   |
| `pnpm lint`      | Run ESLint (typescript-eslint strict) |
| `pnpm typecheck` | Type-check every package              |
| `pnpm test`      | Run all Vitest projects               |
| `pnpm format`    | Format the repo with Prettier         |

## Layout

```
apps/api        Express API (webhook, SSE)
apps/worker     Build and deploy worker
apps/web        React panel
packages/shared Zod schemas, types, constants
```
