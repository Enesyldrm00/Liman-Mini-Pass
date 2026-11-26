import type { CurrentUser } from "@liman/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useNavigate } from "react-router";
import { logout } from "../api/endpoints";
import { forgetUser } from "../queryClient";
import { ErrorMessage } from "./Status";

export function Layout({ user }: { user: CurrentUser }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const signOut = useMutation({
    mutationFn: logout,
    onSuccess: async () => {
      await forgetUser(client);
      void navigate("/", { replace: true });
    },
  });

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <Link to="/" className="text-lg font-semibold text-slate-900">
            Liman
          </Link>
          <div className="flex items-center gap-3">
            {user.avatarUrl && <img src={user.avatarUrl} alt="" className="h-7 w-7 rounded-full" />}
            <span className="text-sm text-slate-700">{user.login}</span>
            <button
              type="button"
              onClick={() => {
                signOut.mutate();
              }}
              disabled={signOut.isPending}
              className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">
        {signOut.isError && (
          <div className="mb-6">
            <ErrorMessage>Could not sign out. Please try again.</ErrorMessage>
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
}
