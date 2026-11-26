import { screen, within } from "@testing-library/react";
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
const org = {
  id: "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d",
  installationId: 1002,
  accountLogin: "octo-org",
  accountType: "Organization",
  suspended: false,
};
const reposPath = (id: string, cursor?: string) =>
  `GET /api/github/installations/${id}/repos${cursor ? `?cursor=${cursor}` : ""}`;

function repo(id: number, fullName: string, isPrivate = false) {
  return {
    id,
    name: fullName.split("/")[1] ?? fullName,
    fullName,
    private: isPrivate,
    defaultBranch: "main",
  };
}

function signedIn(routes: Routes) {
  return stubFetch({ "GET /api/me": { body: testUser }, ...routes });
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

  it("lists the repositories of each installation", async () => {
    signedIn({
      "GET /api/github/installations": { body: { installations: [personal, org], installUrl } },
      [reposPath(personal.id)]: {
        body: { items: [repo(1, "octocat/hello", true)], nextCursor: null },
      },
      [reposPath(org.id)]: { body: { items: [repo(2, "octo-org/site")], nextCursor: null } },
    });
    renderApp();

    const mine = await screen.findByRole("region", { name: "octocat" });
    expect(await within(mine).findByText("octocat/hello")).toBeInTheDocument();
    expect(within(mine).getByText("Private")).toBeInTheDocument();
    expect(within(mine).getByText("main")).toBeInTheDocument();

    const theirs = screen.getByRole("region", { name: /octo-org/ });
    expect(await within(theirs).findByText("octo-org/site")).toBeInTheDocument();
    expect(within(theirs).getByText("Public")).toBeInTheDocument();
    expect(within(theirs).getByText("Organization")).toBeInTheDocument();

    expect(
      screen.getByRole("link", { name: "Install on another account or change repository access" }),
    ).toHaveAttribute("href", installUrl);
  });

  it("loads the next page with the cursor and appends it", async () => {
    signedIn({
      "GET /api/github/installations": { body: { installations: [personal], installUrl } },
      [reposPath(personal.id)]: { body: { items: [repo(1, "octocat/one")], nextCursor: "2" } },
      [reposPath(personal.id, "2")]: {
        body: { items: [repo(2, "octocat/two")], nextCursor: null },
      },
    });
    renderApp();

    await userEvent.click(await screen.findByRole("button", { name: "Load more" }));
    expect(await screen.findByText("octocat/two")).toBeInTheDocument();
    expect(screen.getByText("octocat/one")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("keeps loaded repositories when the next page fails", async () => {
    signedIn({
      "GET /api/github/installations": { body: { installations: [personal], installUrl } },
      [reposPath(personal.id)]: { body: { items: [repo(1, "octocat/one")], nextCursor: "2" } },
      [reposPath(personal.id, "2")]: apiError(502, "upstream_failed"),
    });
    renderApp();

    await userEvent.click(await screen.findByRole("button", { name: "Load more" }));
    expect(await screen.findByText("Could not load repositories from GitHub.")).toBeInTheDocument();
    expect(screen.getByText("octocat/one")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("does not ask for repositories of a suspended installation", async () => {
    const mock = signedIn({
      "GET /api/github/installations": {
        body: { installations: [{ ...personal, suspended: true }], installUrl },
      },
    });
    renderApp();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This installation is suspended on GitHub.",
    );
    expect(
      mock.mock.calls.some(([input]) => typeof input === "string" && input.includes("/repos")),
    ).toBe(false);
  });

  it("says there are no repositories yet", async () => {
    signedIn({
      "GET /api/github/installations": { body: { installations: [personal], installUrl } },
      [reposPath(personal.id)]: { body: { items: [], nextCursor: null } },
    });
    renderApp();
    expect(
      await screen.findByText("No repositories are shared with this installation yet."),
    ).toBeInTheDocument();
  });

  it.each([
    [
      apiError(409, "conflict", "Installation has too many repositories; select fewer on GitHub"),
      "Installation has too many repositories; select fewer on GitHub",
      false,
    ],
    [
      apiError(404, "not_found"),
      "This installation no longer exists on GitHub. Sign in again to refresh.",
      false,
    ],
    [apiError(502, "upstream_failed"), "Could not load repositories from GitHub.", true],
  ])("explains a failed repository list (%#)", async (response, message, canRetry) => {
    signedIn({
      "GET /api/github/installations": { body: { installations: [personal], installUrl } },
      [reposPath(personal.id)]: response,
    });
    renderApp();
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByRole("button", { name: "Try again" }) !== null).toBe(canRetry);
  });

  it("returns to the sign-in page when the session ends", async () => {
    signedIn({ "GET /api/github/installations": apiError(401, "unauthenticated") });
    renderApp();
    expect(await screen.findByRole("link", { name: "Sign in with GitHub" })).toBeInTheDocument();
  });
});
