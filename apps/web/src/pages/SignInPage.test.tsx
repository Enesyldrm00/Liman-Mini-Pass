import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { apiError, stubFetch } from "../test/fetch";
import { renderApp } from "../test/render";

describe("sign-in page", () => {
  it("is shown when there is no session", async () => {
    stubFetch({ "GET /api/me": apiError(401, "unauthenticated") });
    renderApp();
    const link = await screen.findByRole("link", { name: "Sign in with GitHub" });
    expect(link).toHaveAttribute("href", "/api/auth/github/login");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    ["denied", "Sign-in was cancelled on GitHub."],
    ["not_allowed", "This GitHub account is not allowed to use this Liman instance."],
    ["github_failed", "GitHub did not answer as expected. Please try again."],
  ])("explains login_error=%s", async (code, message) => {
    stubFetch({ "GET /api/me": apiError(401, "unauthenticated") });
    renderApp(`/?login_error=${code}`);
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  });

  it("ignores an unknown login_error", async () => {
    stubFetch({ "GET /api/me": apiError(401, "unauthenticated") });
    renderApp("/?login_error=<script>");
    await screen.findByRole("link", { name: "Sign in with GitHub" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("offers a retry when the API cannot be reached", async () => {
    stubFetch({ "GET /api/me": apiError(502, "upstream_failed") });
    renderApp();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach Liman.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
