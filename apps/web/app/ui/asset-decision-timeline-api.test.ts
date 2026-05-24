import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAssetDecisionTimelineProjection, formatAssetDecisionTimelineError } from "./asset-decision-timeline-api";

describe("asset decision timeline api helper", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the projection with encoded query params", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        ok: true,
        projection: {
          projectId: "project-jincheng"
        }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchAssetDecisionTimelineProjection({
      projectId: "project-jincheng",
      deliveryPackageId: "delivery current",
      previousDeliveryPackageId: "delivery previous"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/asset-decision-timeline?projectId=project-jincheng&deliveryPackageId=delivery+current&previousDeliveryPackageId=delivery+previous"
    );
    expect(result).toEqual({
      ok: true,
      projection: {
        projectId: "project-jincheng"
      }
    });
  });

  it("preserves server-side projection errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            ok: false,
            error: "project_member_required"
          },
          { status: 403 }
        )
      )
    );

    await expect(
      fetchAssetDecisionTimelineProjection({
        projectId: "project-jincheng",
        deliveryPackageId: "delivery-current"
      })
    ).resolves.toEqual({
      ok: false,
      error: "project_member_required"
    });
  });

  it("normalizes malformed responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not json", { status: 500 })));

    await expect(
      fetchAssetDecisionTimelineProjection({
        projectId: "project-jincheng",
        deliveryPackageId: "delivery-current"
      })
    ).resolves.toEqual({
      ok: false,
      error: "asset_decision_timeline_request_failed"
    });
  });

  it("formats projection errors for demo fallback messaging", () => {
    expect(formatAssetDecisionTimelineError({ ok: false, error: "delivery_package_not_published" })).toContain("Demo");
    expect(formatAssetDecisionTimelineError({ ok: false, error: "project_member_required" })).toContain("权限");
    expect(formatAssetDecisionTimelineError({ ok: true, projection: {} as never })).toBe("");
  });
});
