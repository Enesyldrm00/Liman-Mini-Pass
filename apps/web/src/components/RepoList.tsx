import { useInfiniteQuery } from "@tanstack/react-query";
import { ApiRequestError } from "../api/client";
import { fetchRepos } from "../api/endpoints";
import { ErrorMessage, Loading } from "./Status";

/** What to tell the user when GitHub's repository list cannot be loaded (API: 0.8). */
function describeError(error: Error): { message: string; retry: boolean } {
  if (error instanceof ApiRequestError) {
    if (error.status === 404) {
      return {
        message: "This installation no longer exists on GitHub. Sign in again to refresh.",
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

export function RepoList({ installationId }: { installationId: string }) {
  const repos = useInfiniteQuery({
    queryKey: ["repos", installationId],
    queryFn: ({ pageParam }) => fetchRepos(installationId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  if (repos.isPending) {
    return <Loading label="Loading repositories…" />;
  }
  if (repos.isError && !repos.isFetchNextPageError) {
    const { message, retry } = describeError(repos.error);
    return (
      <ErrorMessage onRetry={retry ? () => void repos.refetch() : undefined}>
        {message}
      </ErrorMessage>
    );
  }

  const items = repos.data.pages.flatMap((page) => page.items);
  if (items.length === 0) {
    return (
      <p className="text-sm text-slate-600">
        No repositories are shared with this installation yet.
      </p>
    );
  }

  return (
    <div>
      <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
        {items.map((repo) => (
          <li key={repo.id} className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-900">{repo.fullName}</span>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                {repo.private ? "Private" : "Public"}
              </span>
            </div>
            <span className="text-xs text-slate-500">{repo.defaultBranch}</span>
          </li>
        ))}
      </ul>
      {repos.isFetchNextPageError && (
        <div className="mt-3">
          <ErrorMessage onRetry={() => void repos.fetchNextPage()}>
            {describeError(repos.error).message}
          </ErrorMessage>
        </div>
      )}
      {repos.hasNextPage && !repos.isFetchNextPageError && (
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
