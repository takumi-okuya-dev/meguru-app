// 無認証のWebhookの本文の上限（セキュリティ監査 run-1 の
// `apps/api/src/app.ts:anon-webhook-unbounded-body-before-verify`）。
//
// 資格情報なしで届くPOSTは3本だけ（Stripe と Meta の2本）。どれも署名を確かめる**前**に
// 本文を丸ごと読む。Stripe は `c.req.text()` で読んでから `${t}.${body}` を UTF-8 の
// バイト列にして HMAC-SHA256 をかけ、Meta は `parseBody()` で読んでから base64url を
// 1バイトずつのJSループで復号して `JSON.parse` する。
//
// `hono/body-limit` はこのリポジトリで1か所だけ使われていて、それは**認証済み**の
// `POST /threads/token-connect` の8KiB上限だった。specs/010 verification.md:56 に
// 「読み終えてから測らず、読みながら上限を当てる」という自分で決めた規則まであるのに、
// 無認証の3本には付いていなかった。
import { describe, expect, it } from "vitest";
import type { Env } from "../../src/kernel/env";
import { makeApp, testEnv } from "../helpers/app";

const app = makeApp();
// Stripe の経路は決済OFFだと本文を読む前に 404 で返るので、ONの環境で確かめる
const billingOn = { ...testEnv, BILLING_ENABLED: "true" } as Env;

/** Stripe の署名の形だけ合わせたヘッダ（秘密は知らなくても作れる）。 */
const fakeStripeSignature = () => `t=${Math.floor(Date.now() / 1000)},v1=00`;

/**
 * 長さを名乗らずに本文を流し込む（Content-Length を付けない）。
 * @param path - 送り先
 * @param headers - ヘッダ
 * @param chunks - 4KiBの塊をいくつ送るか
 * @param env - Workers のバインディング
 * @returns 応答と、実際に送った塊の数
 */
async function stream(path: string, headers: Record<string, string>, chunks: number, env: Env = testEnv) {
  const chunk = new TextEncoder().encode("a".repeat(4096));
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= chunks) return controller.close();
      sent += 1;
      controller.enqueue(chunk);
    },
  });
  const res = await app.request(
    path,
    // @ts-expect-error duplex は Request の初期化で要る（型に入っていない）
    { method: "POST", headers, body, duplex: "half" },
    env,
  );
  return { res, sent: () => sent };
}

describe("無認証のWebhookの本文の上限", () => {
  it("Stripe：大きすぎる本文は、署名を確かめる前に 400 で止める", async () => {
    const res = await app.request(
      "/api/stripe/webhook",
      { method: "POST", headers: { "Stripe-Signature": fakeStripeSignature() }, body: "a".repeat(300_000) },
      billingOn,
    );
    expect(res.status).toBe(400);
  });

  it("Stripe：長さを名乗らない流し込みも、読み込みの途中で止める", async () => {
    const { res, sent } = await stream("/api/stripe/webhook", { "Stripe-Signature": fakeStripeSignature() }, 128, billingOn);
    expect(res.status).toBe(400);
    // 全部（128×4KiB=512KiB）読み切る前に止まる
    expect(sent()).toBeLessThan(128);
  });

  it("Stripe：ふつうの大きさの本文は、上限に引っかからず署名の検証まで進む", async () => {
    // 署名が合わないので 400 になるが、止まる理由が上限ではないことを確かめる
    const res = await app.request(
      "/api/stripe/webhook",
      { method: "POST", headers: { "Stripe-Signature": fakeStripeSignature() }, body: JSON.stringify({ type: "invoice.paid", data: { object: { customer: "cus_x" } } }) },
      billingOn,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { message?: string } };
    expect(body.error?.message).toBe("invalid signature");
  });

  it.each(["uninstall", "data-deletion"])("Meta（%s）：大きすぎる本文は、署名を確かめる前に 400 で止める", async (kind) => {
    const res = await app.request(
      `/api/threads/webhooks/${kind}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `signed_request=${"a".repeat(20_000)}`,
      },
      testEnv,
    );
    expect(res.status).toBe(400);
  });

  it.each(["uninstall", "data-deletion"])("Meta（%s）：長さを名乗らない流し込みも、読み込みの途中で止める", async (kind) => {
    const { res, sent } = await stream(
      `/api/threads/webhooks/${kind}`,
      { "Content-Type": "application/x-www-form-urlencoded" },
      32,
    );
    expect(res.status).toBe(400);
    expect(sent()).toBeLessThan(32);
  });

  it.each(["uninstall", "data-deletion"])("Meta（%s）：ふつうの大きさなら、上限ではなく署名で 400 になる", async (kind) => {
    // signed_request の形が違えば SignedRequestError で 400。上限で止まっていないことの確認
    const res = await app.request(
      `/api/threads/webhooks/${kind}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "signed_request=not-a-signed-request",
      },
      testEnv,
    );
    expect(res.status).toBe(400);
  });
});
