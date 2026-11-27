import type { App } from "@liman/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ApiRequestError } from "../api/client";
import { deleteApp, fetchApp } from "../api/endpoints";
import { APPS_QUERY_KEY, AppStatusBadge } from "../components/AppList";
import { EnvEditor } from "../components/EnvEditor";
import { ErrorMessage, Loading } from "../components/Status";

function DeleteApp({ app }: { app: App }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation({
    mutationFn: () => deleteApp(app.id),
    onSuccess: async (updated) => {
      client.setQueryData(["app", app.id], updated);
      await client.invalidateQueries({ queryKey: APPS_QUERY_KEY });
      void navigate("/");
    },
  });

  if (app.status === "deleting") {
    return (
      <p className="text-sm text-slate-600">
        This app is being deleted. Its containers and data are removed in the background.
      </p>
    );
  }
  return (
    <div>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-slate-800">
            Delete <strong>{app.subdomain}</strong>? Its deployments and variables are removed.
          </span>
          <button
            type="button"
            onClick={() => {
              remove.mutate();
            }}
            disabled={remove.isPending}
            className="rounded-md bg-red-700 px-3 py-1 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50"
          >
            {remove.isPending ? "Deleting…" : "Yes, delete"}
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirming(false);
            }}
            className="text-sm text-slate-700 underline"
          >
            Keep it
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setConfirming(true);
          }}
          className="rounded-md border border-red-300 px-3 py-1 text-sm text-red-800 hover:bg-red-50"
        >
          Delete app
        </button>
      )}
      {remove.isError && (
        <div className="mt-3">
          <ErrorMessage>Could not delete the app. Please try again.</ErrorMessage>
        </div>
      )}
    </div>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-900">{children}</dd>
    </div>
  );
}

export function AppPage() {
  const { id = "" } = useParams();
  const app = useQuery({ queryKey: ["app", id], queryFn: () => fetchApp(id) });

  if (app.isPending) {
    return <Loading />;
  }
  if (app.data === undefined) {
    const notFound =
      app.error instanceof ApiRequestError && [400, 403, 404].includes(app.error.status);
    return notFound ? (
      <div>
        <h1 className="text-xl font-semibold text-slate-900">App not found</h1>
        <Link to="/" className="mt-4 inline-block text-sm text-slate-700 underline">
          Back to your apps
        </Link>
      </div>
    ) : (
      <ErrorMessage onRetry={() => void app.refetch()} retrying={app.isFetching}>
        Could not load the app.
      </ErrorMessage>
    );
  }

  const data = app.data;
  const deleting = data.status === "deleting";
  return (
    <div className="space-y-6">
      <div>
        <Link to="/" className="text-sm text-slate-600 hover:underline">
          ← Apps
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-xl font-semibold text-slate-900">{data.name}</h1>
          <AppStatusBadge status={data.status} />
        </div>
        <a
          href={data.url}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-slate-700 underline"
        >
          {data.url}
        </a>
      </div>

      <dl className="grid grid-cols-2 gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-4">
        <Detail label="Repository">{data.repoFullName}</Detail>
        <Detail label="Branch">{data.branch}</Detail>
        <Detail label="Port">{data.port}</Detail>
        <Detail label="Health path">{data.healthPath}</Detail>
      </dl>

      <section
        aria-labelledby="env-heading"
        className="rounded-lg border border-slate-200 bg-white p-4"
      >
        <h2 id="env-heading" className="text-base font-medium text-slate-900">
          Environment variables
        </h2>
        <div className="mt-3">
          <EnvEditor appId={data.id} disabled={deleting} />
        </div>
      </section>

      <section
        aria-labelledby="danger-heading"
        className="rounded-lg border border-red-200 bg-white p-4"
      >
        <h2 id="danger-heading" className="text-base font-medium text-red-900">
          Delete
        </h2>
        <div className="mt-3">
          <DeleteApp app={data} />
        </div>
      </section>
    </div>
  );
}
