import { Link } from "react-router";

export function NotFoundPage() {
  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Page not found</h1>
      <Link to="/" className="mt-2 inline-block text-sm text-slate-700 underline">
        Back to the panel
      </Link>
    </div>
  );
}
