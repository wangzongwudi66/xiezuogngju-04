import { NextResponse } from "next/server";
import { readDeliveryImportWorkspace } from "../delivery-import-jobs/persistence";
import {
  clearedWorkspaceSessionCookieOptions,
  createWorkspaceSessionCookieValue,
  WORKSPACE_SESSION_COOKIE_NAME,
  workspaceSessionCookieOptions,
  WorkspaceSessionSecretMissingError
} from "./session-cookie";

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
    if (!userId) {
      const response = NextResponse.json({ ok: true, currentUserId: null });
      response.cookies.set(WORKSPACE_SESSION_COOKIE_NAME, "", clearedWorkspaceSessionCookieOptions());
      return response;
    }

    const snapshot = await readDeliveryImportWorkspace();

    if (!snapshot.state.users.some((user) => user.id === userId)) {
      return NextResponse.json({ ok: false, error: "user_not_found" }, { status: 404 });
    }

    const response = NextResponse.json({ ok: true, currentUserId: userId });
    response.cookies.set(WORKSPACE_SESSION_COOKIE_NAME, createWorkspaceSessionCookieValue(userId), workspaceSessionCookieOptions());
    return response;
  } catch (error) {
    if (error instanceof WorkspaceSessionSecretMissingError) {
      return NextResponse.json({ ok: false, error: "workspace_session_secret_required" }, { status: 500 });
    }

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
