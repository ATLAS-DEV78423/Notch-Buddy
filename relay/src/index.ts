// Coucou relay — a stateless Cloudflare Worker.
//
// The Mac app can't send Live Activity pushes itself: that needs the APNs key,
// which must never ship in an app. The Mac posts Mochi's state here, the
// relay signs and forwards the push. Requests are authenticated with a
// per-install secret held in the Mac Keychain; the secret is sent only over
// HTTPS because this worker has no durable per-install registry.

export interface Env {
  APNS_KEY: string;
  APNS_KEY_ID: string;
  APNS_TEAM_ID: string;
  APNS_TOPIC: string;
}

type Event = "start" | "update" | "end";

interface RelayRequest {
  token: string;
  env: "development" | "production";
  event: Event;
  state: Record<string, unknown>;
  urgent?: boolean;
  dismissAfter?: number;
}

const STATE_STRINGS = ["pillId", "agent", "color", "state", "statusText", "tone"] as const;
const STATE_NUMBERS = ["stepIndex", "stepCount", "others"] as const;
const TOP_LEVEL_KEYS = new Set(["token", "env", "event", "state", "urgent", "dismissAfter"]);
const STATE_KEYS = new Set([...STATE_STRINGS, ...STATE_NUMBERS, "since", "approval"]);
const AUTH_WINDOW_SECONDS = 5 * 60;
const MAX_REQUESTS_PER_CLIENT = 60;
const MAX_REQUESTS_PER_TOKEN = 20;

export interface RelayState {
  nonces: Map<string, number>;
  limits: Map<string, { window: number; count: number }>;
}

export function newRelayState(): RelayState {
  return { nonces: new Map(), limits: new Map() };
}

const defaultRelayState = newRelayState();

interface Dependencies {
  now?: () => number;
  fetch?: typeof globalThis.fetch;
  providerToken?: (env: Env) => Promise<string>;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};

export async function handleRequest(
  request: Request,
  env: Env,
  dependencies: Dependencies = {},
  state: RelayState = defaultRelayState,
): Promise<Response> {
  const now = dependencies.now ?? (() => Math.floor(Date.now() / 1000));
  const currentTime = now();
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/") return text(200, "Coucou relay");
  if (request.method !== "POST" || url.pathname !== "/v1/live-activity") return text(404, "not found");

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > 4096) return text(413, "too large");
  const bodyBytes = new Uint8Array(await request.arrayBuffer());
  if (bodyBytes.byteLength > 4096) return text(413, "too large");
  const bodyText = new TextDecoder().decode(bodyBytes);
  let body: RelayRequest;
  try {
    body = JSON.parse(bodyText) as RelayRequest;
  } catch {
    return text(400, "bad json");
  }

  const problem = validate(body);
  if (problem) return text(400, problem);
  const authProblem = await authenticate(request.headers, body.token, bodyText, currentTime, state);
  if (authProblem) return text(authProblem === "rate" ? 429 : 401, authProblem === "rate" ? "rate limit" : authProblem);

  const payload = buildPayload(body, currentTime);
  const host = body.env === "production" ? "api.push.apple.com" : "api.sandbox.push.apple.com";
  const jwt = await (dependencies.providerToken ?? providerToken)(env);
  const apnsFetch = dependencies.fetch ?? globalThis.fetch;
  const apns = await apnsFetch(`https://${host}/3/device/${body.token}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${jwt}`,
      "apns-topic": env.APNS_TOPIC,
      "apns-push-type": "liveactivity",
      "apns-priority": body.urgent || body.event !== "update" ? "10" : "5",
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (apns.status === 200) return text(200, "ok");
  const reason = await apns.text();
  return new Response(reason || "{}", {
    status: apns.status === 410 ? 410 : 502,
    headers: { "content-type": "application/json", "x-apns-status": String(apns.status) },
  });
}

async function authenticate(
  headers: Headers,
  token: string,
  bodyText: string,
  now: number,
  state: RelayState,
): Promise<string | null> {
  const client = headers.get("x-relay-client") ?? "";
  const secret = headers.get("x-relay-secret") ?? "";
  const timestampText = headers.get("x-relay-timestamp") ?? "";
  const nonce = headers.get("x-relay-nonce") ?? "";
  const signature = headers.get("x-relay-signature") ?? "";
  if (!/^[0-9a-f]{64}$/.test(client) || !/^[0-9a-f]{64}$/.test(secret) ||
      !/^\d{10}$/.test(timestampText) || !/^[0-9a-f]{32}$/.test(nonce) ||
      !/^[0-9a-f]{64}$/.test(signature)) return "auth";

  const timestamp = Number(timestampText);
  if (Math.abs(now - timestamp) > AUTH_WINDOW_SECONDS) return "stale";
  if (await clientIdForSecret(secret) !== client) return "auth";

  const expected = await signRequest(secret, timestampText, nonce, bodyText);
  if (!constantTimeEqual(expected, signature)) return "auth";

  const nonceKey = `${client}:${nonce}`;
  for (const [key, seenAt] of state.nonces) {
    if (now - seenAt > AUTH_WINDOW_SECONDS) state.nonces.delete(key);
  }
  if (state.nonces.has(nonceKey)) return "replay";
  state.nonces.set(nonceKey, now);

  if (!consumeLimit(state, `client:${client}`, now, MAX_REQUESTS_PER_CLIENT) ||
      !consumeLimit(state, `token:${client}:${token}`, now, MAX_REQUESTS_PER_TOKEN)) return "rate";
  return null;
}

function consumeLimit(state: RelayState, key: string, now: number, limit: number): boolean {
  const window = Math.floor(now / 60);
  const previous = state.limits.get(key);
  if (!previous || previous.window !== window) {
    state.limits.set(key, { window, count: 1 });
    return true;
  }
  if (previous.count >= limit) return false;
  previous.count += 1;
  return true;
}

export async function clientIdForSecret(secret: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", hexBytes(secret))));
}

export async function signRequest(secret: string, timestamp: string, nonce: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", hexBytes(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC", key, new TextEncoder().encode(`${timestamp}.${nonce}.${body}`),
  );
  return hex(new Uint8Array(signature));
}

function hexBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}

export function validate(body: RelayRequest): string | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return "body";
  if (Object.keys(body).some(key => !TOP_LEVEL_KEYS.has(key))) return "body.keys";
  if (typeof body.token !== "string" || !/^[0-9a-f]{32,400}$/i.test(body.token)) return "token";
  if (body.env !== "development" && body.env !== "production") return "env";
  if (!["start", "update", "end"].includes(body.event)) return "event";
  if (typeof body.state !== "object" || body.state === null || Array.isArray(body.state)) return "state";
  if (Object.keys(body.state).some(key => !STATE_KEYS.has(key))) return "state.keys";
  for (const key of STATE_STRINGS) {
    const value = body.state[key];
    if (typeof value !== "string" || value.length > 60) return `state.${key}`;
  }
  for (const key of STATE_NUMBERS) {
    const value = body.state[key];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 999) return `state.${key}`;
  }
  if (body.urgent !== undefined && typeof body.urgent !== "boolean") return "urgent";
  const since = body.state["since"];
  if (since !== undefined && since !== null &&
      (typeof since !== "number" || !Number.isInteger(since) || since < 1_600_000_000 || since > 4_000_000_000)) return "state.since";
  const approval = body.state["approval"];
  if (approval !== undefined && approval !== null &&
      (typeof approval !== "string" || !/^[0-9a-f]{64}$/.test(approval))) return "state.approval";
  if (body.dismissAfter !== undefined &&
      (typeof body.dismissAfter !== "number" || !Number.isInteger(body.dismissAfter) ||
       body.dismissAfter < 0 || body.dismissAfter > 4 * 3600)) return "dismissAfter";
  return null;
}

function buildPayload(body: RelayRequest, now: number) {
  const state: Record<string, unknown> = {};
  for (const key of [...STATE_STRINGS, ...STATE_NUMBERS]) state[key] = body.state[key];
  if (typeof body.state["since"] === "number") state["since"] = body.state["since"];
  if (typeof body.state["approval"] === "string") state["approval"] = body.state["approval"];

  const aps: Record<string, unknown> = {
    timestamp: now,
    event: body.event,
    "content-state": state,
    "stale-date": now + 15 * 60,
  };
  if (body.event === "start") {
    aps["attributes-type"] = "MochiActivityAttributes";
    aps["attributes"] = {};
    aps["alert"] = { title: "Coucou", body: `${state.agent} · ${state.statusText}` };
  }
  if (body.event === "update" && body.urgent) {
    aps["alert"] = { title: String(state.agent), body: String(state.statusText) };
  }
  if (body.event === "end") aps["dismissal-date"] = now + (body.dismissAfter ?? 0);
  return { aps };
}

let cached: { jwt: string; issuedAt: number; keyId: string } | null = null;

async function providerToken(env: Env): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.keyId === env.APNS_KEY_ID && now - cached.issuedAt < 50 * 60) return cached.jwt;

  const header = base64url(JSON.stringify({ alg: "ES256", kid: env.APNS_KEY_ID }));
  const claims = base64url(JSON.stringify({ iss: env.APNS_TEAM_ID, iat: now }));
  const key = await crypto.subtle.importKey(
    "pkcs8", pemToDer(env.APNS_KEY), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${header}.${claims}`),
  );
  const jwt = `${header}.${claims}.${base64url(new Uint8Array(signature))}`;
  cached = { jwt, issuedAt: now, keyId: env.APNS_KEY_ID };
  return jwt;
}

function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return bytes.buffer;
}

function base64url(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function text(status: number, message: string): Response {
  return new Response(message, { status, headers: { "content-type": "text/plain" } });
}
