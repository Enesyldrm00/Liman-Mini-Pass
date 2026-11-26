import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
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
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("link", { name: "Sign in with GitHub" })).toBeInTheDocument();
    expect(mock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true);
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
