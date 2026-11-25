import { describe, expect, it } from "vitest";
import {
  RESERVED_SUBDOMAINS,
  SUBDOMAIN_MAX_LENGTH,
  subdomainSchema,
  validateSubdomain,
  type SubdomainError,
} from "./subdomain.js";

describe("validateSubdomain", () => {
  it.each(["a", "1", "my-app", "app1", "a-b-c", "a".repeat(SUBDOMAIN_MAX_LENGTH)])(
    "accepts %s",
    (value) => {
      expect(validateSubdomain(value)).toEqual({ ok: true });
    },
  );

  it.each<[string, SubdomainError]>([
    ["", "empty"],
    ["a".repeat(SUBDOMAIN_MAX_LENGTH + 1), "too_long"],
    ["My-App", "invalid_chars"],
    ["app_1", "invalid_chars"],
    ["app.x", "invalid_chars"],
    ["app x", "invalid_chars"],
    ["çay", "invalid_chars"],
    ["-app", "leading_or_trailing_hyphen"],
    ["app-", "leading_or_trailing_hyphen"],
    ["-", "leading_or_trailing_hyphen"],
    ["xn--abc", "punycode_prefix"],
  ])("rejects %j as %s", (value, reason) => {
    expect(validateSubdomain(value)).toEqual({ ok: false, reason });
  });

  it.each(RESERVED_SUBDOMAINS)("rejects reserved name %s", (value) => {
    expect(validateSubdomain(value)).toEqual({ ok: false, reason: "reserved" });
  });

  it("allows names that only contain a reserved word", () => {
    expect(validateSubdomain("my-api")).toEqual({ ok: true });
    expect(validateSubdomain("liman2")).toEqual({ ok: true });
  });
});

describe("subdomainSchema", () => {
  it("parses a valid subdomain", () => {
    expect(subdomainSchema.parse("sample")).toBe("sample");
  });

  it("reports the reason on failure", () => {
    const result = subdomainSchema.safeParse("admin");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Invalid subdomain: reserved");
  });
});
