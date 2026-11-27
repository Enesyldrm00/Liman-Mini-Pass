import type { KeyObject } from "node:crypto";
import type { Branch, Repo } from "@liman/shared";
import { z } from "zod";
import { createAppJwt } from "./app-jwt.js";
import { GITHUB_API, GITHUB_HEADERS, githubFetch, hasNextPage, readJson } from "./http.js";
import { createTokenCache } from "./token-cache.js";

// Calls GitHub as the App: an App JWT mints installation tokens, and installation tokens
// read repositories (ROADMAP 0.8). Installation tokens live at most an hour; they are kept
// in memory until shortly before they expire and never logged.

/** A cached installation token is replaced once it has less than this left. */
export const TOKEN_REFRESH_BEFORE_MS = 5 * 60 * 1000;

/** GitHub's maximum page size for the list endpoints used here. */
const PER_PAGE = 100;

/** `findInstalledRepo` scans at most this many pages of the installation's repositories. */
export const MAX_REPO_SCAN_PAGES = 10;

export interface GitHubPage<T> {
  readonly items: T[];
  readonly hasNext: boolean;
}

export interface GitHubApp {
  /** Repositories the installation can access, one page (1-based) at a time. */
  listRepos(installationId: number, page: number): Promise<GitHubPage<Repo>>;
  /**
   * The repository if it is one of the installation's repositories, otherwise null.
   * Looked up in the installation's own list: an installation token can also read any
   * public repository, so `GET /repositories/:id` answering 200 proves nothing. Fails
   * with `installation_repos_too_many` past {@link MAX_REPO_SCAN_PAGES} pages.
   */
  findInstalledRepo(installationId: number, repoId: number): Promise<Repo | null>;
  listBranches(
    installationId: number,
    repoFullName: string,
    page: number,
  ): Promise<GitHubPage<Branch>>;
  /** The branch, or null when the repository has no branch of that name. */
  getBranch(installationId: number, repoFullName: string, branch: string): Promise<Branch | null>;
}

/**
 * A GitHub App API call failed. `reason` is safe to log. `status` is GitHub's HTTP status,
 * when there was one; a 404 from `installation_token` means the installation is gone.
 */
export class GitHubApiError extends Error {
  readonly reason: string;
  readonly status: number | undefined;

  constructor(reason: string, status?: number) {
    super(`GitHub API call failed: ${reason}`);
    this.name = "GitHubApiError";
    this.reason = reason;
    this.status = status;
  }
}

const fail = (reason: string, status?: number) => new GitHubApiError(reason, status);

const accessTokenSchema = z.object({
  token: z.string().min(1),
  expires_at: z.iso.datetime({ offset: true }),
});

const repoResponseSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  full_name: z.string(),
  private: z.boolean(),
  default_branch: z.string(),
});

const repoListSchema = z.object({ repositories: z.array(repoResponseSchema) });

const branchResponseSchema = z.object({ name: z.string(), commit: z.object({ sha: z.string() }) });
const branchListSchema = z.array(branchResponseSchema);

function toRepo(repo: z.infer<typeof repoResponseSchema>): Repo {
  return {
    id: repo.id,
    name: repo.name,
    fullName: repo.full_name,
    private: repo.private,
    defaultBranch: repo.default_branch,
  };
}

function parse<T>(schema: z.ZodType<T>, body: unknown, what: string): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw fail(`${what}_unexpected_response`);
  }
  return result.data;
}

/** `owner/name` → `/repos/owner/name`, each part escaped. */
function repoPath(fullName: string): string {
  const parts = fullName.split("/");
  if (parts.length !== 2 || parts.some((part) => part === "" || part === "." || part === "..")) {
    throw fail("invalid_repo_name");
  }
  return `/repos/${parts.map(encodeURIComponent).join("/")}`;
}

export interface GitHubAppOptions {
  appId: number;
  privateKey: KeyObject;
  fetch?: typeof fetch;
  now?: () => Date;
}

export function createGitHubApp(options: GitHubAppOptions): GitHubApp {
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());

  const tokens = createTokenCache({
    refreshBeforeMs: TOKEN_REFRESH_BEFORE_MS,
    now,
    mint: async (installationId) => {
      const jwt = createAppJwt(options.appId, options.privateKey, now());
      const response = await githubFetch(
        fetchImpl,
        "installation_token",
        `${GITHUB_API}/app/installations/${String(installationId)}/access_tokens`,
        {
          method: "POST",
          headers: {
            ...GITHUB_HEADERS,
            authorization: `Bearer ${jwt}`,
            "content-type": "application/json",
          },
          // The API only lists repositories and branches, so its tokens cannot read code
          // and a leaked one is worth less. The worker asks for contents in phase 1.
          body: JSON.stringify({ permissions: { metadata: "read" } }),
        },
        fail,
      );
      const body = parse(
        accessTokenSchema,
        await readJson(response, "installation_token", fail),
        "installation_token",
      );
      return { token: body.token, expiresAt: new Date(body.expires_at) };
    },
  });

  /**
   * GET with the installation's token. A 401 means GitHub no longer accepts the cached
   * token (revoked, or the clock drifted), so it is dropped and the next call mints a new
   * one. The request itself is not retried.
   */
  async function get(installationId: number, what: string, path: string): Promise<Response> {
    const token = await tokens.get(installationId);
    const response = await githubFetch(
      fetchImpl,
      what,
      `${GITHUB_API}${path}`,
      { headers: { ...GITHUB_HEADERS, authorization: `Bearer ${token}` } },
      fail,
    );
    if (response.status === 401) {
      tokens.invalidate(installationId);
    }
    return response;
  }

  const pageQuery = (page: number) => `per_page=${String(PER_PAGE)}&page=${String(page)}`;

  async function listRepos(installationId: number, page: number): Promise<GitHubPage<Repo>> {
    const response = await get(
      installationId,
      "repos",
      `/installation/repositories?${pageQuery(page)}`,
    );
    const body = parse(repoListSchema, await readJson(response, "repos", fail), "repos");
    return { items: body.repositories.map(toRepo), hasNext: hasNextPage(response) };
  }

  return {
    listRepos,

    async findInstalledRepo(installationId, repoId) {
      for (let page = 1; page <= MAX_REPO_SCAN_PAGES; page += 1) {
        const result = await listRepos(installationId, page);
        const repo = result.items.find((item) => item.id === repoId);
        if (repo) {
          return repo;
        }
        if (!result.hasNext) {
          return null;
        }
      }
      throw fail("installation_repos_too_many");
    },

    async listBranches(installationId, repoFullName, page) {
      const response = await get(
        installationId,
        "branches",
        `${repoPath(repoFullName)}/branches?${pageQuery(page)}`,
      );
      const body = parse(branchListSchema, await readJson(response, "branches", fail), "branches");
      return {
        items: body.map((branch) => ({ name: branch.name, commitSha: branch.commit.sha })),
        hasNext: hasNextPage(response),
      };
    },

    async getBranch(installationId, repoFullName, branch) {
      const response = await get(
        installationId,
        "branch",
        // One segment: a branch name can contain slashes, which are escaped here.
        `${repoPath(repoFullName)}/branches/${encodeURIComponent(branch)}`,
      );
      if (response.status === 404) {
        await response.body?.cancel().catch(() => undefined);
        return null;
      }
      const body = parse(branchResponseSchema, await readJson(response, "branch", fail), "branch");
      return { name: body.name, commitSha: body.commit.sha };
    },
  };
}
