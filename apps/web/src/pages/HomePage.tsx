import { useQuery } from "@tanstack/react-query";
import { fetchInstallations } from "../api/endpoints";
import { Link } from "react-router";
import { AppList } from "../components/AppList";
import { ErrorMessage, Loading, StaleWarning } from "../components/Status";

export function HomePage() {
  const installations = useQuery({ queryKey: ["installations"], queryFn: fetchInstallations });

  if (installations.isPending) {
    return <Loading />;
  }
  // A failed refresh keeps the list already on screen; only a failed first load replaces it.
  if (installations.data === undefined) {
    return (
      <ErrorMessage
        onRetry={() => void installations.refetch()}
        retrying={installations.isFetching}
      >
        Could not load your GitHub installations.
      </ErrorMessage>
    );
  }

  const { installations: list, installUrl } = installations.data;
  const stale = installations.isRefetchError && (
    <StaleWarning>Could not refresh your GitHub installations; showing the last list.</StaleWarning>
  );
  if (list.length === 0) {
    return (
      <div>
        {stale}
        <InstallPrompt installUrl={installUrl} />
      </div>
    );
  }

  return (
    <div>
      {stale}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Apps</h1>
        <Link
          to="/apps/new"
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          New app
        </Link>
      </div>
      <div className="mt-6">
        <AppList />
      </div>
      <p className="mt-6 text-sm">
        <a href={installUrl} className="text-slate-700 underline">
          Install on another account or change repository access
        </a>
      </p>
    </div>
  );
}

/**
 * Shown until the user installs the GitHub App. GitHub sends them back through the Setup
 * URL, the API signs them in again to sync installations, and they land here (ADR-0002).
 */
export function InstallPrompt({ installUrl }: { installUrl: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-8">
      <h1 className="text-xl font-semibold text-slate-900">Install the Liman GitHub App</h1>
      <p className="mt-2 text-sm text-slate-600">
        Liman reads your code through its GitHub App. You choose which repositories it can see on
        GitHub&apos;s installation screen.
      </p>
      <a
        href={installUrl}
        className="mt-6 inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
      >
        Install on GitHub
      </a>
    </div>
  );
}
