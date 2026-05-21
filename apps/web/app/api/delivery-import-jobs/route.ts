import { NextResponse } from "next/server";
import { createDeliveryImportJob, getDeliveryImportJobResult, getDeliveryImportWorkspace, listDeliveryImportJobs } from "./service";
import type { DeliveryImportSource } from "./service";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get("id");

  if (jobId) {
    const result = await getDeliveryImportJobResult(jobId);
    return result ? NextResponse.json(result) : NextResponse.json({ error: "delivery_import_job_not_found" }, { status: 404 });
  }

  if (searchParams.get("scope") === "workspace") {
    return NextResponse.json(await getDeliveryImportWorkspace());
  }

  return NextResponse.json({
    jobs: await listDeliveryImportJobs(searchParams.get("projectId") ?? undefined)
  });
}

export async function POST(request: Request) {
  const form = await request.formData();
  const source = readString(form, "source") as DeliveryImportSource;
  const projectId = readString(form, "projectId");
  const uploadedByUserId = readString(form, "uploadedByUserId");
  const declaredRangeText = readString(form, "declaredRangeText");

  if ((source !== "docx" && source !== "text") || !projectId || !uploadedByUserId) {
    return NextResponse.json({ error: "invalid_delivery_import_request" }, { status: 400 });
  }

  if (source === "docx") {
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "docx_file_required" }, { status: 400 });
    }

    return NextResponse.json(
      await createDeliveryImportJob({
        source,
        projectId,
        uploadedByUserId,
        declaredRangeText,
        fileName: file.name,
        fileBuffer: await file.arrayBuffer()
      })
    );
  }

  return NextResponse.json(
    await createDeliveryImportJob({
      source,
      projectId,
      uploadedByUserId,
      declaredRangeText,
      fileName: readString(form, "fileName") || "pasted-word-text.txt",
      rawText: readString(form, "rawText")
    })
  );
}

function readString(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}
