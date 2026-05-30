export function isSameOriginMutatingRequest(request: Request) {
  const secFetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase();

  if (secFetchSite === "cross-site") {
    return false;
  }

  const origin = request.headers.get("origin")?.trim();

  if (!origin) {
    return true;
  }

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function requireSameOriginMutatingRequest(request: Request, errorMessage = "request_origin_forbidden") {
  if (!isSameOriginMutatingRequest(request)) {
    throw new Error(errorMessage);
  }
}
