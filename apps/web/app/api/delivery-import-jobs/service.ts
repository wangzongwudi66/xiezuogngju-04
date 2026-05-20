import { parseWordDelivery, parseWordDeliveryText } from "@aigc/domain";
import type { DeliveryPackageDraftInput, WordDeliveryIssue } from "@aigc/domain";
import { buildDeliveryPackageDraftFromParsed } from "../../ui/delivery-text-parser";
import type { DeliveryImportJob } from "../../ui/workspace-persistence";

export type DeliveryImportSource = "docx" | "text";

export interface DeliveryImportJobRequest {
  declaredRangeText: string;
  projectId: string;
  source: DeliveryImportSource;
  uploadedByUserId: string;
  fileName?: string;
  rawText?: string;
  fileBuffer?: ArrayBuffer;
}

export type DeliveryImportJobResponse =
  | {
      ok: true;
      draft: DeliveryPackageDraftInput;
      issues: WordDeliveryIssue[];
      job: DeliveryImportJob;
    }
  | {
      ok: false;
      issues: WordDeliveryIssue[];
      remedies: string[];
      job: DeliveryImportJob;
    };

export async function runDeliveryImportJob(input: DeliveryImportJobRequest): Promise<DeliveryImportJobResponse> {
  const createdAt = new Date().toISOString();
  const jobBase: DeliveryImportJob = {
    id: createImportJobId(input.source, createdAt),
    projectId: input.projectId,
    source: input.source,
    status: "processing",
    fileName: input.fileName ?? (input.source === "docx" ? "uploaded.docx" : "pasted-word-text.txt"),
    declaredRangeText: input.declaredRangeText,
    createdAt
  };

  const parsed =
    input.source === "docx"
      ? await parseWordDelivery(input.fileBuffer ?? new ArrayBuffer(0), {
          declaredRange: input.declaredRangeText.trim() || undefined,
          fileName: jobBase.fileName
        })
      : parseWordDeliveryText(input.rawText ?? "", {
          declaredRange: input.declaredRangeText.trim() || undefined,
          fileName: jobBase.fileName
        });

  if (!parsed.ok) {
    const issues = [...parsed.warnings, ...parsed.errors];
    return {
      ok: false,
      issues,
      remedies: parsed.remedies,
      job: {
        ...jobBase,
        status: "failed",
        completedAt: new Date().toISOString(),
        issueCount: issues.length,
        errorText: issues[0]?.message ?? "解析失败"
      }
    };
  }

  const built = buildDeliveryPackageDraftFromParsed({
    projectId: input.projectId,
    uploadedByUserId: input.uploadedByUserId,
    sourceFileName: jobBase.fileName,
    parsed
  });

  return {
    ok: true,
    draft: built.draft,
    issues: built.issues,
    job: {
      ...jobBase,
      status: "success",
      completedAt: new Date().toISOString(),
      issueCount: built.issues.length
    }
  };
}

function createImportJobId(source: DeliveryImportSource, createdAt: string) {
  return `import-${source}-${Date.parse(createdAt).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
