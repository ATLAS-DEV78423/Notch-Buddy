# Notch-Buddy relay

A tiny Cloudflare Worker that lets the Mac app start and update the iPhone's
Live Activity (Pip in the Dynamic Island while the Mac is locked).

Why it exists: Live Activity pushes must be signed with the APNs key, and that
key can't ship inside the Mac app. The Mac posts Pip's state here; the relay
signs and forwards it to Apple.

What it sees: the push token of the iPhone's Live Activity and Pip's state
(agent name, state, "working · 3/7", counts), plus, while a command waits for
your OK, its fingerprint (a SHA-256 hash, so the Lock Screen's Allow and Deny
answer that exact command). Never a project name, a command, a path or a
message. It stores nothing and logs nothing.

Every request is authenticated with a 32-byte per-install secret generated on
the paired Mac and stored in its Keychain. The secret is sent only over HTTPS
in `X-Relay-Secret`; the HMAC also covers the exact request body, timestamp and
nonce. The iPhone does not receive this secret: the existing encrypted
CloudKit `PhoneToken` pairing continues to deliver only APNs Live Activity
tokens, while the Mac is the only relay client. This avoids adding a new
backend or putting a Mac credential in iCloud.

## Deploy (once)

1. Apple Developer → Certificates, Identifiers & Profiles → **Keys** → **+**.
   Name it "Notch-Buddy relay", tick **Apple Push Notifications service (APNs)**,
   environment **Sandbox & Production**, Continue, Register, **Download** the
   `AuthKey_XXXXXXXXXX.p8` (only downloadable once). Note the **Key ID**.
2. A free Cloudflare account, then in this folder:
   ```
   npm install
   npx wrangler login
   npx wrangler secret put APNS_KEY_ID      # paste the Key ID
   npx wrangler secret put APNS_KEY < ~/Downloads/AuthKey_XXXXXXXXXX.p8
   npx wrangler deploy
   ```
   `deploy` prints the URL, like `https://coucou-relay.<you>.workers.dev`.
3. Check it: `curl https://coucou-relay.<you>.workers.dev/` answers "Notch-Buddy relay".

## Tests

```sh
npm run typecheck
npm test
```

The tests use a deterministic clock and a fake APNs response; they never make
network calls. They cover HMAC validation, freshness, replay, request shape,
rate limiting, and APNs 200/410/error mapping.

## API

`POST /v1/live-activity` keeps the JSON payload below. Unknown top-level or
state fields are rejected, so the relay cannot be used as an arbitrary APNs
forwarder.

```json
{ "token": "<hex>", "env": "development|production", "event": "start|update|end",
  "state": { "pillId": "", "agent": "", "color": "", "state": "", "statusText": "",
             "tone": "", "stepIndex": 0, "stepCount": 0, "others": 0 },
  "urgent": false, "dismissAfter": 0 }
```

The Mac adds these headers on every request:

- `X-Relay-Client`: SHA-256 of the 32-byte Keychain secret, as 64 lowercase hex.
- `X-Relay-Secret`: the 32-byte secret, as 64 lowercase hex, transported only over HTTPS.
- `X-Relay-Timestamp`: current Unix seconds.
- `X-Relay-Nonce`: 16 random bytes as 32 lowercase hex.
- `X-Relay-Signature`: HMAC-SHA256(secret, `timestamp.nonce.rawBody`) as 64 lowercase hex.

The Worker accepts timestamps within five minutes, rejects a nonce replay, and
rate-limits each client to 60 requests/minute and each client/token pair to 20
requests/minute per Worker isolate. The limits are deliberately in-memory:
the relay remains stateless, so they are best-effort across isolate restarts.

200 when Apple accepted the push, 410 when the token is no longer valid,
400 when the JSON is malformed, 401 for failed/stale/replayed authentication,
429 for rate limiting, and 502 for an upstream APNs failure.
