import { describe, expect, it } from "vitest";
import { isSameOriginMutatingRequest, requireSameOriginMutatingRequest } from "./request-origin";

describe("mutating request origin guard", () => {
  it("allows same-origin requests", () => {
    expect(
      isSameOriginMutatingRequest(
        new Request("https://example.test/api/example", {
          headers: {
            origin: "https://example.test",
            "sec-fetch-site": "same-origin"
          },
          method: "POST"
        })
      )
    ).toBe(true);
  });

  it("allows requests without Origin for server-side callers and route tests", () => {
    expect(isSameOriginMutatingRequest(new Request("https://example.test/api/example", { method: "POST" }))).toBe(true);
  });

  it("rejects cross-origin Origin headers", () => {
    expect(
      isSameOriginMutatingRequest(
        new Request("https://example.test/api/example", {
          headers: {
            origin: "https://evil.test"
          },
          method: "POST"
        })
      )
    ).toBe(false);
  });

  it("rejects cross-site fetch metadata even when Origin is missing", () => {
    expect(
      isSameOriginMutatingRequest(
        new Request("https://example.test/api/example", {
          headers: {
            "sec-fetch-site": "cross-site"
          },
          method: "POST"
        })
      )
    ).toBe(false);
  });

  it("throws the stable guard error", () => {
    expect(() =>
      requireSameOriginMutatingRequest(
        new Request("https://example.test/api/example", {
          headers: {
            origin: "https://evil.test"
          },
          method: "POST"
        })
      )
    ).toThrow("request_origin_forbidden");
  });
});
