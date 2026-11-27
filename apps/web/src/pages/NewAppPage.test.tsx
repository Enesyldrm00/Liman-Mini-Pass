import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { apiError, stubFetch, type Routes } from "../test/fetch";
import { renderApp, testUser } from "../test/render";
import { suggestSubdomain } from "./NewAppPage";

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

function renderAppWith(routes: Routes) {
  signedIn(routes);
  return renderApp("/apps/new");
}

describe("new app wizard: repository step", () => {
  it("asks to install the App when there is no installation", async () => {
    signedIn({ "GET /api/github/installations": { body: { installations: [], installUrl } } });
    renderApp("/apps/new");
    expect(
      await screen.findByRole("heading", { name: "Install the Liman GitHub App" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Install on GitHub" })).toHaveAttribute(
      "href",
      installUrl,
    );
  });

  it("lets the user pick one of several installations, then lists its repositories", async () => {
    signedIn({
      "GET /api/github/installations": { body: { installations: [personal, org], installUrl } },
      [reposPath(org.id)]: { body: { items: [repo(2, "octo-org/site", true)], nextCursor: null } },
    });
    renderApp("/apps/new");

    await userEvent.click(await screen.findByRole("button", { name: "octo-org" }));
    const step = screen.getByRole("region", { name: "Repository" });
    expect(await within(step).findByText("octo-org/site")).toBeInTheDocument();
    expect(within(step).getByText("Private")).toBeInTheDocument();
    expect(within(step).getByText("main")).toBeInTheDocument();
    expect(within(step).getByRole("button", { name: "Select octo-org/site" })).toBeInTheDocument();
  });

  it("loads the next page with the cursor and appends it", async () => {
    signedIn({
      "GET /api/github/installations": { body: { installations: [personal], installUrl } },
      [reposPath(personal.id)]: { body: { items: [repo(1, "octocat/one")], nextCursor: "2" } },
      [reposPath(personal.id, "2")]: {
        body: { items: [repo(2, "octocat/two")], nextCursor: null },
      },
    });
    renderApp("/apps/new");

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
    renderApp("/apps/new");

    await userEvent.click(await screen.findByRole("button", { name: "Load more" }));
    expect(await screen.findByText("Could not load repositories from GitHub.")).toBeInTheDocument();
    expect(screen.getByText("octocat/one")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("recovers with Try again after the next page failed", async () => {
    let failures = 1;
    signedIn({
      "GET /api/github/installations": { body: { installations: [personal], installUrl } },
      [reposPath(personal.id)]: { body: { items: [repo(1, "octocat/one")], nextCursor: "2" } },
      [reposPath(personal.id, "2")]: () =>
        failures-- > 0
          ? apiError(502, "upstream_failed")
          : { body: { items: [repo(2, "octocat/two")], nextCursor: null } },
    });
    renderApp("/apps/new");

    await userEvent.click(await screen.findByRole("button", { name: "Load more" }));
    await userEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("octocat/two")).toBeInTheDocument();
    expect(screen.getByText("octocat/one")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not offer Try again when the next page cannot succeed", async () => {
    signedIn({
      "GET /api/github/installations": { body: { installations: [personal], installUrl } },
      [reposPath(personal.id)]: { body: { items: [repo(1, "octocat/one")], nextCursor: "2" } },
      [reposPath(personal.id, "2")]: apiError(
        409,
        "conflict",
        "Installation is suspended on GitHub",
      ),
    });
    renderApp("/apps/new");

    await userEvent.click(await screen.findByRole("button", { name: "Load more" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Installation is suspended on GitHub",
    );
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(screen.getByText("octocat/one")).toBeInTheDocument();
  });

  it("shows a repository only once when it shifts onto the next page", async () => {
    signedIn({
      "GET /api/github/installations": { body: { installations: [personal], installUrl } },
      [reposPath(personal.id)]: {
        body: { items: [repo(1, "octocat/one"), repo(2, "octocat/two")], nextCursor: "2" },
      },
      [reposPath(personal.id, "2")]: {
        body: { items: [repo(2, "octocat/two"), repo(3, "octocat/three")], nextCursor: null },
      },
    });
    renderApp("/apps/new");

    await userEvent.click(await screen.findByRole("button", { name: "Load more" }));
    await screen.findByText("octocat/three");
    expect(screen.getAllByText("octocat/two")).toHaveLength(1);
  });

  it("keeps the repositories on screen when a refresh fails", async () => {
    let healthy = true;
    const { client } = renderAppWith({
      "GET /api/github/installations": { body: { installations: [personal], installUrl } },
      [reposPath(personal.id)]: () =>
        healthy
          ? { body: { items: [repo(1, "octocat/one")], nextCursor: null } }
          : apiError(502, "upstream_failed"),
    });
    await screen.findByText("octocat/one");

    healthy = false;
    await act(() => client.refetchQueries({ queryKey: ["repos"] }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not refresh this list; showing the last one.",
    );
    expect(screen.getByText("octocat/one")).toBeInTheDocument();
  });

  it("links to sign-in when the installation is gone", async () => {
    signedIn({
      "GET /api/github/installations": { body: { installations: [personal], installUrl } },
      [reposPath(personal.id)]: apiError(404, "not_found"),
    });
    renderApp("/apps/new");
    expect(await screen.findByRole("link", { name: "Sign in again" })).toHaveAttribute(
      "href",
      "/api/auth/github/login",
    );
  });

  it("does not ask for repositories of a suspended installation", async () => {
    const mock = signedIn({
      "GET /api/github/installations": {
        body: { installations: [{ ...personal, suspended: true }], installUrl },
      },
    });
    renderApp("/apps/new");

    expect(
      await screen.findByRole("button", { name: "octocat (suspended on GitHub)" }),
    ).toBeDisabled();
    expect(
      mock.mock.calls.some(([input]) => typeof input === "string" && input.includes("/repos")),
    ).toBe(false);
  });

  it("says there are no repositories yet", async () => {
    signedIn({
      "GET /api/github/installations": { body: { installations: [personal], installUrl } },
      [reposPath(personal.id)]: { body: { items: [], nextCursor: null } },
    });
    renderApp("/apps/new");
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
    renderApp("/apps/new");
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByRole("button", { name: "Try again" }) !== null).toBe(canRetry);
  });

  it("returns to the sign-in page when the session ends", async () => {
    signedIn({ "GET /api/github/installations": apiError(401, "unauthenticated") });
    renderApp("/apps/new");
    expect(await screen.findByRole("link", { name: "Sign in with GitHub" })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------

const branchesPath = (installationId: string, repoId: number) =>
  `GET /api/github/installations/${installationId}/repos/${String(repoId)}/branches`;

const createdApp = {
  id: "3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a",
  name: "My_Site",
  subdomain: "my-site",
  url: "http://my-site.localhost",
  installationId: personal.id,
  repoId: 7,
  repoFullName: "octocat/My_Site",
  branch: "dev",
  port: 8080,
  healthPath: "/healthz",
  status: "active",
  createdAt: "2026-11-27T10:00:00.000Z",
  updatedAt: "2026-11-27T10:00:00.000Z",
};

function wizardRoutes(extra: Routes = {}) {
  return signedIn({
    "GET /api/github/installations": { body: { installations: [personal], installUrl } },
    [reposPath(personal.id)]: { body: { items: [repo(7, "octocat/My_Site")], nextCursor: null } },
    [branchesPath(personal.id, 7)]: {
      body: {
        items: [
          { name: "dev", commitSha: "b".repeat(40) },
          { name: "main", commitSha: "a".repeat(40) },
        ],
        nextCursor: null,
      },
    },
    ...extra,
  });
}

async function walkToDetails() {
  renderApp("/apps/new");
  await userEvent.click(await screen.findByRole("button", { name: "Select octocat/My_Site" }));
  const branch = await screen.findByRole("combobox", { name: "Branch" });
  // The repository's default branch is preselected.
  expect(branch).toHaveValue("main");
  await userEvent.selectOptions(branch, "dev");
  await userEvent.click(screen.getByRole("button", { name: "Use this branch" }));
  return screen.findByRole("region", { name: "Details" });
}

describe("new app wizard", () => {
  it("creates an app from installation, repository and branch", async () => {
    const mock = wizardRoutes({
      "POST /api/apps": { status: 201, body: createdApp },
      [`GET /api/apps/${createdApp.id}`]: { body: createdApp },
      [`GET /api/apps/${createdApp.id}/env`]: { body: { vars: [] } },
    });
    const details = await walkToDetails();

    // Name and subdomain are suggested from the repository name.
    expect(within(details).getByLabelText("Name")).toHaveValue("My_Site");
    expect(within(details).getByLabelText("Subdomain")).toHaveValue("my-site");
    await userEvent.clear(within(details).getByLabelText("Port"));
    await userEvent.type(within(details).getByLabelText("Port"), "8080");
    await userEvent.clear(within(details).getByLabelText("Health path"));
    await userEvent.type(within(details).getByLabelText("Health path"), "/healthz");
    await userEvent.click(within(details).getByRole("button", { name: "Create app" }));

    expect(await screen.findByRole("heading", { name: "My_Site" })).toBeInTheDocument();
    const post = mock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(post?.[1]?.body as string)).toEqual({
      name: "My_Site",
      subdomain: "my-site",
      installationId: personal.id,
      repoId: 7,
      branch: "dev",
      port: 8080,
      healthPath: "/healthz",
    });
    expect(new Headers(post?.[1]?.headers).get("content-type")).toBe("application/json");
  });

  it("checks the fields before sending anything", async () => {
    const mock = wizardRoutes();
    const details = await walkToDetails();
    const subdomain = within(details).getByLabelText("Subdomain");
    await userEvent.clear(subdomain);
    await userEvent.type(subdomain, "api");
    await userEvent.clear(within(details).getByLabelText("Port"));
    await userEvent.type(within(details).getByLabelText("Port"), "abc");
    await userEvent.click(within(details).getByRole("button", { name: "Create app" }));

    expect(within(details).getByText("This name is reserved")).toBeInTheDocument();
    expect(within(details).getByText("Port must be a number")).toBeInTheDocument();
    expect(subdomain).toHaveAttribute("aria-invalid", "true");
    expect(mock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("shows the API's field error next to the field", async () => {
    wizardRoutes({
      "POST /api/apps": {
        status: 409,
        body: {
          error: {
            code: "conflict",
            message: "Subdomain is already taken",
            details: [{ path: "subdomain", message: "Subdomain is already taken" }],
          },
        },
      },
    });
    const details = await walkToDetails();
    await userEvent.click(within(details).getByRole("button", { name: "Create app" }));
    expect(await within(details).findByText("Subdomain is already taken")).toBeInTheDocument();
    expect(within(details).getByLabelText("Subdomain")).toHaveAttribute("aria-invalid", "true");
  });

  it("shows a field error for a step before the form, such as the branch", async () => {
    wizardRoutes({
      "POST /api/apps": {
        status: 400,
        body: {
          error: {
            code: "validation_failed",
            message: "Branch not found in the repository",
            details: [{ path: "branch", message: "Branch not found in the repository" }],
          },
        },
      },
    });
    const details = await walkToDetails();
    await userEvent.click(within(details).getByRole("button", { name: "Create app" }));
    expect(await within(details).findByRole("alert")).toHaveTextContent(
      "Branch not found in the repository",
    );
  });

  it("shows other API errors above the button", async () => {
    wizardRoutes({ "POST /api/apps": apiError(502, "upstream_failed", "GitHub request failed") });
    const details = await walkToDetails();
    await userEvent.click(within(details).getByRole("button", { name: "Create app" }));
    expect(await within(details).findByRole("alert")).toHaveTextContent("GitHub request failed");
  });
});

describe("suggestSubdomain", () => {
  it.each([
    ["My_Site.v2", "my-site-v2"],
    ["--hello--", "hello"],
    ["xn--test", "test"],
    ["a".repeat(50), "a".repeat(40)],
  ])("%s → %s", (input, expected) => {
    expect(suggestSubdomain(input)).toBe(expected);
  });
});
