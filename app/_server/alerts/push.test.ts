import { createDecipheriv, createECDH, createPublicKey, hkdfSync, randomBytes, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import webpush from "web-push";
import type { PushMessage } from "@/lib/alerts";
import { webPushSender, type VapidDetails } from "./push";

// A throwaway VAPID pair, made fresh for each test run.
const keys = webpush.generateVAPIDKeys();
const VAPID: VapidDetails = { subject: "https://afterglow.example", ...keys };
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/test-token";
const MESSAGE: PushMessage = {
  title: "Great sunset likely tonight (74)",
  body: "Fiery orange and red. Best near you: Hilly Fields, 8 min walk, open horizon. Leave by 16:12.",
  url: "/spots/1029_-1/09404023",
  tag: "afterglow-2026-11-03",
};

/** A browser's side of a push subscription: its key pair and auth secret. */
function browser() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return {
    ecdh,
    auth,
    target: { endpoint: ENDPOINT, keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } },
  };
}

/** Decrypts a Web Push body the way a browser does (RFC 8291, aes128gcm), without the web-push package. */
function decrypt(body: Buffer, ecdh: ReturnType<typeof createECDH>, auth: Buffer): string {
  const salt = body.subarray(0, 16);
  const idLength = body[20];
  const serverKey = body.subarray(21, 21 + idLength);
  const record = body.subarray(21 + idLength);
  const hkdf = (ikm: Buffer, salt: Buffer, info: Buffer, length: number) =>
    Buffer.from(hkdfSync("sha256", ikm, salt, info, length));
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), ecdh.getPublicKey(), serverKey]);
  const ikm = hkdf(ecdh.computeSecret(serverKey), auth, keyInfo, 32);
  const cek = hkdf(ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12);
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(record.subarray(record.length - 16));
  const padded = Buffer.concat([decipher.update(record.subarray(0, record.length - 16)), decipher.final()]);
  // The last record ends with a 0x02 delimiter, then optional zero padding.
  return padded.subarray(0, padded.lastIndexOf(2)).toString("utf8");
}

/** Checks the VAPID JWT in an Authorization header against the public key. */
function vapidClaims(authorization: string, publicKey: string) {
  const [, token, key] = /^vapid t=([^,]+), k=(.+)$/.exec(authorization) ?? [];
  expect(key).toBe(publicKey);
  const [header, payload, signature] = token.split(".");
  const raw = Buffer.from(publicKey, "base64url");
  const jwk = { kty: "EC", crv: "P-256", x: raw.subarray(1, 33).toString("base64url"), y: raw.subarray(33).toString("base64url") };
  const valid = verify(
    "sha256",
    Buffer.from(`${header}.${payload}`),
    { key: createPublicKey({ key: jwk, format: "jwk" }), dsaEncoding: "ieee-p1363" },
    Buffer.from(signature, "base64url"),
  );
  expect(valid).toBe(true);
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { aud: string; sub: string; exp: number };
}

describe("sending with web-push", () => {
  it("encrypts the message so the browser can read it, and signs it with the VAPID key", async () => {
    const { ecdh, auth, target } = browser();
    const requests: ReturnType<typeof webpush.generateRequestDetails>[] = [];
    const sender = webPushSender(VAPID, {
      // Build the real request web-push would send, without the network.
      send: async (subscription, payload, options) => {
        requests.push(webpush.generateRequestDetails(subscription, payload ?? undefined, options));
        return { statusCode: 201, body: "", headers: {} };
      },
    });

    expect(await sender.send(target, MESSAGE, { ttlSeconds: 7200 })).toEqual({ ok: true, status: 201 });
    const [request] = requests;
    expect(request.endpoint).toBe(ENDPOINT);
    expect(request.headers).toMatchObject({ TTL: 7200, Urgency: "high", "Content-Encoding": "aes128gcm" });
    expect(JSON.parse(decrypt(request.body as Buffer, ecdh, auth))).toEqual(MESSAGE);
    const claims = vapidClaims(String(request.headers.Authorization), VAPID.publicKey);
    expect(claims).toMatchObject({ aud: "https://fcm.googleapis.com", sub: "https://afterglow.example" });
    expect(claims.exp * 1000).toBeGreaterThan(Date.now());
  });

  function failing(statuses: (number | "network" | 201)[]) {
    const calls: number[] = [];
    const waits: number[] = [];
    const sender = webPushSender(VAPID, {
      send: async (subscription) => {
        const status = statuses[calls.length];
        calls.push(calls.length);
        if (status === 201) return { statusCode: 201, body: "", headers: {} };
        if (status === "network") throw new Error("socket hang up");
        throw new webpush.WebPushError("Received unexpected response code", status, {}, "", subscription.endpoint);
      },
      wait: async (ms) => {
        waits.push(ms);
      },
    });
    return { sender, calls, waits };
  }

  it("reports 404 and 410 as gone, without retrying", async () => {
    for (const status of [404, 410]) {
      const { sender, calls } = failing([status]);
      const result = await sender.send(browser().target, MESSAGE, { ttlSeconds: 60 });
      expect(result).toEqual({ ok: false, gone: true, status, error: `Received unexpected response code (${status})` });
      expect(calls).toHaveLength(1);
    }
  });

  it("doesn't retry a request the push service refuses", async () => {
    const { sender, calls } = failing([400]);
    expect(await sender.send(browser().target, MESSAGE, { ttlSeconds: 60 })).toMatchObject({ ok: false, gone: false, status: 400 });
    expect(calls).toHaveLength(1);
  });

  it("retries once after a network error or a busy push service", async () => {
    const recovered = failing([503, 201]);
    expect(await recovered.sender.send(browser().target, MESSAGE, { ttlSeconds: 60 })).toEqual({ ok: true, status: 201 });
    expect(recovered.waits).toEqual([1000]);

    const busy = failing([429, 429]);
    expect(await busy.sender.send(browser().target, MESSAGE, { ttlSeconds: 60 })).toMatchObject({ ok: false, status: 429 });
    expect(busy.calls).toHaveLength(2);

    const offline = failing(["network", "network"]);
    expect(await offline.sender.send(browser().target, MESSAGE, { ttlSeconds: 60 })).toEqual({
      ok: false,
      gone: false,
      status: null,
      error: "socket hang up",
    });
    expect(offline.calls).toHaveLength(2);
  });
});
