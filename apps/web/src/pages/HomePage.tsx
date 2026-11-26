import type { Installation } from "@liman/shared";
import { useQuery } from "@tanstack/react-query";
import { fetchInstallations } from "../api/endpoints";
import { RepoList } from "../components/RepoList";
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
        <h1 className="text-xl font-semibold text-slate-900">Repositories</h1>
        <a href={installUrl} className="text-sm text-slate-700 underline">
          Install on another account or change repository access
        </a>
      </div>
      <div className="mt-6 space-y-8">
        {list.map((installation) => (
          <InstallationSection key={installation.id} installation={installation} />
        ))}
      </div>
    </div>
  );
}

/**
 * Shown until the user installs the GitHub App. GitHub sends them back through the Setup
 * URL, the API signs them in again to sync installations, and they land here (ADR-0002).
 */
function InstallPrompt({ installUrl }: { installUrl: string }) {
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

function InstallationSection({ installation }: { installation: Installation }) {
  return (
    <section aria-labelledby={`installation-${installation.id}`}>
      <h2
        id={`installation-${installation.id}`}
        className="flex items-center gap-2 text-base font-medium text-slate-900"
      >
        {installation.accountLogin}
        {installation.accountType === "Organization" && (
          <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs font-normal text-slate-700">
            Organization
          </span>
        )}
      </h2>
      <div className="mt-3">
        {installation.suspended ? (
          <p
            role="alert"
            className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
          >
            This installation is suspended on GitHub. Unsuspend it there to see its repositories.
          </p>
        ) : (
          <RepoList installationId={installation.id} />
        )}
      </div>
    </section>
  );
}
