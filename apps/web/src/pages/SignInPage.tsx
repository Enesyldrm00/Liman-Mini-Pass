import { LOGIN_ERRORS, type LoginError } from "@liman/shared";
import { useSearchParams } from "react-router";
import { LOGIN_PATH } from "../api/endpoints";

const LOGIN_ERROR_MESSAGES: Record<LoginError, string> = {
  denied: "Sign-in was cancelled on GitHub.",
  not_allowed: "This GitHub account is not allowed to use this Liman instance.",
  github_failed: "GitHub did not answer as expected. Please try again.",
};

function isLoginError(value: string | null): value is LoginError {
  return LOGIN_ERRORS.some((code) => code === value);
}

export function SignInPage() {
  const [params] = useSearchParams();
  const error = params.get("login_error");

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">Liman</h1>
        <p className="mt-2 text-sm text-slate-600">Deploy your repositories on every push.</p>
        {isLoginError(error) && (
          <p
            role="alert"
            className="mt-6 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          >
            {LOGIN_ERROR_MESSAGES[error]}
          </p>
        )}
        {/* A plain link, not fetch: the API answers with a redirect to GitHub. */}
        <a
          href={LOGIN_PATH}
          className="mt-6 block rounded-md bg-slate-900 px-4 py-2 text-center text-sm font-medium text-white hover:bg-slate-700"
        >
          Sign in with GitHub
        </a>
      </div>
    </main>
  );
}
