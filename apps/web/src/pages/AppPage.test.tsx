import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { apiError, stubFetch, type Routes } from "../test/fetch";
import { renderApp, testUser } from "../test/render";

const app = {
  id: "3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a",
  name: "Blog",
  subdomain: "blog",
  url: "http://blog.localhost",
  installationId: "6d1f2b0a-3e4c-4f5a-8b9c-0d1e2f3a4b5c",
  repoId: 7,
  repoFullName: "octocat/blog",
  branch: "main",
  port: 3000,
  healthPath: "/healthz",
  status: "active",
  createdAt: "2026-11-27T10:00:00.000Z",
  updatedAt: "2026-11-27T10:00:00.000Z",
};
const appPath = `/api/apps/${app.id}`;
const envList = {
  vars: [
    { key: "DATABASE_URL", updatedAt: "2026-11-27T10:00:00.000Z" },
    { key: "MODE", updatedAt: "2026-11-27T10:00:00.000Z" },
  ],
};

function signedIn(routes: Routes) {
  return stubFetch({
    "GET /api/me": { body: testUser },
    [`GET ${appPath}`]: { body: app },
    [`GET ${appPath}/env`]: { body: envList },
    ...routes,
  });
}

const bodyOf = (mock: ReturnType<typeof stubFetch>, method: string) => {
  const call = mock.mock.calls.find(([, init]) => init?.method === method);
  return JSON.parse(call?.[1]?.body as string) as unknown;
};

describe("app page", () => {
  it("shows the app's details", async () => {
    signedIn({});
    renderApp(`/apps/${app.id}`);
    expect(await screen.findByRole("heading", { name: "Blog" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "http://blog.localhost" })).toHaveAttribute(
      "href",
      "http://blog.localhost",
    );
    expect(screen.getByText("octocat/blog")).toBeInTheDocument();
    expect(screen.getByText("/healthz")).toBeInTheDocument();
  });

  it("says when the app does not exist or is not the user's", async () => {
    signedIn({ [`GET ${appPath}`]: apiError(403, "forbidden") });
    renderApp(`/apps/${app.id}`);
    expect(await screen.findByRole("heading", { name: "App not found" })).toBeInTheDocument();
  });
});

describe("env editor", () => {
  it("lists keys with masked, empty values", async () => {
    signedIn({});
    renderApp(`/apps/${app.id}`);
    expect(await screen.findByDisplayValue("DATABASE_URL")).toHaveAttribute("readonly");
    const value = screen.getByLabelText("Value for DATABASE_URL");
    expect(value).toHaveValue("");
    expect(value).toHaveAttribute("type", "password");
    expect(value).toHaveAttribute("placeholder", "•••••• (unchanged)");
    // Not offered to the browser or a password manager as the panel password.
    expect(value).toHaveAttribute("autocomplete", "new-password");
    expect(value).toHaveAttribute("data-1p-ignore");
    expect(value).toHaveAttribute("data-lpignore", "true");
  });

  it("sends changed values, keeps untouched ones and drops removed keys", async () => {
    const mock = signedIn({
      [`PUT ${appPath}/env`]: {
        body: {
          vars: [
            { key: "DATABASE_URL", updatedAt: "2026-11-27T11:00:00.000Z" },
            { key: "NEW_KEY", updatedAt: "2026-11-27T11:00:00.000Z" },
          ],
        },
      },
    });
    const { client } = renderApp(`/apps/${app.id}`);
    await screen.findByDisplayValue("DATABASE_URL");

    await userEvent.click(screen.getByRole("button", { name: "Remove MODE" }));
    await userEvent.click(screen.getByRole("button", { name: "Add variable" }));
    await userEvent.type(screen.getByLabelText("Key 2"), "new_key");
    await userEvent.type(screen.getByLabelText("Value for NEW_KEY"), "s3cret");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Saved");
    expect(bodyOf(mock, "PUT")).toEqual({
      vars: [{ key: "DATABASE_URL" }, { key: "NEW_KEY", value: "s3cret" }],
    });
    // The plaintext does not linger in the mutation cache either.
    expect(
      JSON.stringify(
        client
          .getMutationCache()
          .getAll()
          .map((m) => m.state),
      ),
    ).not.toContain("s3cret");
    // Write-only: the value is gone from the form after saving.
    expect(screen.getByLabelText("Value for NEW_KEY")).toHaveValue("");
    expect(screen.queryByDisplayValue("s3cret")).not.toBeInTheDocument();
  });

  it("asks for a value for a new key and for a valid key, without sending", async () => {
    const mock = signedIn({});
    renderApp(`/apps/${app.id}`);
    await screen.findByDisplayValue("DATABASE_URL");
    await userEvent.click(screen.getByRole("button", { name: "Add variable" }));
    await userEvent.type(screen.getByLabelText("Key 3"), "LIMAN_X");
    await userEvent.click(screen.getByRole("button", { name: "Add variable" }));
    await userEvent.type(screen.getByLabelText("Key 4"), "EMPTY");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByText("Env key is reserved")).toBeInTheDocument();
    expect(screen.getByText("A new variable needs a value")).toBeInTheDocument();
    expect(mock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
  });

  it("shows the API's error", async () => {
    signedIn({ [`PUT ${appPath}/env`]: apiError(409, "conflict", "App is being deleted") });
    renderApp(`/apps/${app.id}`);
    await screen.findByDisplayValue("DATABASE_URL");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("App is being deleted");
  });

  it("cannot be edited while the app is being deleted", async () => {
    signedIn({ [`GET ${appPath}`]: { body: { ...app, status: "deleting" } } });
    renderApp(`/apps/${app.id}`);
    expect(await screen.findByDisplayValue("DATABASE_URL")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByText(/being deleted/)).toBeInTheDocument();
  });
});

describe("deleting an app", () => {
  it("asks for confirmation, sends DELETE and goes back to the list", async () => {
    const mock = signedIn({
      [`DELETE ${appPath}`]: { status: 202, body: { ...app, status: "deleting" } },
      "GET /api/github/installations": {
        body: { installations: [], installUrl: "https://github.com/apps/x/installations/new" },
      },
    });
    renderApp(`/apps/${app.id}`);
    const danger = await screen.findByRole("region", { name: "Delete" });

    await userEvent.click(within(danger).getByRole("button", { name: "Delete app" }));
    expect(mock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    await userEvent.click(within(danger).getByRole("button", { name: "Yes, delete" }));

    expect(
      await screen.findByRole("heading", { name: "Install the Liman GitHub App" }),
    ).toBeInTheDocument();
    expect(mock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true);
  });

  it("offers to retry the cleanup of an app stuck in deleting", async () => {
    const mock = signedIn({
      [`GET ${appPath}`]: { body: { ...app, status: "deleting" } },
      [`DELETE ${appPath}`]: { status: 202, body: { ...app, status: "deleting" } },
    });
    renderApp(`/apps/${app.id}`);
    const danger = await screen.findByRole("region", { name: "Delete" });
    expect(within(danger).queryByRole("button", { name: "Delete app" })).not.toBeInTheDocument();

    await userEvent.click(within(danger).getByRole("button", { name: "Retry cleanup" }));
    expect(await within(danger).findByRole("status")).toHaveTextContent("Cleanup queued again");
    expect(mock.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
  });

  it("can be called off", async () => {
    const mock = signedIn({});
    renderApp(`/apps/${app.id}`);
    const danger = await screen.findByRole("region", { name: "Delete" });
    await userEvent.click(within(danger).getByRole("button", { name: "Delete app" }));
    await userEvent.click(within(danger).getByRole("button", { name: "Keep it" }));
    expect(within(danger).getByRole("button", { name: "Delete app" })).toBeInTheDocument();
    expect(mock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  });
});
