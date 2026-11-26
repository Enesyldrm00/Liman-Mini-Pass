import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { apiError, stubFetch } from "../test/fetch";
import { renderApp, testUser } from "../test/render";

const installations = {
  installations: [],
  installUrl: "https://github.com/apps/liman-dev-06/installations/new",
};

describe("layout", () => {
  it("shows the signed-in user", async () => {
    stubFetch({
      "GET /api/me": { body: testUser },
      "GET /api/github/installations": { body: installations },
    });
    renderApp();
    expect(await screen.findByText("octocat")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("signs out with a POST and returns to the sign-in page", async () => {
    let signedIn = true;
    const mock = stubFetch({
      "GET /api/me": () => (signedIn ? { body: testUser } : apiError(401, "unauthenticated")),
      "GET /api/github/installations": { body: installations },
      "POST /api/auth/logout": () => {
        signedIn = false;
        return { status: 204 };
      },
    });
    const { client } = renderApp();
    await screen.findByRole("heading", { name: "Install the Liman GitHub App" });
    expect(client.getQueryData(["installations"])).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("link", { name: "Sign in with GitHub" })).toBeInTheDocument();
    expect(mock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true);
    expect(client.getQueryData(["installations"])).toBeUndefined();
  });

  it("forgets cached data when a request answers 401", async () => {
    const installUrl = installations.installUrl;
    const personal = {
      id: "6d1f2b0a-3e4c-4f5a-8b9c-0d1e2f3a4b5c",
      installationId: 1001,
      accountLogin: "octocat",
      accountType: "User",
      suspended: false,
    };
    stubFetch({
      "GET /api/me": { body: testUser },
      "GET /api/github/installations": { body: { installations: [personal], installUrl } },
      [`GET /api/github/installations/${personal.id}/repos`]: apiError(401, "unauthenticated"),
    });
    const { client } = renderApp();
    expect(await screen.findByRole("link", { name: "Sign in with GitHub" })).toBeInTheDocument();
    expect(client.getQueryData(["installations"])).toBeUndefined();
  });

  it("ignores an /api/me answer that was in flight when signing out", async () => {
    let meCalls = 0;
    let releaseMe: (() => void) | undefined;
    const json = (body: unknown, status = 200) =>
      new Response(body === undefined ? null : JSON.stringify(body), { status });
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string, init?: RequestInit) => {
        if (input === "/api/me") {
          meCalls += 1;
          if (meCalls === 1) {
            return Promise.resolve(json(testUser));
          }
          // The refresh started before sign-out answers only after it, still signed in.
          return new Promise<Response>((resolve) => {
            releaseMe = () => {
              resolve(json(testUser));
            };
          });
        }
        if (input === "/api/auth/logout" && init?.method === "POST") {
          return Promise.resolve(json(undefined, 204));
        }
        return Promise.resolve(json(installations));
      }),
    );
    const { client } = renderApp();
    await screen.findByRole("button", { name: "Sign out" });

    void client.refetchQueries({ queryKey: ["me"] });
    await vi.waitFor(() => {
      expect(releaseMe).toBeDefined();
    });
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await screen.findByRole("link", { name: "Sign in with GitHub" });

    await act(async () => {
      releaseMe?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByRole("link", { name: "Sign in with GitHub" })).toBeInTheDocument();
    expect(client.getQueryData(["me"])).toBeNull();
  });

  it("keeps the user signed in and says so when sign-out fails", async () => {
    stubFetch({
      "GET /api/me": { body: testUser },
      "GET /api/github/installations": { body: installations },
      "POST /api/auth/logout": apiError(500, "internal"),
    });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(await screen.findByText("Could not sign out. Please try again.")).toBeInTheDocument();
    expect(screen.getByText("octocat")).toBeInTheDocument();
  });

  it("shows a not-found page for unknown paths", async () => {
    stubFetch({ "GET /api/me": { body: testUser } });
    renderApp("/nope");
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  });
});
