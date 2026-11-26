import { describe, expect, it } from "vitest";
import { cursorSchema, installationListSchema, repoPageSchema } from "./github.js";

describe("cursorSchema", () => {
  it.each(["1", "2", "999"])("accepts %s", (value) => {
    expect(cursorSchema.safeParse(value).success).toBe(true);
  });

  it.each(["", "0", "01", "1000", "-1", "1.5", "abc", " 2"])("rejects %j", (value) => {
    expect(cursorSchema.safeParse(value).success).toBe(false);
  });
});

describe("response schemas", () => {
  it("parse a repo page", () => {
    const page = {
      items: [{ id: 1, name: "app", fullName: "enes/app", private: true, defaultBranch: "main" }],
      nextCursor: null,
    };
    expect(repoPageSchema.parse(page)).toEqual(page);
  });

  it("parse an installation list", () => {
    const body = {
      installations: [
        {
          id: "0b6f1f0e-8f0a-4c43-9a51-0d0f6a3c2b11",
          installationId: 42,
          accountLogin: "enes",
          accountType: "User",
          suspended: false,
        },
      ],
      installUrl: "https://github.com/apps/liman-dev-06/installations/new",
    };
    expect(installationListSchema.parse(body)).toEqual(body);
  });

  it.each([
    "javascript:alert(1)",
    "http://github.com/apps/liman-dev-06/installations/new",
    "https://evil.example/apps/liman-dev-06/installations/new",
    "https://github.com.evil.example/apps/liman-dev-06/installations/new",
  ])("reject the install URL %s", (installUrl) => {
    expect(installationListSchema.safeParse({ installations: [], installUrl }).success).toBe(false);
  });
});
