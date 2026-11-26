import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiRequestError, isUnauthenticated } from "./api/client";

export const ME_QUERY_KEY = ["me"] as const;

/** Retries only failures that may pass on a second try: network errors and 5xx. */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500) {
    return false;
  }
  return failureCount < 2;
}

export function createQueryClient(options: { retry?: boolean } = {}): QueryClient {
  const client: QueryClient = new QueryClient({
    // A 401 anywhere means the session ended (expired, revoked, user removed from the
    // allow list); dropping the user sends the panel back to the sign-in page.
    queryCache: new QueryCache({ onError: signOutOn401 }),
    mutationCache: new MutationCache({ onError: signOutOn401 }),
    defaultOptions: {
      queries: {
        retry: options.retry === false ? false : shouldRetry,
        refetchOnWindowFocus: false,
      },
    },
  });

  function signOutOn401(error: unknown): void {
    if (isUnauthenticated(error)) {
      client.setQueryData(ME_QUERY_KEY, null);
    }
  }

  return client;
}
