// US3：参考投稿とキーワード（specs/002-strategy-profile FR-012〜FR-014・FR-020〜FR-025、research.md R3〜R5）
import { neon } from "@neondatabase/serverless";
import { beforeEach, describe, expect, it } from "vitest";
import { AFTER_TRIAL, call, createUserWithAccount, makeApp, resetDb, setAccount, testEnv } from "../helpers/app";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
});

const base = (accountId: string) => `/api/accounts/${accountId}`;
type Item = { id: string; version: number; keyword: string; body?: string; whyGood?: string };
type ErrorBody = { error: { code: string; details?: string[] } };

async function post(accountId: string, kind: "reference-posts" | "research-keywords", body: unknown, user = "u1") {
  return call(app, "POST", `${base(accountId)}/${kind}`, { user, body });
}

async function list(accountId: string, kind: "reference-posts" | "research-keywords", user = "u1") {
  const res = await call(app, "GET", `${base(accountId)}/${kind}`, { user });
  expect(res.status).toBe(200);
  return (await res.json()) as { items: Item[]; limit: number; canEdit: boolean };
}

describe("参考投稿", () => {
  it("本文だけでも保存でき、新しい順に並ぶ。任意の項目は \"\" で返る（FR-012・FR-013）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    expect((await post(accountId, "reference-posts", { body: "1件目" })).status).toBe(201);
    const second = await post(accountId, "reference-posts", {
      body: "2件目",
      keyword: "AI",
      postUrl: "https://www.threads.net/@a/post/1",
      whyGood: "冒頭の一文で共感を取っている",
    });
    expect(second.status).toBe(201);
    const l = await list(accountId, "reference-posts");
    expect(l.limit).toBe(200);
    expect(l.items.map((i) => i.body)).toEqual(["2件目", "1件目"]);
    expect(l.items[1]).toMatchObject({ keyword: "", whyGood: "" });
  });

  it("本文が空白だけ・URL の形の誤りは 400 で details に項目名（javascript: は拒否）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const res = await post(accountId, "reference-posts", { body: "  ", postUrl: "javascript:alert(1)" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error.details).toEqual(expect.arrayContaining(["body", "postUrl"]));
  });

  it("後から「なぜ良いか」を追記でき、同じ expectedVersion の2回目は 409", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const created = (await (await post(accountId, "reference-posts", { body: "本文" })).json()) as Item;
    const path = `${base(accountId)}/reference-posts/${created.id}`;
    const ok = await call(app, "PUT", path, { user: "u1", body: { body: "本文", whyGood: "理由", expectedVersion: 1 } });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as Item).whyGood).toBe("理由");
    const stale = await call(app, "PUT", path, { user: "u1", body: { body: "本文", expectedVersion: 1 } });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as ErrorBody & { latest: Item }).latest.version).toBe(2);
  });

  it("削除した参考投稿の更新は 404 ITEM_NOT_FOUND、2回目の DELETE も 204", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const created = (await (await post(accountId, "reference-posts", { body: "本文" })).json()) as Item;
    const path = `${base(accountId)}/reference-posts/${created.id}`;
    expect((await call(app, "DELETE", path, { user: "u1" })).status).toBe(204);
    const put = await call(app, "PUT", path, { user: "u1", body: { body: "x", expectedVersion: 1 } });
    expect(put.status).toBe(404);
    expect((await call(app, "DELETE", path, { user: "u1" })).status).toBe(204);
  });

  it("件数の上限は200件（FR-022）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const sql = neon(testEnv.DATABASE_URL);
    await sql`INSERT INTO reference_posts (account_id, body) SELECT ${accountId}, 'b' || g FROM generate_series(1, 200) AS g`;
    const res = await post(accountId, "reference-posts", { body: "201件目" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorBody).error.code).toBe("ITEM_LIMIT_REACHED");
  });
});

describe("キーワード", () => {
  it("キーワードの重複：「AI」がある状態で「ＡＩ」「 ai 」は 409 KEYWORD_DUPLICATE（research.md R5）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    expect((await post(accountId, "research-keywords", { keyword: "AI", purpose: "初心者向け" })).status).toBe(201);
    for (const keyword of ["ＡＩ", " ai "]) {
      const res = await post(accountId, "research-keywords", { keyword });
      expect(res.status).toBe(409);
      expect(((await res.json()) as ErrorBody).error.code).toBe("KEYWORD_DUPLICATE");
    }
    expect((await list(accountId, "research-keywords")).items).toHaveLength(1);
  });

  it("編集で既存のキーワードと同じにすると 409 KEYWORD_DUPLICATE", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await post(accountId, "research-keywords", { keyword: "AI" });
    const other = (await (await post(accountId, "research-keywords", { keyword: "副業" })).json()) as Item;
    const res = await call(app, "PUT", `${base(accountId)}/research-keywords/${other.id}`, {
      user: "u1",
      body: { keyword: "ai", purpose: "", expectedVersion: 1 },
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorBody).error.code).toBe("KEYWORD_DUPLICATE");
  });

  it("キーワードの削除：キーワードを削除しても、そのキーワードを記録した参考投稿は残る（US3 シナリオ6）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const kw = (await (await post(accountId, "research-keywords", { keyword: "AI" })).json()) as Item;
    await post(accountId, "reference-posts", { body: "本文", keyword: "AI" });
    expect((await call(app, "DELETE", `${base(accountId)}/research-keywords/${kw.id}`, { user: "u1" })).status).toBe(204);
    expect((await list(accountId, "research-keywords")).items).toHaveLength(0);
    expect((await list(accountId, "reference-posts")).items[0]).toMatchObject({ keyword: "AI" });
  });

  it("件数の上限は100件（FR-022）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const sql = neon(testEnv.DATABASE_URL);
    await sql`INSERT INTO research_keywords (account_id, keyword, keyword_normalized)
      SELECT ${accountId}, 'k' || g, 'k' || g FROM generate_series(1, 100) AS g`;
    const res = await post(accountId, "research-keywords", { keyword: "101件目" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorBody).error.code).toBe("ITEM_LIMIT_REACHED");
  });
});

describe("リサーチ共通", () => {
  it("他人のAccount：一覧・追加は 404 ACCOUNT_NOT_FOUND（FR-023、SC-006）", async () => {
    const { accountId } = await createUserWithAccount("owner");
    await createUserWithAccount("other");
    for (const kind of ["reference-posts", "research-keywords"] as const) {
      expect((await call(app, "GET", `${base(accountId)}/${kind}`, { user: "other" })).status).toBe(404);
      expect((await post(accountId, kind, { body: "x", keyword: "x" }, "other")).status).toBe(404);
    }
  });

  it("要再接続のAccountでも、参考投稿とキーワードを読み書きできる（FR-025）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await setAccount(accountId, { connectionStatus: "needs_reconnect" });
    expect((await post(accountId, "reference-posts", { body: "本文" })).status).toBe(201);
    expect((await post(accountId, "research-keywords", { keyword: "AI" })).status).toBe(201);
  });

  it("grower機能の判定：無料体験の後のプラン1は書き込みが 403、読み取りは canEdit: false（FR-024、SC-008）", async () => {
    const { accountId } = await createUserWithAccount("u1", { plan: "auto-grower", userCreatedAt: AFTER_TRIAL() });
    const rp = (await (await post(accountId, "reference-posts", { body: "本文" })).json()) as Item;
    const kw = (await (await post(accountId, "research-keywords", { keyword: "AI" })).json()) as Item;
    await setAccount(accountId, { plan: "auto-only" });
    const writes = await Promise.all([
      post(accountId, "reference-posts", { body: "x" }),
      post(accountId, "research-keywords", { keyword: "y" }),
      call(app, "PUT", `${base(accountId)}/reference-posts/${rp.id}`, { user: "u1", body: { body: "x", expectedVersion: 1 } }),
      call(app, "DELETE", `${base(accountId)}/research-keywords/${kw.id}`, { user: "u1" }),
    ]);
    for (const res of writes) expect(res.status).toBe(403);
    for (const kind of ["reference-posts", "research-keywords"] as const) {
      const l = await list(accountId, kind);
      expect(l.canEdit).toBe(false);
      expect(l.items).toHaveLength(1);
    }
  });
});
