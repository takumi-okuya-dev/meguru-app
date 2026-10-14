// US3：接続し直すときに方法を選ぶ（specs/010-token-account-add FR-031〜FR-035、SC-005、research.md R7・R11a）
import { neon } from "@neondatabase/serverless";
import { beforeEach, describe, expect, it } from "vitest";
import { approvedDrafts } from "../helpers/auto-post";
import { authorizeAndCallback, call, connectNew, fake, makeApp, redirectTarget, resetDb, testEnv } from "../helpers/app";
import { activityRows, putInTeam } from "../helpers/team";

const app = makeApp();
const q = () => neon(testEnv.DATABASE_URL);

beforeEach(async () => {
  await resetDb();
  await fake.reset();
  await fake.addUser("9003", "cafe_b");
  await fake.addUser("9004", "shop_c");
});

const reconnectWithToken = (accountId: string, token: string, user = "u1") =>
  call(app, "POST", "/api/threads/token-connect", { user, body: { mode: "reconnect", accountId, token } });
const errorOf = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;
const account = async () =>
  ((await q()`SELECT a.*, c.recheck_at FROM accounts a JOIN threads_connections c ON c.account_id = a.id`) as Record<string, unknown>[])[0]!;

async function tokenAccount(user = "u1") {
  const res = await call(app, "POST", "/api/threads/token-connect", {
    user,
    body: { mode: "new", token: await fake.issueToken({ user: "9003" }) },
  });
  return ((await res.json()) as { accountId: string }).accountId;
}

/** 件数の見本（SC-005）：投稿ストック・戦略・設定・NGワード・記録 */
async function counts(accountId: string) {
  const [r] = (await q()`SELECT
    (SELECT count(*)::int FROM post_drafts WHERE account_id = ${accountId}) AS drafts,
    (SELECT count(*)::int FROM ng_words WHERE account_id = ${accountId}) AS ng,
    (SELECT count(*)::int FROM posting_schedules WHERE account_id = ${accountId}) AS schedules,
    (SELECT count(*)::int FROM activity_logs WHERE account_id = ${accountId} AND action <> 'threads_reconnected') AS logs,
    (SELECT core_rules FROM accounts WHERE id = ${accountId}) AS rules`) as Record<string, unknown>[];
  return r;
}

async function seed(accountId: string) {
  await approvedDrafts(accountId, ["A", "B"]);
  await q()`INSERT INTO ng_words (account_id, word, normalized) VALUES (${accountId}, '禁止', '禁止')`;
  await q()`INSERT INTO posting_schedules (account_id, enabled, slot_minutes, jitter, effective_from) VALUES (${accountId}, true, ${[720]}, false, now())`;
  await q()`UPDATE accounts SET core_rules = 'ルール' WHERE id = ${accountId}`;
}

describe("トークンで接続し直す（US3）", () => {
  it("要再接続から接続中に戻り、世代番号が増え、補いが消える。上限でも使える", async () => {
    const id = await tokenAccount();
    await q()`UPDATE accounts SET connection_status = 'needs_reconnect', reconnect_hint = 'short_lived_token'`;
    const before = await account();
    const res = await reconnectWithToken(id, await fake.issueToken({ user: "9003" }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { kind: string }).kind).toBe("reconnect");
    const after = await account();
    expect(after).toMatchObject({ connection_status: "connected", reconnect_hint: null });
    expect(Number(after.connection_generation)).toBe(Number(before.connection_generation) + 1);
  });

  it("app → token → app と切り替えても、データの件数は同じで、ユーザーIDと方法が変わる（SC-005、FR-033）", async () => {
    await connectNew(app, "u1", "9003");
    const id = ((await q()`SELECT id FROM accounts`) as { id: string }[])[0]!.id;
    await seed(id);
    const start = await counts(id);

    expect((await reconnectWithToken(id, await fake.issueToken({ user: "9003", appScope: "mine" }))).status).toBe(200);
    expect(await account()).toMatchObject({ connection_method: "token", threads_user_id: "9003-mine" });
    expect(await counts(id)).toEqual(start);

    // このアプリでの接続し直しも、ユーザー名で同じアカウントと分かる（IDは違う。FR-032）
    const { authorizeUrl } = (await (
      await call(app, "POST", "/api/threads/connect", { user: "u1", body: { mode: "reconnect", accountId: id } })
    ).json()) as { authorizeUrl: string };
    const cb = await authorizeAndCallback(app, authorizeUrl, { fakeUser: "9003" });
    expect(redirectTarget(cb).searchParams.get("connected")).toBe("reconnect");
    expect(await account()).toMatchObject({ connection_method: "app", threads_user_id: "9003" });
    expect(await counts(id)).toEqual(start);
  });

  it("別のThreadsアカウントのトークンは RECONNECT_ACCOUNT_MISMATCH で、失敗に数える（US3-4）", async () => {
    const id = await tokenAccount();
    const res = await reconnectWithToken(id, await fake.issueToken({ user: "9004" }));
    expect([res.status, await errorOf(res)]).toEqual([409, "RECONNECT_ACCOUNT_MISMATCH"]);
    expect(await account()).toMatchObject({ username: "cafe_b", threads_user_id: "9003-myapp" });
    expect(((await q()`SELECT reason FROM token_check_failures`) as { reason: string }[]).map((r) => r.reason)).toEqual([
      "account_mismatch",
    ]);
  });

  it("期限を読めなければ、接続し直しでも2時間後に確かめ直す。読めれば入らない（FR-012）", async () => {
    const id = await tokenAccount();
    await reconnectWithToken(id, await fake.issueToken({ user: "9003", debug: false }));
    expect((await account()).recheck_at).not.toBeNull();
    await reconnectWithToken(id, await fake.issueToken({ user: "9003" }));
    expect((await account()).recheck_at).toBeNull();
  });

  it("担当の人・見せてもらっている人は ROLE_FORBIDDEN（FR-034）", async () => {
    const id = await tokenAccount("owner1");
    await putInTeam(id, "owner1", { editor: "e1", shared: true });
    const token = await fake.issueToken({ user: "9003" });
    for (const user of ["a1", "e1"]) {
      const res = await reconnectWithToken(id, token, user);
      expect([res.status, await errorOf(res)], user).toEqual([403, "ROLE_FORBIDDEN"]);
    }
  });
});

describe("接続し直しの記録（FR-035、research.md R11a）", () => {
  it("チームがあれば、どちらの方法の接続し直しも threads_reconnected を1行ずつ書く。トークンは書かない", async () => {
    const id = await tokenAccount("owner1");
    await putInTeam(id, "owner1");
    const token = await fake.issueToken({ user: "9003" });
    await reconnectWithToken(id, token, "owner1");
    await q()`UPDATE accounts SET plan = 'multi-account'`;
    const { authorizeUrl } = (await (
      await call(app, "POST", "/api/threads/connect", { user: "owner1", body: { mode: "reconnect", accountId: id } })
    ).json()) as { authorizeUrl: string };
    await authorizeAndCallback(app, authorizeUrl, { fakeUser: "9003" });
    const rows = (await activityRows(id)).filter((r) => r.action === "threads_reconnected");
    expect(rows.map((r) => [r.kind, (r.details as { method: string }).method])).toEqual([
      ["settings", "app"],
      ["settings", "token"],
    ]);
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it("チームがなければ書かない", async () => {
    const id = await tokenAccount();
    await reconnectWithToken(id, await fake.issueToken({ user: "9003" }));
    expect(await activityRows(id)).toEqual([]);
  });
});
