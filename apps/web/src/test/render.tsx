import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { App } from "../App";
import { createQueryClient } from "../queryClient";

/** Renders the whole panel at `path` with a fresh query cache and no retries. */
export function renderApp(path = "/") {
  const client = createQueryClient({ retry: false });
  const result = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, client };
}

export const testUser = {
  id: "0b0c2f6e-5c39-4a8e-9a43-1f0c6a8f2b11",
  githubId: 42,
  login: "octocat",
  avatarUrl: "https://avatars.githubusercontent.com/u/42",
};
