// US1：自分のMetaアプリのトークンでの追加（specs/010-token-account-add contracts/api.md、FR-010〜FR-015）。
// specs/012 で「トークンでアカウントを作る」は「名前で作ったアカウントに、トークンではじめてつなぐ」（mode = connect）になった。
import { neon } from "@neondatabase/serverless";
import { beforeEach, describe, expect, it } from "vitest";
import { runDailyJobs } from "../../src/services/daily-jobs";
import { call, createAccountVia, fake, makeApp, resetDb, testEnv } from "../helpers/app";

const app = makeApp();
const q = () => neon(testEnv.DATABASE_URL);
const DAY = 86_400_000;

beforeEach(async () => {
  await resetDb();
  await fake.reset();
  await fake.addUser("9003", "cafe_b", "Cafe B");
  await fake.addUser("9004", "shop_c", "Shop C");
  await testEnv.AUTOPOST_KV.delete("autopost:wake");
});

type Ok = { accountId: string; kind: "connect" | "reconnect"; username: string; warnings: string[] };
const codeOf = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

/**
 * その人の未接続のアカウント（なければ作る）。
 * @param user - Clerk のユーザーID
 * @returns accounts.id
 */
async function targetFor(user: string): Promise<string> {
  const [row] = (await q()`
    SELECT a.id FROM accounts a JOIN memberships m ON m.account_id = a.id AND m.role = 'owner' JOIN users u ON u.id = m.user_id
    WHERE u.clerk_user_id = ${user} AND a.connection_status = 'not_connected' ORDER BY a.created_at LIMIT 1`) as { id: string }[];
  if (row) return row.id;
  const { accountId } = await createAccountVia(app, user);
  if (!accountId) throw new Error(`could not create an account for ${user}`);
  return accountId;
}

/**
 * その人の未接続のアカウントに、トークンではじめてつなぐ（specs/012）。
 * @param token - 貼り付けるトークン
 * @param user - Clerk のユーザーID
 * @returns 応答
 */
async function add(token: string, user = "u1") {
  const accountId = await targetFor(user);
  return call(app, "POST", "/api/threads/token-connect", { user, body: { mode: "connect", accountId, token } });
}

async function accountRow(id: string) {
  const [a] = (await q()`
    SELECT a.*, c.expires_at, c.issued_at, c.recheck_at, c.scopes
    FROM accounts a JOIN threads_connections c ON c.account_id = a.id WHERE a.id = ${id}`) as Record<string, unknown>[];
  return a!;
}

describe("トークンで追加する（US1）", () => {
  it("長期トークンでAccountができ、オーナーになり、期限は debug_token の値（US1-3）", async () => {
    const token = await fake.issueToken({ user: "9003" });
    const res = await add(`  "${token}"\n`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Ok;
    expect(body).toMatchObject({ kind: "connect", username: "cafe_b", warnings: [] });
    const a = await accountRow(body.accountId);
    expect(a).toMatchObject({ connection_method: "token", connection_status: "connected", username: "cafe_b", display_name: "Cafe B" });
    expect(a.threads_user_id).toBe("9003-myapp");
    expect((new Date(a.expires_at as string).getTime() - Date.now()) / DAY).toBeGreaterThan(59);
    expect(a.recheck_at).toBeNull();
    const [m] = (await q()`SELECT role FROM memberships WHERE account_id = ${body.accountId}`) as { role: string }[];
    expect(m!.role).toBe("owner");
    // 投稿の権限の確認（005）も通る
    const check = await call(app, "POST", `/api/accounts/${body.accountId}/threads-check`, { user: "u1" });
    expect(((await check.json()) as { status: string }).status).toBe("ok");
  });

  it("debug_token で期限を読めないときは、60日とみなして2時間後に確かめ直す。関所に知らせる（FR-012）", async () => {
    const token = await fake.issueToken({ user: "9003", debug: false });
    const body = (await (await add(token)).json()) as Ok;
    const a = await accountRow(body.accountId);
    expect((new Date(a.expires_at as string).getTime() - Date.now()) / DAY).toBeGreaterThan(59);
    const recheckMin = (new Date(a.recheck_at as string).getTime() - Date.now()) / 60_000;
    expect(recheckMin).toBeGreaterThan(115);
    expect(recheckMin).toBeLessThanOrEqual(120);
    expect(await testEnv.AUTOPOST_KV.get("autopost:wake")).not.toBeNull();
  });

  it("関所への知らせは、確定した後の時刻（確認の間に定期処理が動いても無視されない。PR #12 のCodexレビュー）", async () => {
    const token = await fake.issueToken({ user: "9003", debug: false });
    await fake.delay("getProfile", 1500);
    const started = Date.now();
    await add(token);
    const wake = JSON.parse((await testEnv.AUTOPOST_KV.get("autopost:wake"))!) as { at: string };
    expect(Date.parse(wake.at) - started).toBeGreaterThanOrEqual(1500);
  });

  it("投稿・反応数の権限がないトークンでも作り、warnings と反応数の印を返す（US1-4・US1-5、FR-011）", async () => {
    const token = await fake.issueToken({ user: "9003", scopes: ["threads_basic"] });
    const body = (await (await add(token)).json()) as Ok;
    expect(body.warnings).toEqual(["no_publish_permission", "no_insights_permission"]);
    const a = await accountRow(body.accountId);
    expect(a.insights_denied_at).not.toBeNull();
    expect(a.scopes).toEqual(["threads_basic"]);
  });

  it("無効・短期・形の違う文字列では作らない（US1-6、FR-003・FR-012）", async () => {
    const revoked = await fake.issueToken({ user: "9003" });
    await fake.revokeToken(revoked);
    const short = await fake.issueToken({ user: "9003", lifetime: "short" });
    expect(await codeOf(await add(revoked))).toBe("TOKEN_INVALID");
    expect(await codeOf(await add(short))).toBe("TOKEN_SHORT_LIVED");
    expect(await codeOf(await add("https://example.com/not-a-token"))).toBe("TOKEN_INVALID");
    // つながらず、未接続のまま（specs/012）
    expect((await q()`SELECT count(*)::int AS n FROM accounts WHERE connection_status <> 'not_connected'`)[0]).toEqual({ n: 0 });
  });

  it("Threadsの一時的な失敗は THREADS_UNAVAILABLE で、失敗に数えない", async () => {
    const token = await fake.issueToken({ user: "9003" });
    await fake.fail("getProfile", 1, "server");
    const res = await add(token);
    expect([res.status, await codeOf(res)]).toEqual([503, "THREADS_UNAVAILABLE"]);
    expect((await q()`SELECT count(*)::int AS n FROM token_check_failures`)[0]).toEqual({ n: 0 });
  });

  it("登録の上限に達していても、未接続のアカウントにはつなげる（アカウントは増えない。specs/012 FR-016）", async () => {
    await targetFor("u1");
    expect((await createAccountVia(app, "u1")).res.status).toBe(409);
    const res = await add(await fake.issueToken({ user: "9003" }));
    expect(res.status).toBe(200);
  });

  it("同じトークンを同時に2回送っても、つながるのは1回で、後の方は ACCOUNT_ALREADY_CONNECTED（FR-014、specs/012 FR-018）", async () => {
    const token = await fake.issueToken({ user: "9003" });
    await targetFor("u1");
    const results = await Promise.all([add(token), add(token)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await Promise.all(results.filter((r) => r.status === 409).map(codeOf)))).toEqual(["ACCOUNT_ALREADY_CONNECTED"]);
    expect((await q()`SELECT count(*)::int AS n FROM accounts`)[0]).toEqual({ n: 1 });
  });

  it("2,048文字のトークン（形の上限）は、本文の上限に引っかからず確かめに進む。8KBを超える本文は VALIDATION_FAILED（PR #12 のCodexレビュー）", async () => {
    const res = await add("a".repeat(2048));
    expect(await codeOf(res)).toBe("TOKEN_INVALID");
    const reconnect = await call(app, "POST", "/api/threads/token-connect", {
      user: "u1",
      body: { mode: "reconnect", accountId: crypto.randomUUID(), token: `  "${"a".repeat(2048)}"\n` },
    });
    expect(await codeOf(reconnect)).not.toBe("VALIDATION_FAILED");
    const huge = await call(app, "POST", "/api/threads/token-connect", { user: "u1", body: { mode: "connect", accountId: await targetFor("u1"), token: "a".repeat(9000) } });
    expect(await codeOf(huge)).toBe("VALIDATION_FAILED");
  });

  it("長さを名乗らずに流し込まれた大きな本文も、読み込みの途中で止めて VALIDATION_FAILED（PR #12 のCodexレビュー）", async () => {
    const chunk = new TextEncoder().encode("a".repeat(4096));
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 64) return controller.close();
        sent += 1;
        controller.enqueue(chunk);
      },
    });
    const res = await app.request(
      "/api/threads/token-connect",
      // @ts-expect-error duplex は Request の初期化で要る（型に入っていない）
      { method: "POST", headers: { Authorization: "Bearer test:u1", "Content-Type": "application/json" }, body, duplex: "half" },
      testEnv,
    );
    expect(await codeOf(res)).toBe("VALIDATION_FAILED");
    // 64回（256KB）すべてを読み込む前に止まる
    expect(sent).toBeLessThan(64);
  });

  it("最初のプロフィールの取得で通信が失敗したら THREADS_UNAVAILABLE（503）にし、失敗に数えない（PR #12 のCodexレビュー）", async () => {
    const { connectWithToken } = await import("../../src/services/token-connect");
    const { createThreadsClient } = await import("../../src/lib/threads-client");
    const { AppError } = await import("../../src/lib/errors");
    await call(app, "GET", "/api/me", { user: "u1" });
    const id = ((await q()`SELECT id FROM users WHERE clerk_user_id = 'u1'`) as { id: string }[])[0]!.id;
    const broken = createThreadsClient(testEnv, () => Promise.reject(new TypeError("fetch failed: getaddrinfo ENOTFOUND")));
    const err = await connectWithToken(testEnv, broken, { id }, { mode: "connect", accountId: await targetFor("u1"), token: "a".repeat(40) }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ code: "THREADS_UNAVAILABLE", status: 503 });
    expect((await q()`SELECT count(*)::int AS n FROM token_check_failures`)[0]).toEqual({ n: 0 });
  });

  it("本文がなければ VALIDATION_FAILED、未ログインは 401", async () => {
    const bad = await call(app, "POST", "/api/threads/token-connect", { user: "u1", body: { mode: "connect" } });
    expect(await codeOf(bad)).toBe("VALIDATION_FAILED");
    const anon = await call(app, "POST", "/api/threads/token-connect", { body: { mode: "connect", accountId: crypto.randomUUID(), token: "x".repeat(40) } });
    expect(anon.status).toBe(401);
  });
});

describe("確認の失敗の待ち（FR-015、research.md R9）", () => {
  it("10分に5回失敗すると、6回目はThreadsに問い合わせず TOKEN_CHECK_LOCKED。形で弾いたものも数える", async () => {
    for (let i = 0; i < 5; i++) expect(await codeOf(await add("bad token " + i))).toBe("TOKEN_INVALID");
    const good = await fake.issueToken({ user: "9003" });
    const res = await add(good);
    expect(res.status).toBe(429);
    const err = ((await res.json()) as { error: { code: string; details: string[] } }).error;
    expect(err.code).toBe("TOKEN_CHECK_LOCKED");
    expect(Number(err.details[0])).toBeGreaterThan(9 * 60);
    expect(Number(err.details[0])).toBeLessThanOrEqual(10 * 60);
    // 待ちの間の要求は数えない（待ちが延び続けない）
    expect((await q()`SELECT count(*)::int AS n FROM token_check_failures`)[0]).toEqual({ n: 5 });
  });

  it("並べて送っても、確認中の要求も数えるので、5回を超えて確かめない（PR #12 のCodexレビュー）", async () => {
    const shaped = Array.from({ length: 8 }, (_, i) => `badtoken${i}`.padEnd(40, "x"));
    await targetFor("u1");
    const results = await Promise.all(shaped.map((t) => add(t)));
    const codes = await Promise.all(results.map(codeOf));
    expect(codes.filter((c) => c === "TOKEN_INVALID")).toHaveLength(5);
    expect(codes.filter((c) => c === "TOKEN_CHECK_LOCKED")).toHaveLength(3);
    const rows = (await q()`SELECT reason FROM token_check_failures`) as { reason: string }[];
    expect(rows.map((r) => r.reason)).toEqual(Array(5).fill("invalid"));
  });

  it("成功した確認の予約は残らない", async () => {
    await add(await fake.issueToken({ user: "9003" }));
    expect((await q()`SELECT count(*)::int AS n FROM token_check_failures`)[0]).toEqual({ n: 0 });
  });

  it("10分たてば確かめられる。成功しても失敗の数は消えない。他の人の失敗は数えない", async () => {
    for (let i = 0; i < 5; i++) await add("bad token " + i);
    await q()`UPDATE token_check_failures SET failed_at = failed_at - interval '11 minutes'`;
    const res = await add(await fake.issueToken({ user: "9003" }));
    expect(res.status).toBe(200);
    expect((await q()`SELECT count(*)::int AS n FROM token_check_failures`)[0]).toEqual({ n: 5 });
    expect((await add("bad token", "u2")).status).toBe(400);
  });

  it("予約の後片付けに失敗しても、確定した結果・本来のエラーを上書きしない（PR #12 のCodexレビュー）", async () => {
    // 予約の行を消す・書き換えるとエラーになるようにする（この試験の間だけ）
    await q()`CREATE OR REPLACE FUNCTION tcf_fail() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'settle failed'; END $$ LANGUAGE plpgsql`;
    await q()`CREATE TRIGGER tcf_fail BEFORE DELETE OR UPDATE ON token_check_failures FOR EACH ROW EXECUTE FUNCTION tcf_fail()`;
    try {
      const ok = await add(await fake.issueToken({ user: "9003" }));
      expect(ok.status).toBe(200);
      expect((await q()`SELECT count(*)::int AS n FROM accounts`)[0]).toEqual({ n: 1 });
      // 1件目をつないだ u1 には、もう未接続のアカウントがない（上限1件）ので、別の人で確かめる
      expect(await codeOf(await add("bad token", "u2"))).toBe("TOKEN_INVALID");
    } finally {
      await q()`DROP TRIGGER tcf_fail ON token_check_failures`;
      await q()`DROP FUNCTION tcf_fail()`;
    }
  });

  it("日次の処理で、1日より前の失敗を消す", async () => {
    await add("bad token");
    await q()`UPDATE token_check_failures SET failed_at = now() - interval '25 hours'`;
    await add("bad token 2");
    await runDailyJobs(testEnv);
    expect((await q()`SELECT count(*)::int AS n FROM token_check_failures`)[0]).toEqual({ n: 1 });
  });
});
