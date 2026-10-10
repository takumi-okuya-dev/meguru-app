// US2：同じアカウントの二重登録を防ぐ（specs/010-token-account-add SC-003、FR-020〜FR-023、research.md R6）
import { neon } from "@neondatabase/serverless";
import { beforeEach, describe, expect, it } from "vitest";
import { call, connectNew, fake, makeApp, redirectTarget, resetDb, testEnv } from "../helpers/app";

const app = makeApp();
const q = () => neon(testEnv.DATABASE_URL);

beforeEach(async () => {
  await resetDb();
  await fake.reset();
  await fake.addUser("9003", "cafe_b");
});

const add = (token: string, user = "u1") =>
  call(app, "POST", "/api/threads/token-connect", { user, body: { mode: "new", token } });
const errorOf = async (res: Response) => ((await res.json()) as { error: { code: string; details?: string[] } }).error;
const accountCount = async () => ((await q()`SELECT count(*)::int AS n FROM accounts`) as { n: number }[])[0]!.n;

describe("二重登録の3通り（SC-003）", () => {
  it("(a) このアプリで接続 → 同じアカウントの別のアプリのトークン：ACCOUNT_ALREADY_REGISTERED と、そのAccount", async () => {
    await connectNew(app, "u1", "9003");
    const id = ((await q()`SELECT id FROM accounts`) as { id: string }[])[0]!.id;
    const res = await add(await fake.issueToken({ user: "9003" }));
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toMatchObject({ code: "ACCOUNT_ALREADY_REGISTERED", details: [id] });
    expect(await accountCount()).toBe(1);
  });

  it("(b) トークン → このアプリで接続：新しいAccountを作らず更新し、接続の方法が app になる（US2-3）", async () => {
    const created = (await (await add(await fake.issueToken({ user: "9003" }))).json()) as { accountId: string };
    // このアプリでの追加は、認可に進む前に上限を判定するので（001 FR-017）、上限を上げておく
    await q()`UPDATE accounts SET plan = 'multi-account'`;
    const { callbackRes } = await connectNew(app, "u1", "9003");
    const target = redirectTarget(callbackRes!);
    expect([target.pathname, target.searchParams.get("connected")]).toEqual([`/accounts/${created.accountId}`, "updated"]);
    expect(await accountCount()).toBe(1);
    const [a] = (await q()`SELECT connection_method, threads_user_id FROM accounts`) as Record<string, string>[];
    expect(a).toEqual({ connection_method: "app", threads_user_id: "9003" });
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
    expect(redirectTarget(callbackRes!).searchParams.get("connected")).toBe("new");
    expect(await accountCount()).toBe(2);
  });
});
