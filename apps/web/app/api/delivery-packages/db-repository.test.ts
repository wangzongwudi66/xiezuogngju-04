import { describe, expect, it } from "vitest";
import { mapDeliveryPackageRows, type DeliveryPackageDbRow, type DeliveryPackageEpisodeDbRow } from "./db-repository";

describe("delivery package DB repository mappers", () => {
  it("maps DB package and episode rows into domain records", () => {
    const packageRows: DeliveryPackageDbRow[] = [
      {
        id: "delivery-1",
        projectId: "project-jincheng",
        type: "range",
        title: "Episodes 1-2 delivery",
        sourceFileName: "episodes-1-2.docx",
        declaredEpisodeFrom: 1,
        declaredEpisodeTo: 2,
        status: "published",
        uploadedByUserId: "user-head-writer",
        submittedByUserId: "user-head-writer",
        reviewedByUserId: "user-owner",
        rejectionReason: null,
        createdAt: "2026-05-29T00:00:00.000Z",
        submittedAt: "2026-05-29T01:00:00.000Z",
        publishedAt: "2026-05-29T02:00:00.000Z",
        rejectedAt: null
      }
    ];
    const episodeRows: DeliveryPackageEpisodeDbRow[] = [
      {
        id: "delivery-1-episode-1",
        deliveryPackageId: "delivery-1",
        episodeNo: 1,
        title: "Episode 1",
        content: "Episode 1 content",
        isConfirmedChange: true
      },
      {
        id: "delivery-1-episode-2",
        deliveryPackageId: "delivery-1",
        episodeNo: 2,
        title: "Episode 2",
        content: "Episode 2 content",
        isConfirmedChange: false
      }
    ];

    const snapshot = mapDeliveryPackageRows(packageRows, episodeRows);

    expect(snapshot.deliveryPackages).toEqual([
      {
        id: "delivery-1",
        projectId: "project-jincheng",
        type: "range",
        title: "Episodes 1-2 delivery",
        sourceFileName: "episodes-1-2.docx",
        declaredEpisodeFrom: 1,
        declaredEpisodeTo: 2,
        status: "published",
        uploadedByUserId: "user-head-writer",
        submittedByUserId: "user-head-writer",
        reviewedByUserId: "user-owner",
        createdAt: "2026-05-29T00:00:00.000Z",
        submittedAt: "2026-05-29T01:00:00.000Z",
        publishedAt: "2026-05-29T02:00:00.000Z"
      }
    ]);
    expect(snapshot.deliveryPackageEpisodes).toEqual([
      {
        id: "delivery-1-episode-1",
        deliveryPackageId: "delivery-1",
        episodeNo: 1,
        title: "Episode 1",
        content: "Episode 1 content",
        isConfirmedChange: true
      },
      {
        id: "delivery-1-episode-2",
        deliveryPackageId: "delivery-1",
        episodeNo: 2,
        title: "Episode 2",
        content: "Episode 2 content",
        isConfirmedChange: false
      }
    ]);
  });
});
