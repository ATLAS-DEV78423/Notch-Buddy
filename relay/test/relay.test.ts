import assert from "node:assert/strict";
import { test } from "node:test";
import { clientIdForSecret, handleRequest, newRelayState, signRequest } from "../src/index.ts";

const secret = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const token = "0123456789abcdef0123456789abcdef";
const now = 1_760_000_000;
const env = { APNS_KEY: "unused", APNS_KEY_ID: "kid", APNS_TEAM_ID: "team", APNS_TOPIC: "topic" };
const state = () => ({
  pillId: "claude", agent: "Claude", color: "#fff", state: "working",
  statusText: "working", tone: "working", stepIndex: 1, stepCount: 2, others: 0,
});

async function request(overrides: Record<string, unknown> = {}, auth: Record<string, string> = {}) {
  const body = JSON.stringify({ token, env: "development", event: "update", urgent: false, state: state(), ...overrides });
  const timestamp = String(now);
  const nonce = auth["x-relay-nonce"] ?? "abcdefabcdefabcdefabcdefabcdefab";
  const client = await clientIdForSecret(secret);
  const signature = await signRequest(secret, timestamp, nonce, body);
  return new Request("https://relay.test/v1/live-activity", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "x-relay-client": client,
      "x-relay-secret": secret,
      "x-relay-timestamp": timestamp,
      "x-relay-nonce": nonce,
      "x-relay-signature": auth["x-relay-signature"] ?? signature,
    },
  });
}

const deps = (status = 200) => ({
  now: () => now,
  providerToken: async () => "test.jwt",
  fetch: async () => new Response(status === 200 ? "" : JSON.stringify({ reason: "BadDeviceToken" }), { status }),
});

test("accepts a signed request and forwards only the APNs payload", async () => {
  let forwarded: RequestInit | undefined;
  const response = await handleRequest(await request(), env, {
    ...deps(),
    fetch: async (_url: RequestInfo | URL, init?: RequestInit) => {
      forwarded = init;
      return new Response("", { status: 200 });
    },
  }, newRelayState());
  assert.equal(response.status, 200);
  assert.equal(forwarded?.headers && new Headers(forwarded.headers).get("x-relay-secret"), null);
  const payload = JSON.parse(String(forwarded?.body));
  assert.deepEqual(Object.keys(payload.aps["content-state"]).sort(), ["agent", "color", "others", "pillId", "state", "statusText", "stepCount", "stepIndex", "tone"]);
});

test("rejects a bad signature before APNs", async () => {
  let called = false;
  const response = await handleRequest(await request({}, { "x-relay-signature": "f".repeat(64) }), env, {
    ...deps(), fetch: async () => { called = true; return new Response("", { status: 200 }); },
  }, newRelayState());
  assert.equal(response.status, 401);
  assert.equal(called, false);
});

test("rejects stale and replayed requests", async () => {
  const replayState = newRelayState();
  const first = await handleRequest(await request(), env, deps(), replayState);
  const second = await handleRequest(await request(), env, deps(), replayState);
  assert.equal(first.status, 200);
  assert.equal(second.status, 401);

  const stale = await handleRequest(await request(), env, { ...deps(), now: () => now + 301 }, newRelayState());
  assert.equal(stale.status, 401);
  assert.equal(await stale.text(), "stale");
});

test("rejects unknown request fields", async () => {
  const response = await handleRequest(await request({ extra: true }), env, deps(), newRelayState());
  assert.equal(response.status, 400);
  assert.equal(await response.text(), "body.keys");
});

test("limits a client/token to 20 requests per minute", async () => {
  const limitedState = newRelayState();
  for (let i = 0; i < 20; i++) {
    const nonce = i.toString(16).padStart(32, "0");
    assert.equal((await handleRequest(await request({}, { "x-relay-nonce": nonce }), env, deps(), limitedState)).status, 200);
  }
  const response = await handleRequest(await request({}, { "x-relay-nonce": "f".repeat(32) }), env, deps(), limitedState);
  assert.equal(response.status, 429);
});

for (const [apnsStatus, relayStatus] of [[200, 200], [410, 410], [500, 502]] as const) {
  test(`maps APNs ${apnsStatus} to relay ${relayStatus}`, async () => {
    const response = await handleRequest(await request(), env, deps(apnsStatus), newRelayState());
    assert.equal(response.status, relayStatus);
    if (apnsStatus !== 200) assert.equal(response.headers.get("x-apns-status"), String(apnsStatus));
  });
}
