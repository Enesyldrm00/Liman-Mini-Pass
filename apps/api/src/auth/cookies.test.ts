import { describe, expect, it } from "vitest";
import { cookieNames, cookieOptions } from "./cookies.js";

describe("cookieNames", () => {
  it("uses the __Host- prefix in production only", () => {
    expect(cookieNames("production")).toEqual({
      session: "__Host-liman_session",
      oauthState: "__Host-liman_oauth_state",
    });
    expect(cookieNames("development")).toEqual({
      session: "liman_session",
      oauthState: "liman_oauth_state",
    });
  });
});

describe("cookieOptions", () => {
  it("is httpOnly, SameSite=Lax, Path=/ and has no Domain", () => {
    const options = cookieOptions("development", 1000);
    expect(options).toEqual({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: false,
      maxAge: 1000,
    });
    expect(options).not.toHaveProperty("domain");
  });

  it("is Secure in production, as the __Host- prefix requires", () => {
    expect(cookieOptions("production").secure).toBe(true);
  });

  it("leaves maxAge out when clearing", () => {
    expect(cookieOptions("test")).not.toHaveProperty("maxAge");
  });
});
