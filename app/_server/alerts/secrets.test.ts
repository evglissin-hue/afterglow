import { describe, expect, it } from "vitest";
import webpush from "web-push";
import { loadAlertSecrets } from "./secrets";

// The requests loadAlertSecrets sends to Supabase's REST API, answered without a database.

const CRON = "f".repeat(64);

interface Seen {
  method: string;
  params: Record<string, string>;
  prefer: string | null;
  body: unknown;
}

/** Answers each request in turn; an answer of `{ status, body }` is sent as an error. */
function fakeSupabase(answers: unknown[]) {
  const seen: Seen[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    expect(url.pathname).toBe("/rest/v1/app_settings");
    const headers = new Headers(init?.headers);
    seen.push({
      method: init?.method ?? "GET",
      params: Object.fromEntries(url.searchParams),
      prefer: headers.get("prefer"),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    const answer = answers.shift() as { status?: number; body?: unknown } | unknown[] | undefined;
    const status = !Array.isArray(answer) && answer?.status ? answer.status : 200;
    const body = Array.isArray(answer) ? answer : (answer as { body?: unknown } | undefined)?.body ?? [];
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  return { seen, load: () => loadAlertSecrets("https://project.supabase.co", "secret-key", fetch) };
}

const vapidRow = (keys: { publicKey: string; privateKey: string }) => ({ key: "vapid", value: JSON.stringify(keys) });

describe("the alert server's own secrets", () => {
  it("reads the push keys and the cron secret", async () => {
    const keys = webpush.generateVAPIDKeys();
    const { seen, load } = fakeSupabase([[vapidRow(keys), { key: "cron_secret", value: CRON }]]);
    await expect(load()).resolves.toEqual({ vapidPublicKey: keys.publicKey, vapidPrivateKey: keys.privateKey, cronSecret: CRON });
    expect(seen).toHaveLength(1);
    expect(seen[0].params).toMatchObject({ select: "key,value", key: "in.(vapid,cron_secret)" });
  });

  it("makes push keys the first time, without overwriting keys another server saved first", async () => {
    const theirs = webpush.generateVAPIDKeys();
    const { seen, load } = fakeSupabase([[{ key: "cron_secret", value: CRON }], [], [vapidRow(theirs), { key: "cron_secret", value: CRON }]]);
    const secrets = await load();
    expect(seen.map((s) => s.method)).toEqual(["GET", "POST", "GET"]);
    expect(seen[1].params.on_conflict).toBe("key");
    expect(seen[1].prefer).toContain("resolution=ignore-duplicates");
    const saved = seen[1].body as { key: string; value: string };
    expect(saved.key).toBe("vapid");
    const made = JSON.parse(saved.value) as { publicKey: string; privateKey: string };
    expect(Buffer.from(made.publicKey, "base64url")).toHaveLength(65);
    expect(Buffer.from(made.privateKey, "base64url")).toHaveLength(32);
    // Whatever is in the table after saving wins: here, keys another server saved a moment earlier.
    expect(secrets.vapidPublicKey).toBe(theirs.publicKey);
    expect(secrets.vapidPrivateKey).toBe(theirs.privateKey);
  });

  it("explains what's missing", async () => {
    const keys = webpush.generateVAPIDKeys();
    await expect(fakeSupabase([[vapidRow(keys)]]).load()).rejects.toThrow(/run supabase\/schema\.sql/);
    const missingTable = { status: 404, body: { code: "42P01", message: 'relation "public.app_settings" does not exist' } };
    await expect(fakeSupabase([missingTable]).load()).rejects.toThrow(/has supabase\/schema\.sql been run/);
    const broken = { key: "vapid", value: JSON.stringify({ publicKey: "short", privateKey: "short" }) };
    await expect(fakeSupabase([[broken, { key: "cron_secret", value: CRON }], [], [broken]]).load()).rejects.toThrow(/aren't valid/);
  });
});
