import type { App } from "@liman/shared";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { fetchApps } from "../api/endpoints";
import { ErrorMessage, Loading, StaleWarning } from "./Status";

export const APPS_QUERY_KEY = ["apps"] as const;

export function AppStatusBadge({ status }: { status: App["status"] }) {
  return status === "deleting" ? (
    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">Deleting</span>
  ) : (
    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-900">Active</span>
  );
}

export function AppList() {
  const apps = useInfiniteQuery({
    queryKey: APPS_QUERY_KEY,
    queryFn: ({ pageParam }) => fetchApps(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  if (apps.isPending) {
    return <Loading label="Loading apps…" />;
  }
  if (apps.data === undefined) {
    return (
      <ErrorMessage onRetry={() => void apps.refetch()} retrying={apps.isFetching}>
        Could not load your apps.
      </ErrorMessage>
    );
  }

  const items = apps.data.pages.flatMap((page) => page.items);
  const stale = apps.isRefetchError && (
    <StaleWarning>Could not refresh your apps; showing the last list.</StaleWarning>
  );
  if (items.length === 0) {
    return (
      <div>
        {stale}
        <p className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600">
          No apps yet. Create one from a repository to deploy it on its own subdomain.
        </p>
      </div>
    );
  }

  return (
    <div>
      {stale}
      <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
        {items.map((app) => (
          <li key={app.id} className="flex items-center justify-between px-4 py-3">
            <div>
              <Link
                to={`/apps/${app.id}`}
                className="text-sm font-medium text-slate-900 hover:underline"
              >
                {app.name}
              </Link>
              <p className="text-xs text-slate-500">
                {app.repoFullName} · {app.branch}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-600">{app.subdomain}</span>
              <AppStatusBadge status={app.status} />
            </div>
          </li>
        ))}
      </ul>
      {apps.isFetchNextPageError && (
        <div className="mt-3">
          <ErrorMessage
            onRetry={() => void apps.fetchNextPage()}
            retrying={apps.isFetchingNextPage}
          >
            Could not load more apps.
          </ErrorMessage>
        </div>
      )}
      {apps.hasNextPage && !apps.isFetchNextPageError && (
        <button
          type="button"
          onClick={() => void apps.fetchNextPage()}
          disabled={apps.isFetchingNextPage}
          className="mt-3 rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        >
          {apps.isFetchingNextPage ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
