import type { ReactNode } from "react";

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <p role="status" className="p-6 text-sm text-slate-500">
      {label}
    </p>
  );
}

export function ErrorMessage({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
    >
      {children}
      {onRetry && (
        <button type="button" onClick={onRetry} className="ml-2 font-medium underline">
          Try again
        </button>
      )}
    </div>
  );
}
