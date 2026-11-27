import type { Repo } from "@liman/shared";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ApiRequestError } from "../api/client";
import { fetchRepos, LOGIN_PATH } from "../api/endpoints";
import { ErrorMessage, Loading, StaleWarning } from "./Status";

/** What to tell the user when GitHub's repository list cannot be loaded (API: 0.8). */
function describeError(error: Error): { message: ReactNode; retry: boolean } {
  if (error instanceof ApiRequestError) {
    if (error.status === 404) {
      return {
        message: (
          <>
            This installation no longer exists on GitHub.{" "}
            {/* Signing in again re-syncs installations (ADR-0002). */}
            <a href={LOGIN_PATH} className="font-medium underline">
              Sign in again
            </a>{" "}
            to refresh.
          </>
        ),
        retry: false,
      };
    }
    if (error.status === 409) {
      // Suspended since the last sign-in, or too many repositories; the API says which.
      return { message: error.message, retry: false };
    }
  }
  return { message: "Could not load repositories from GitHub.", retry: true };
}

/**
 * GitHub pages by offset, so a repository added or removed between two "Load more" clicks
 * can shift one onto the next page as well; keep the first copy.
 */
function uniqueById(repos: Repo[]): Repo[] {
  const seen = new Set<number>();
  return repos.filter((repo) => {
    if (seen.has(repo.id)) {
      return false;
    }
    seen.add(repo.id);
    return true;
  });
}

export function RepoList({
  installationId,
  onSelect,
}: {
  installationId: string;
  /** When given, each repository is a button that picks it (the new-app wizard). */
  onSelect?: (repo: Repo) => void;
}) {
  const repos = useInfiniteQuery({
    queryKey: ["repos", installationId],
    queryFn: ({ pageParam }) => fetchRepos(installationId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  if (repos.isPending) {
    return <Loading label="Loading repositories…" />;
  }
  // A failed refresh keeps the pages already on screen; only a failed first load replaces them.
  if (repos.data === undefined) {
    const { message, retry } = describeError(repos.error);
    return (
      <ErrorMessage
        onRetry={retry ? () => void repos.refetch() : undefined}
        retrying={repos.isFetching}
      >
        {message}
      </ErrorMessage>
    );
  }

  const items = uniqueById(repos.data.pages.flatMap((page) => page.items));
  const stale = repos.isRefetchError && (
    <StaleWarning>Could not refresh this list; showing the last one.</StaleWarning>
  );
  if (items.length === 0) {
    return (
      <div>
        {stale}
        <p className="text-sm text-slate-600">
          No repositories are shared with this installation yet.
        </p>
      </div>
    );
  }

  const nextPageError = repos.isFetchNextPageError ? describeError(repos.error) : null;
  return (
    <div>
      {stale}
      <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
        {items.map((repo) => (
          <li key={repo.id} className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-900">{repo.fullName}</span>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                {repo.private ? "Private" : "Public"}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-500">{repo.defaultBranch}</span>
              {onSelect && (
                <button
                  type="button"
                  onClick={() => {
                    onSelect(repo);
                  }}
                  aria-label={`Select ${repo.fullName}`}
                  className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-100"
                >
                  Select
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {nextPageError && (
        <div className="mt-3">
          <ErrorMessage
            onRetry={nextPageError.retry ? () => void repos.fetchNextPage() : undefined}
            retrying={repos.isFetchingNextPage}
          >
            {nextPageError.message}
          </ErrorMessage>
        </div>
      )}
      {repos.hasNextPage && !nextPageError && (
        <button
          type="button"
          onClick={() => void repos.fetchNextPage()}
          disabled={repos.isFetchingNextPage}
          className="mt-3 rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        >
          {repos.isFetchingNextPage ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
