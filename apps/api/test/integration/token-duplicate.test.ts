// US2：同じアカウントの二重登録を防ぐ（specs/010-token-account-add SC-003、FR-020〜FR-023、research.md R6）。
// specs/012 で、名前で作った未接続のアカウントにつなぐ形になった。自分の別のアカウントと重なっても、接続を更新せず止める
// （specs/012 FR-020〜FR-022、SC-004）。二重のときに残る未接続のアカウントは数えない。
import { neon } from "@neondatabase/serverless";
import { beforeEach, describe, expect, it } from "vitest";
import { call, connectNew, createUnconnectedAccount, fake, makeApp, redirectTarget, resetDb, testEnv } from "../helpers/app";

const app = makeApp();
const q = () => neon(testEnv.DATABASE_URL);

beforeEach(async () => {
  await resetDb();
  await fake.reset();
  await fake.addUser("9003", "cafe_b");
});

/** 新しい未接続のアカウントを（上限に関係なく）作り、トークンではじめてつなぐ */
const add = async (token: string, user = "u1", name = "トークンのアカウント") => {
  const { accountId } = await createUnconnectedAccount(user, { name });
  return call(app, "POST", "/api/threads/token-connect", { user, body: { mode: "connect", accountId, token } });
};
const errorOf = async (res: Response) => ((await res.json()) as { error: { code: string; details?: string[] } }).error;
/** Threadsにつながっているアカウントの数（二重のときに残る未接続のアカウントは数えない） */
const accountCount = async () =>
  ((await q()`SELECT count(*)::int AS n FROM accounts WHERE connection_status <> 'not_connected'`) as { n: number }[])[0]!.n;

describe("二重登録の3通り（SC-003）", () => {
  it("(a) このアプリで接続 → 同じアカウントの別のアプリのトークン：ACCOUNT_ALREADY_REGISTERED と、そのAccount", async () => {
    await connectNew(app, "u1", "9003");
    const id = ((await q()`SELECT id FROM accounts WHERE connection_status = 'connected'`) as { id: string }[])[0]!.id;
    const res = await add(await fake.issueToken({ user: "9003" }));
    expect(res.status).toBe(409);
    // 重なったアカウントのID・名前・ユーザー名を返す（specs/012 contracts/api.md）
    expect(await errorOf(res)).toMatchObject({ code: "ACCOUNT_ALREADY_REGISTERED", details: [id, "アカウント 9003", "cafe_b"] });
    expect(await accountCount()).toBe(1);
  });

  it("(b) トークン → このアプリで接続：自分の別のアカウントなので、つながず ACCOUNT_ALREADY_REGISTERED（specs/012 FR-022）", async () => {
    const created = (await (await add(await fake.issueToken({ user: "9003" }), "u1", "トークンで")).json()) as { accountId: string };
    const { accountId, callbackRes } = await connectNew(app, "u1", "9003");
    const target = redirectTarget(callbackRes!);
    expect([target.pathname, target.searchParams.get("error")]).toEqual([`/accounts/${accountId}/settings`, "ACCOUNT_ALREADY_REGISTERED"]);
    expect(target.searchParams.get("connected")).toBeNull();
    expect(await accountCount()).toBe(1);
    // つないであったアカウントは、トークンのまま変わらない
    const [a] = (await q()`SELECT connection_method FROM accounts WHERE id = ${created.accountId}`) as Record<string, string>[];
    expect(a).toEqual({ connection_method: "token" });
  });

  it("(c) トークン → 別のMetaアプリのトークン：ACCOUNT_ALREADY_REGISTERED", async () => {
    await add(await fake.issueToken({ user: "9003", appScope: "app1" }));
    const res = await add(await fake.issueToken({ user: "9003", appScope: "app2" }));
    expect((await errorOf(res)).code).toBe("ACCOUNT_ALREADY_REGISTERED");
    expect(await accountCount()).toBe(1);
  });

  it("(d) 他の利用者のAccountと同じなら THREADS_ACCOUNT_TAKEN（登録した人は明かさない）", async () => {
    await connectNew(app, "u2", "9003");
    const res = await add(await fake.issueToken({ user: "9003" }));
    const err = await errorOf(res);
    expect(err.code).toBe("THREADS_ACCOUNT_TAKEN");
    expect(err.details).toBeUndefined();
  });

  it("(e) ユーザー名の大文字・小文字の違いでも一致する", async () => {
    await connectNew(app, "u1", "9003");
    await q()`UPDATE accounts SET username = 'CAFE_B'`;
    const res = await add(await fake.issueToken({ user: "9003" }));
    expect((await errorOf(res)).code).toBe("ACCOUNT_ALREADY_REGISTERED");
  });

  it("(f) 別のアプリのトークンが同時に来ても、Accountは1つ", async () => {
    const [t1, t2] = await Promise.all([
      fake.issueToken({ user: "9003", appScope: "app1" }),
      fake.issueToken({ user: "9003", appScope: "app2" }),
    ]);
    const results = await Promise.all([add(t1), add(t2)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await accountCount()).toBe(1);
  });
});

describe("ユーザー名だけが一致したとき（FR-023）", () => {
  it("相手のAccountの今の名前が違えば、その名前を新しくして追加を続ける", async () => {
    // u2 の Account（別の人 9005）が、以前 cafe_b という名前だった
    await fake.addUser("9005", "cafe_b");
    await add(await fake.issueToken({ user: "9005" }), "u2");
    await fake.addUser("9005", "renamed_shop");
    const res = await add(await fake.issueToken({ user: "9003" }));
    expect(res.status).toBe(200);
    const rows = (await q()`SELECT username FROM accounts ORDER BY username`) as { username: string }[];
    expect(rows.map((r) => r.username)).toEqual(["cafe_b", "renamed_shop"]);
  });

  it("名前を新しくした後に、新しい名前を別のアプリで追加しようとしても、照合で見つかる（PR #12 のCodexレビュー）", async () => {
    await fake.addUser("9005", "cafe_b");
    await add(await fake.issueToken({ user: "9005" }), "u2");
    await fake.addUser("9005", "renamed_shop");
    expect((await add(await fake.issueToken({ user: "9003" }))).status).toBe(200);
    const res = await add(await fake.issueToken({ user: "9005", appScope: "other" }), "u2");
    expect((await errorOf(res)).code).toBe("ACCOUNT_ALREADY_REGISTERED");
    expect(await accountCount()).toBe(2);
  });

  it("新しい名前が先に別のAccountで登録されていても、名前の更新は止めず、追加も続ける", async () => {
    await fake.addUser("9005", "cafe_b");
    await add(await fake.issueToken({ user: "9005" }), "u2");
    await fake.addUser("9006", "renamed_shop");
    await add(await fake.issueToken({ user: "9006" }), "u3");
    await fake.addUser("9005", "renamed_shop");
    expect((await add(await fake.issueToken({ user: "9003" }))).status).toBe(200);
    expect(await accountCount()).toBe(3);
  });

  it("相手が要再接続で取り直せないときは、一致したものとして扱う", async () => {
    await fake.addUser("9005", "cafe_b");
    await add(await fake.issueToken({ user: "9005" }), "u2");
    await q()`UPDATE accounts SET connection_status = 'needs_reconnect'`;
    await fake.addUser("9005", "renamed_shop");
    const res = await add(await fake.issueToken({ user: "9003" }));
    expect((await errorOf(res)).code).toBe("THREADS_ACCOUNT_TAKEN");
  });

  it("このアプリでの接続（callback）でも、ユーザー名だけの一致を確かめ直す", async () => {
    await fake.addUser("9005", "cafe_b");
    await add(await fake.issueToken({ user: "9005" }), "u2");
    await fake.addUser("9005", "renamed_shop");
    const { callbackRes } = await connectNew(app, "u1", "9003");
    expect(redirectTarget(callbackRes!).searchParams.get("connected")).toBe("connect");
    expect(await accountCount()).toBe(2);
  });
});

describe("日次のトークン更新でユーザー名が変わるとき（PR #12 のCodexレビュー）", () => {
  it("更新の後に、新しい名前を別のアプリで追加しようとしても、照合で見つかる", async () => {
    const { refreshExpiringTokens } = await import("../../src/services/token-refresh");
    const { createThreadsClient } = await import("../../src/lib/threads-client");
    await add(await fake.issueToken({ user: "9003" }));
    await fake.addUser("9003", "cafe_new");
    await q()`UPDATE threads_connections SET expires_at = now() + interval '3 days', issued_at = now() - interval '2 days'`;
    expect((await refreshExpiringTokens(testEnv, createThreadsClient(testEnv), new Date())).refreshed).toBe(1);
    expect(((await q()`SELECT username FROM accounts`) as { username: string }[])[0]!.username).toBe("cafe_new");
    const res = await add(await fake.issueToken({ user: "9003", appScope: "other" }));
    expect((await errorOf(res)).code).toBe("ACCOUNT_ALREADY_REGISTERED");
  });

  it("新しい名前が先に別のAccountで登録されていても、更新は止めない（警告だけ）", async () => {
    const { refreshExpiringTokens } = await import("../../src/services/token-refresh");
    const { createThreadsClient } = await import("../../src/lib/threads-client");
    await add(await fake.issueToken({ user: "9003" }));
    await fake.addUser("9007", "cafe_new");
    await add(await fake.issueToken({ user: "9007" }), "u2");
    await fake.addUser("9003", "cafe_new");
    await q()`UPDATE threads_connections SET expires_at = now() + interval '3 days', issued_at = now() - interval '2 days'`;
    expect((await refreshExpiringTokens(testEnv, createThreadsClient(testEnv), new Date())).refreshed).toBe(2);
  });
});
