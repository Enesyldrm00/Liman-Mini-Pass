import { MAX_ENV_VARS, envKeySchema, envValueSchema, type EnvList } from "@liman/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type SubmitEvent } from "react";
import { ApiRequestError } from "../api/client";
import { fetchEnv, replaceEnv } from "../api/endpoints";
import { ErrorMessage, Loading } from "./Status";

interface Row {
  /** Stable React key; not sent anywhere. */
  id: number;
  key: string;
  /** Empty for a stored key means "keep the stored value". Never filled from the API. */
  value: string;
  /** The key exists on the server, so an empty value keeps it. */
  stored: boolean;
}

let nextRowId = 1;
const toRows = (list: EnvList): Row[] =>
  list.vars.map((v) => ({ id: nextRowId++, key: v.key, value: "", stored: true }));

function rowErrors(rows: Row[]): Map<number, string> {
  const errors = new Map<number, string>();
  const seen = new Set<string>();
  for (const row of rows) {
    const key = envKeySchema.safeParse(row.key);
    if (!key.success) {
      errors.set(row.id, key.error.issues[0]?.message ?? "Invalid key");
    } else if (seen.has(row.key)) {
      errors.set(row.id, "Duplicate key");
    } else if (!row.stored && row.value === "") {
      errors.set(row.id, "A new variable needs a value");
    } else if (!envValueSchema.safeParse(row.value).success) {
      errors.set(row.id, "Value is too large");
    }
    seen.add(row.key);
  }
  return errors;
}

function Editor({
  appId,
  initial,
  disabled,
}: {
  appId: string;
  initial: EnvList;
  disabled: boolean;
}) {
  const client = useQueryClient();
  const [rows, setRows] = useState<Row[]>(() => toRows(initial));
  const [errors, setErrors] = useState<Map<number, string>>(new Map());
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: (body: Parameters<typeof replaceEnv>[1]) => replaceEnv(appId, body),
    // The request body holds plaintext values; drop the mutation from the cache at once.
    gcTime: 0,
    onSuccess: (list) => {
      client.setQueryData(["env", appId], list);
      // Values are write-only: after saving, the inputs are cleared again, and so is the
      // mutation state that still holds them.
      setRows(toRows(list));
      setSaved(true);
      save.reset();
    },
  });

  function update(id: number, patch: Partial<Row>) {
    setSaved(false);
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = rowErrors(rows);
    setErrors(found);
    if (found.size > 0) {
      return;
    }
    save.mutate({
      vars: rows.map((row) =>
        row.value === "" ? { key: row.key } : { key: row.key, value: row.value },
      ),
    });
  }

  const apiError =
    save.error instanceof ApiRequestError
      ? save.error.fieldErrors.length > 0
        ? save.error.fieldErrors.map((field) => field.message).join(" · ")
        : save.error.message
      : save.isError
        ? "Could not save the variables."
        : null;

  return (
    <form onSubmit={submit} noValidate>
      <p className="text-sm text-slate-600">
        Values are encrypted and never shown again. Leave a value empty to keep it. Changes apply at
        the next deploy.
      </p>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-slate-600">No variables yet.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {rows.map((row, index) => {
            const error = errors.get(row.id);
            return (
              <li key={row.id}>
                <div className="flex items-center gap-2">
                  <input
                    aria-label={`Key ${String(index + 1)}`}
                    value={row.key}
                    readOnly={row.stored}
                    disabled={disabled}
                    onChange={(event) => {
                      update(row.id, { key: event.target.value.toUpperCase() });
                    }}
                    className="w-56 rounded-md border border-slate-300 px-2 py-1 font-mono text-sm read-only:bg-slate-50"
                  />
                  <input
                    aria-label={`Value for ${row.key || `variable ${String(index + 1)}`}`}
                    type="password"
                    // Not the panel password: keep browsers and password managers from
                    // offering to save (or fill) env secrets. Chrome ignores "off" here.
                    autoComplete="new-password"
                    data-1p-ignore
                    data-lpignore="true"
                    data-bwignore
                    data-form-type="other"
                    value={row.value}
                    placeholder={row.stored ? "•••••• (unchanged)" : "Value"}
                    disabled={disabled}
                    onChange={(event) => {
                      update(row.id, { value: event.target.value });
                    }}
                    className="flex-1 rounded-md border border-slate-300 px-2 py-1 font-mono text-sm"
                  />
                  <button
                    type="button"
                    disabled={disabled}
                    aria-label={`Remove ${row.key || `variable ${String(index + 1)}`}`}
                    onClick={() => {
                      setSaved(false);
                      setRows((current) => current.filter((r) => r.id !== row.id));
                    }}
                    className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
                {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          disabled={disabled || rows.length >= MAX_ENV_VARS}
          onClick={() => {
            setSaved(false);
            setRows((current) => [
              ...current,
              { id: nextRowId++, key: "", value: "", stored: false },
            ]);
          }}
          className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        >
          Add variable
        </button>
        <button
          type="submit"
          disabled={disabled || save.isPending}
          className="rounded-md bg-slate-900 px-3 py-1 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {save.isPending ? "Saving…" : "Save"}
        </button>
        {saved && (
          <span role="status" className="text-sm text-emerald-700">
            Saved
          </span>
        )}
      </div>
      {apiError && (
        <div className="mt-3">
          <ErrorMessage>{apiError}</ErrorMessage>
        </div>
      )}
    </form>
  );
}

export function EnvEditor({ appId, disabled = false }: { appId: string; disabled?: boolean }) {
  const env = useQuery({ queryKey: ["env", appId], queryFn: () => fetchEnv(appId) });
  if (env.isPending) {
    return <Loading label="Loading variables…" />;
  }
  if (env.data === undefined) {
    return (
      <ErrorMessage onRetry={() => void env.refetch()} retrying={env.isFetching}>
        Could not load the environment variables.
      </ErrorMessage>
    );
  }
  return <Editor appId={appId} initial={env.data} disabled={disabled} />;
}
