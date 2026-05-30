import { logout } from "@aigc/domain";
import { NextResponse } from "next/server";
import { mutateDeliveryImportWorkspace, readDeliveryImportWorkspace } from "../delivery-import-jobs/persistence";

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_workspace_session_request" }, { status: 400 });
  }

  if (!isRecord(body) || !("userId" in body)) {
    return NextResponse.json({ ok: false, error: "invalid_workspace_session_request" }, { status: 400 });
  }

  const userId = readNullableString(body.userId);

  if (userId === undefined) {
    return NextResponse.json({ ok: false, error: "invalid_workspace_session_request" }, { status: 400 });
  }

  try {
    if (userId) {
      const snapshot = await readDeliveryImportWorkspace();

      if (!snapshot.state.users.some((user) => user.id === userId)) {
        return NextResponse.json({ ok: false, error: "user_not_found" }, { status: 404 });
      }
    }

    const snapshot = await mutateDeliveryImportWorkspace((state) => (userId ? { ...state, currentUserId: userId } : logout(state)));
    return NextResponse.json({ ok: true, currentUserId: snapshot.state.currentUserId });
  } catch {
    return NextResponse.json({ ok: false, error: "user_not_found" }, { status: 404 });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readNullableString(value: unknown) {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}
