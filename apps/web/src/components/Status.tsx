import type { ReactNode } from "react";

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <p role="status" className="p-6 text-sm text-slate-500">
      {label}
    </p>
  );
}

export function ErrorMessage({
  children,
  onRetry,
  retrying = false,
}: {
  children: ReactNode;
  onRetry?: () => void;
  /** Disables the retry button while the retry is in flight. */
  retrying?: boolean;
}) {
  return (
    <div
      role="alert"
      className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
    >
      {children}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="ml-2 font-medium underline disabled:opacity-50"
        >
          Try again
        </button>
      )}
    </div>
  );
}

/** Shown above data that is still on screen when refreshing it failed. */
export function StaleWarning({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
    >
      {children}
    </p>
  );
}
