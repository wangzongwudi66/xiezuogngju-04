import { createHmac, timingSafeEqual } from "node:crypto";

export const WORKSPACE_SESSION_COOKIE_NAME = "aigc_workspace_session";
export const WORKSPACE_SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

interface WorkspaceSessionPayload {
  v: 1;
  userId: string;
  issuedAt: number;
  expiresAt: number;
}

export class WorkspaceSessionSecretMissingError extends Error {
  constructor() {
    super("workspace_session_secret_required");
  }
}

export function createWorkspaceSessionCookieValue(userId: string, now = Date.now()) {
  const payload: WorkspaceSessionPayload = {
    v: 1,
    userId,
    issuedAt: now,
    expiresAt: now + WORKSPACE_SESSION_COOKIE_MAX_AGE_SECONDS * 1000
  };
  const payloadPart = base64UrlEncode(JSON.stringify(payload));
  const signaturePart = sign(payloadPart);

  return `v1.${payloadPart}.${signaturePart}`;
}

export function readWorkspaceSessionCookieUserId(cookieHeader: string | null, now = Date.now()) {
  const value = readCookie(cookieHeader, WORKSPACE_SESSION_COOKIE_NAME);

  if (!value) {
    return null;
  }

  return verifyWorkspaceSessionCookieValue(value, now)?.userId ?? null;
}

export function verifyWorkspaceSessionCookieValue(value: string, now = Date.now()): WorkspaceSessionPayload | null {
  const [version, payloadPart, signaturePart] = value.split(".");

  if (version !== "v1" || !payloadPart || !signaturePart) {
    return null;
  }

  if (!constantTimeEqual(signaturePart, sign(payloadPart))) {
    return null;
  }

  const payload = parsePayload(payloadPart);

  if (!payload || payload.expiresAt <= now) {
    return null;
  }

  return payload;
}

export function workspaceSessionCookieOptions() {
  return {
    httpOnly: true,
    maxAge: WORKSPACE_SESSION_COOKIE_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production"
  };
}

export function clearedWorkspaceSessionCookieOptions() {
  return {
    ...workspaceSessionCookieOptions(),
    maxAge: 0
  };
}

function sign(payloadPart: string) {
  return createHmac("sha256", readSecret()).update(payloadPart).digest("base64url");
}

function readSecret() {
  const secret = process.env.AIGC_WORKSPACE_SESSION_SECRET?.trim();

  if (!secret) {
    throw new WorkspaceSessionSecretMissingError();
  }

  return secret;
}

function parsePayload(payloadPart: string): WorkspaceSessionPayload | null {
  try {
    const value = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));

    if (!isRecord(value) || value.v !== 1 || typeof value.userId !== "string") {
      return null;
    }

    const issuedAt = value.issuedAt;
    const expiresAt = value.expiresAt;

    if (typeof issuedAt !== "number" || typeof expiresAt !== "number" || !Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) {
      return null;
    }

    const userId = value.userId.trim();

    if (!userId) {
      return null;
    }

    return {
      v: 1,
      userId,
      issuedAt,
      expiresAt
    };
  } catch {
    return null;
  }
}

function readCookie(cookieHeader: string | null, name: string) {
  if (!cookieHeader) {
    return null;
  }

  for (const item of cookieHeader.split(";")) {
    const [rawName, ...rawValueParts] = item.trim().split("=");

    if (rawName === name) {
      return rawValueParts.join("=") || null;
    }
  }

  return null;
}

function constantTimeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
