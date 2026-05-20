import { describe, expect, it } from "vitest";
import { createDeliveryImportJob, getDeliveryImportJobResult, listDeliveryImportJobs, runDeliveryImportJob } from "./service";

describe("delivery import job service", () => {
  it("returns a draft and successful job for pasted text", async () => {
    const result = await runDeliveryImportJob({
      source: "text",
      projectId: "project-jincheng",
      uploadedByUserId: "user-head-writer",
      declaredRangeText: "1-2",
      rawText: "第 1 集 开场\n场 1-1 金城矿山 日 外\n正文一\n第 2 集 追踪\n正文二"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.job).toMatchObject({
      source: "text",
      status: "success",
      projectId: "project-jincheng",
      fileName: "pasted-word-text.txt"
    });
    expect(result.draft).toMatchObject({
      type: "range",
      declaredEpisodeFrom: 1,
      declaredEpisodeTo: 2,
      confirmedEpisodeNos: [1, 2]
    });
  });

  it("returns failed job details when text cannot be segmented", async () => {
    const result = await runDeliveryImportJob({
      source: "text",
      projectId: "project-jincheng",
      uploadedByUserId: "user-head-writer",
      declaredRangeText: "1-1",
      rawText: "场 1-1 金城矿山 日 外\n没有集标题"
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.job.status).toBe("failed");
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "episode_boundary_not_found"
      })
    );
  });

  it("stores created import jobs for later polling", async () => {
    const result = await createDeliveryImportJob({
      source: "text",
      projectId: "project-polling",
      uploadedByUserId: "user-head-writer",
      declaredRangeText: "1-1",
      rawText: "第 1 集 开场\n正文"
    });

    expect(getDeliveryImportJobResult(result.job.id)).toEqual(result);
    expect(listDeliveryImportJobs("project-polling")).toContainEqual(result.job);
  });
});
