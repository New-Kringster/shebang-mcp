// Thin HTTP client over the shebang platform's public
// /api/{sherpage,platform,sherbase,sherserve,sherlink}/v1 routes. Collapses
// what used to be five near-identical <service>ApiRequest/<service>ApiCall
// pairs in index.js (one per service, each closing over a module-level
// API_KEY and its own *_API_BASE constant, differing only in base path and
// error-message prefix — sherserve's pair additionally skipped
// JSON-encoding a FormData body) into one parameterized factory.
//
// apiKey/baseUrl are constructor arguments, not module constants — this is
// the seam a hosted-MCP caller needs: it can build a fresh apiClient per
// request, carrying that request's own bearer token, rather than a fixed
// process-wide key.
//
// authorizationHeader (optional) lets a caller that already holds the
// caller's exact `Authorization` header value (the dash hosted MCP route,
// stage 19) forward it byte-for-byte instead of this module reconstructing
// `Bearer ${apiKey}` from an already-Bearer-extracted token a second time.
// Every existing call site (the stdio CLI in index.js) never passes it, so
// `Bearer ${apiKey}` remains the default, unchanged behavior.

const SERVICE_PATHS = {
  sherpage: "/api/sherpage/v1",
  platform: "/api/platform/v1",
  sherbase: "/api/sherbase/v1",
  sherserve: "/api/sherserve/v1",
  sherlink: "/api/sherlink/v1",
};

/**
 * Readable tool error: status + error field, never a stack trace.
 * Carries the response's status and parsed body (when the failure came
 * from a non-ok HTTP response) so callers that need to branch on a
 * specific status/error-code combination — e.g. key_revoke's
 * cannot_revoke_current_key, email_send's email_quota_exceeded — can
 * inspect `status`/`data` on the caught error instead of needing a
 * separate non-throwing request primitive.
 */
export class ToolError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, data?: unknown }} [details]
   */
  constructor(message, { status, data } = {}) {
    super(message);
    this.name = "ToolError";
    this.status = status;
    this.data = data;
  }
}

/**
 * @param {{ apiKey: string, baseUrl: string, authorizationHeader?: string }} config
 * @returns {{ [K in keyof typeof SERVICE_PATHS]: (method: string, path: string, body?: unknown) => Promise<unknown> }}
 */
export function createApiClient({ apiKey, baseUrl, authorizationHeader }) {
  async function call(service, method, path, body) {
    const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
    let response;
    try {
      response = await fetch(`${baseUrl}${SERVICE_PATHS[service]}${path}`, {
        method,
        headers: {
          authorization: authorizationHeader ?? `Bearer ${apiKey}`,
          ...(body !== undefined && !isFormData ? { "content-type": "application/json" } : {}),
        },
        body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
      });
    } catch (err) {
      throw new ToolError(`request to ${service} API failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (response.status === 204) return null;

    const text = await response.text();
    let data;
    try {
      data = text.length > 0 ? JSON.parse(text) : null;
    } catch {
      data = { error: text || `invalid response from ${service} API` };
    }

    if (!response.ok) {
      const errorField = data && typeof data === "object" && "error" in data ? data.error : JSON.stringify(data);
      throw new ToolError(`${service} API error ${response.status}: ${errorField}`, { status: response.status, data });
    }
    return data;
  }

  return Object.fromEntries(
    Object.keys(SERVICE_PATHS).map((service) => [service, (method, path, body) => call(service, method, path, body)]),
  );
}
