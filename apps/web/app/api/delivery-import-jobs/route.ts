import { NextResponse } from "next/server";
import { runDeliveryImportJob } from "./service";
import type { DeliveryImportSource } from "./service";

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
      await runDeliveryImportJob({
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
    await runDeliveryImportJob({
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
