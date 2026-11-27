import {
  SUBDOMAIN_MAX_LENGTH,
  appNameSchema,
  appPortSchema,
  healthPathSchema,
  subdomainSchema,
  type Installation,
  type Repo,
} from "@liman/shared";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type SubmitEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import type { z } from "zod";
import { ApiRequestError } from "../api/client";
import { createApp, fetchBranches, fetchInstallations } from "../api/endpoints";
import { APPS_QUERY_KEY } from "../components/AppList";
import { RepoList } from "../components/RepoList";
import { ErrorMessage, Loading } from "../components/Status";
import { InstallPrompt } from "./HomePage";

/** A first guess at a subdomain from the repository name: `My_Site.v2` → `my-site-v2`. */
export function suggestSubdomain(repoName: string): string {
  return repoName
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^xn--/, "")
    .slice(0, SUBDOMAIN_MAX_LENGTH)
    .replace(/^-+|-+$/g, "");
}

/** Readable text for the shared subdomain validator's reason codes. */
const SUBDOMAIN_REASONS: Record<string, string> = {
  empty: "Subdomain is required",
  too_long: `At most ${String(SUBDOMAIN_MAX_LENGTH)} characters`,
  invalid_chars: "Only lower-case letters, digits and hyphens",
  leading_or_trailing_hyphen: "Cannot start or end with a hyphen",
  punycode_prefix: "Cannot start with xn--",
  reserved: "This name is reserved",
};

function firstError(schema: z.ZodType, value: unknown): string | undefined {
  const result = schema.safeParse(value);
  if (result.success) {
    return undefined;
  }
  const issue = result.error.issues[0];
  const reason = (issue as { params?: { reason?: string } } | undefined)?.params?.reason;
  return (reason && SUBDOMAIN_REASONS[reason]) ?? issue?.message;
}

function Step({
  number,
  title,
  done,
  onChange,
  children,
}: {
  number: number;
  title: string;
  /** Summary shown once the step is complete. */
  done?: ReactNode;
  onChange?: () => void;
  children?: ReactNode;
}) {
  return (
    <section aria-label={title} className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-slate-900">
          {number}. {title}
          {done && <span className="ml-2 font-normal text-slate-600">{done}</span>}
        </h2>
        {done && onChange && (
          <button type="button" onClick={onChange} className="text-sm text-slate-700 underline">
            Change
          </button>
        )}
      </div>
      {!done && children && <div className="mt-3">{children}</div>}
    </section>
  );
}

function InstallationPicker({
  installations,
  onSelect,
}: {
  installations: Installation[];
  onSelect: (installation: Installation) => void;
}) {
  return (
    <ul className="space-y-2">
      {installations.map((installation) => (
        <li key={installation.id}>
          <button
            type="button"
            disabled={installation.suspended}
            onClick={() => {
              onSelect(installation);
            }}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-100 disabled:opacity-50"
          >
            {installation.accountLogin}
            {installation.suspended && " (suspended on GitHub)"}
          </button>
        </li>
      ))}
    </ul>
  );
}

function BranchPicker({
  installationId,
  repo,
  onSelect,
}: {
  installationId: string;
  repo: Repo;
  onSelect: (branch: string) => void;
}) {
  const branches = useInfiniteQuery({
    queryKey: ["branches", installationId, repo.id],
    queryFn: ({ pageParam }) => fetchBranches(installationId, repo.id, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
  const [chosen, setChosen] = useState<string | null>(null);

  if (branches.isPending) {
    return <Loading label="Loading branches…" />;
  }
  if (branches.data === undefined) {
    return (
      <ErrorMessage onRetry={() => void branches.refetch()} retrying={branches.isFetching}>
        Could not load branches from GitHub.
      </ErrorMessage>
    );
  }
  const names = branches.data.pages.flatMap((page) => page.items.map((branch) => branch.name));
  const selected = chosen ?? (names.includes(repo.defaultBranch) ? repo.defaultBranch : names[0]);
  if (selected === undefined) {
    return <p className="text-sm text-slate-600">This repository has no branches yet.</p>;
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="text-sm text-slate-700">
        Branch{" "}
        <select
          value={selected}
          onChange={(event) => {
            setChosen(event.target.value);
          }}
          className="ml-2 rounded-md border border-slate-300 px-2 py-1 text-sm"
        >
          {names.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      {branches.hasNextPage && (
        <button
          type="button"
          onClick={() => void branches.fetchNextPage()}
          disabled={branches.isFetchingNextPage}
          className="text-sm text-slate-700 underline disabled:opacity-50"
        >
          {branches.isFetchingNextPage ? "Loading…" : "Load more branches"}
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          onSelect(selected);
        }}
        className="rounded-md bg-slate-900 px-3 py-1 text-sm font-medium text-white hover:bg-slate-700"
      >
        Use this branch
      </button>
    </div>
  );
}

interface Fields {
  name: string;
  subdomain: string;
  port: string;
  healthPath: string;
}
type FieldName = keyof Fields;

function validate(fields: Fields): Partial<Record<FieldName, string>> {
  const errors: Partial<Record<FieldName, string>> = {};
  const name = firstError(appNameSchema, fields.name);
  const subdomain = firstError(subdomainSchema, fields.subdomain);
  const port = /^\d+$/.test(fields.port)
    ? firstError(appPortSchema, Number(fields.port))
    : "Port must be a number";
  const healthPath = firstError(healthPathSchema, fields.healthPath);
  if (name) errors.name = name;
  if (subdomain) errors.subdomain = subdomain;
  if (port) errors.port = port;
  if (healthPath) errors.healthPath = healthPath;
  return errors;
}

function TextField({
  label,
  name,
  value,
  error,
  hint,
  onChange,
}: {
  label: string;
  name: FieldName;
  value: string;
  error?: string;
  hint?: ReactNode;
  onChange: (value: string) => void;
}) {
  const errorId = `${name}-error`;
  return (
    <div>
      <label htmlFor={name} className="block text-sm font-medium text-slate-800">
        {label}
      </label>
      <input
        id={name}
        name={name}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
      />
      {hint && !error && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && (
        <p id={errorId} className="mt-1 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

function DetailsForm({
  installation,
  repo,
  branch,
  baseHost,
}: {
  installation: Installation;
  repo: Repo;
  branch: string;
  baseHost: string;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [fields, setFields] = useState<Fields>({
    name: repo.name,
    subdomain: suggestSubdomain(repo.name),
    port: "3000",
    healthPath: "/",
  });
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const create = useMutation({
    mutationFn: createApp,
    onSuccess: async (app) => {
      await client.invalidateQueries({ queryKey: APPS_QUERY_KEY });
      void navigate(`/apps/${app.id}`);
    },
    onError: (error) => {
      if (error instanceof ApiRequestError) {
        const fromApi: Partial<Record<FieldName, string>> = {};
        for (const field of error.fieldErrors) {
          if (field.path in fields) {
            fromApi[field.path as FieldName] = field.message;
          }
        }
        setErrors(fromApi);
      }
    },
  });

  const set = (name: FieldName) => (value: string) => {
    setFields((current) => ({ ...current, [name]: value }));
  };

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = validate(fields);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      return;
    }
    create.mutate({
      name: fields.name.trim(),
      subdomain: fields.subdomain,
      installationId: installation.id,
      repoId: repo.id,
      branch,
      port: Number(fields.port),
      healthPath: fields.healthPath,
    });
  }

  // Field errors are shown next to the fields; anything else goes above the button.
  const apiError =
    create.error instanceof ApiRequestError && create.error.fieldErrors.length === 0
      ? create.error.message
      : create.isError && !(create.error instanceof ApiRequestError)
        ? "Could not create the app."
        : null;

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <TextField
        label="Name"
        name="name"
        value={fields.name}
        error={errors.name}
        onChange={set("name")}
      />
      <TextField
        label="Subdomain"
        name="subdomain"
        value={fields.subdomain}
        error={errors.subdomain}
        hint={`Served at ${fields.subdomain || "…"}.${baseHost}. Cannot be changed later.`}
        onChange={set("subdomain")}
      />
      <TextField
        label="Port"
        name="port"
        value={fields.port}
        error={errors.port}
        hint="The port your app listens on; Liman passes it as PORT."
        onChange={set("port")}
      />
      <TextField
        label="Health path"
        name="healthPath"
        value={fields.healthPath}
        error={errors.healthPath}
        hint="Must answer 200–399 once the app is ready."
        onChange={set("healthPath")}
      />
      {apiError && <ErrorMessage>{apiError}</ErrorMessage>}
      <button
        type="submit"
        disabled={create.isPending}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {create.isPending ? "Creating…" : "Create app"}
      </button>
    </form>
  );
}

/** The host apps are served under, guessed from the panel's own host (`liman.<base>`). */
function baseHostFromLocation(): string {
  const host = window.location.host;
  return host.startsWith("liman.") ? host.slice("liman.".length) : host;
}

export function NewAppPage() {
  const installations = useQuery({ queryKey: ["installations"], queryFn: fetchInstallations });
  const [picked, setPicked] = useState<Installation | null>(null);
  const [repo, setRepo] = useState<Repo | null>(null);
  const [branch, setBranch] = useState<string | null>(null);

  if (installations.isPending) {
    return <Loading />;
  }
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
  if (list.length === 0) {
    return <InstallPrompt installUrl={installUrl} />;
  }
  const usable = list.filter((item) => !item.suspended);
  // With a single usable installation there is nothing to choose.
  const installation = picked ?? (usable.length === 1 ? (usable[0] ?? null) : null);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">New app</h1>
        <Link to="/" className="text-sm text-slate-700 underline">
          Cancel
        </Link>
      </div>
      <div className="mt-6 space-y-4">
        <Step
          number={1}
          title="GitHub account"
          done={installation?.accountLogin}
          onChange={
            list.length > 1
              ? () => {
                  setPicked(null);
                  setRepo(null);
                  setBranch(null);
                }
              : undefined
          }
        >
          <InstallationPicker installations={list} onSelect={setPicked} />
        </Step>
        {installation && (
          <Step
            number={2}
            title="Repository"
            done={repo?.fullName}
            onChange={() => {
              setRepo(null);
              setBranch(null);
            }}
          >
            <RepoList installationId={installation.id} onSelect={setRepo} />
          </Step>
        )}
        {installation && repo && (
          <Step
            number={3}
            title="Branch"
            done={branch}
            onChange={() => {
              setBranch(null);
            }}
          >
            <BranchPicker installationId={installation.id} repo={repo} onSelect={setBranch} />
          </Step>
        )}
        {installation && repo && branch && (
          <Step number={4} title="Details">
            <DetailsForm
              installation={installation}
              repo={repo}
              branch={branch}
              baseHost={baseHostFromLocation()}
            />
          </Step>
        )}
      </div>
    </div>
  );
}
