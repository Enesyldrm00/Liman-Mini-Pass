import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { apiError, stubFetch, type Routes } from "../test/fetch";
import { renderApp, testUser } from "../test/render";

const installUrl = "https://github.com/apps/liman-dev-06/installations/new";
const personal = {
  id: "6d1f2b0a-3e4c-4f5a-8b9c-0d1e2f3a4b5c",
  installationId: 1001,
  accountLogin: "octocat",
  accountType: "User",
  suspended: false,
};

function app(i: number, extra = {}) {
  return {
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    name: `App ${String(i)}`,
    subdomain: `app-${String(i)}`,
    url: `http://app-${String(i)}.localhost`,
    installationId: personal.id,
    repoId: i,
    repoFullName: `octocat/app-${String(i)}`,
    branch: "main",
    port: 3000,
    healthPath: "/",
    status: "active",
    createdAt: "2026-11-27T10:00:00.000Z",
    updatedAt: "2026-11-27T10:00:00.000Z",
    ...extra,
  };
}

function signedIn(routes: Routes) {
  return stubFetch({
    "GET /api/me": { body: testUser },
    "GET /api/github/installations": { body: { installations: [personal], installUrl } },
    ...routes,
  });
}

describe("home page", () => {
  it("asks to install the App when there is no installation", async () => {
    signedIn({ "GET /api/github/installations": { body: { installations: [], installUrl } } });
    renderApp();
    expect(
      await screen.findByRole("heading", { name: "Install the Liman GitHub App" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Install on GitHub" })).toHaveAttribute(
      "href",
      installUrl,
    );
  });

  it("lists the user's apps with their status and links to them", async () => {
    signedIn({
      "GET /api/apps": {
        body: { items: [app(1), app(2, { status: "deleting" })], nextCursor: null },
      },
    });
    renderApp();

    const link = await screen.findByRole("link", { name: "App 1" });
    expect(link).toHaveAttribute("href", `/apps/${app(1).id}`);
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0] as HTMLElement).getByText("Active")).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText("Deleting")).toBeInTheDocument();
    expect(screen.getByText("octocat/app-1 · main")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "New app" })).toHaveAttribute("href", "/apps/new");
    expect(
      screen.getByRole("link", { name: "Install on another account or change repository access" }),
    ).toHaveAttribute("href", installUrl);
  });

  it("says when there are no apps yet", async () => {
    signedIn({ "GET /api/apps": { body: { items: [], nextCursor: null } } });
    renderApp();
    expect(await screen.findByText(/No apps yet/)).toBeInTheDocument();
  });

  it("loads more apps with the cursor", async () => {
    signedIn({
      "GET /api/apps": { body: { items: [app(1)], nextCursor: "YXBwLTE" } },
      "GET /api/apps?cursor=YXBwLTE": { body: { items: [app(2)], nextCursor: null } },
    });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Load more" }));
    expect(await screen.findByRole("link", { name: "App 2" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "App 1" })).toBeInTheDocument();
  });

  it("offers Try again when the app list fails", async () => {
    signedIn({ "GET /api/apps": apiError(500, "internal") });
    renderApp();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load your apps.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("keeps the page when refreshing the installations fails", async () => {
    let healthy = true;
    stubFetch({
      "GET /api/me": { body: testUser },
      "GET /api/github/installations": () =>
        healthy
          ? { body: { installations: [personal], installUrl } }
          : apiError(502, "upstream_failed"),
      "GET /api/apps": { body: { items: [app(1)], nextCursor: null } },
    });
    const { client } = renderApp();
    await screen.findByRole("link", { name: "App 1" });

    healthy = false;
    await act(() => client.refetchQueries({ queryKey: ["installations"] }));
    expect(
      await screen.findByText(
        "Could not refresh your GitHub installations; showing the last list.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "App 1" })).toBeInTheDocument();
  });

  it("returns to the sign-in page when the session ends", async () => {
    signedIn({ "GET /api/apps": apiError(401, "unauthenticated") });
    renderApp();
    expect(await screen.findByRole("link", { name: "Sign in with GitHub" })).toBeInTheDocument();
  });
});
