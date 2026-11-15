// 運営者のアカウント一覧（specs/026-operator-accounts contracts/api.md、US1〜US3、T003・T008・T012）
import { neon } from "@neondatabase/serverless";
import type { OperatorAccounts } from "@meguru/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { makeApp, resetDb, testEnv } from "../helpers/app";
import { TESTER_OPERATOR, callT, codeOf, resetOperatorSettings } from "../helpers/tester-invites";

const app = makeApp();
const q = () => neon(testEnv.DATABASE_URL);
const OP = TESTER_OPERATOR;

beforeEach(async () => {
  await resetDb();
  await resetOperatorSettings();
});

let seq = 0;

/**
 * 利用者を作る（なければ）。
 * @returns users.id
 */
async function userOf(clerk: string, opts: { name?: string | null; email?: string } = {}) {
  const [u] = (await q()`
    INSERT INTO users (clerk_user_id, email, display_name)
    VALUES (${clerk}, ${opts.email ?? `${clerk}@example.com`}, ${opts.name === undefined ? clerk : opts.name})
    ON CONFLICT (clerk_user_id) DO UPDATE SET updated_at = users.updated_at
    RETURNING id`) as [{ id: string }];
  return u.id;
}

/**
 * アカウントを直接作る（上限・契約を通さない）。
 * @returns accounts.id
 */
async function accountOf(
  owner: string,
  opts: { name?: string; username?: string; method?: "app" | "token" | null; status?: "connected" | "needs_reconnect"; createdAt?: Date } = {},
) {
  seq += 1;
  const userId = await userOf(owner);
  const method = opts.method === undefined ? "app" : opts.method;
  const connected = method !== null;
  const createdAt = (opts.createdAt ?? new Date(Date.UTC(2026, 10, 1) + seq * 60_000)).toISOString();
  const [a] = (await q()`
    INSERT INTO threads.accounts (name, threads_user_id, username, connection_method, connection_status, created_at, updated_at)
    VALUES (
      ${opts.name ?? `店${seq}`},
      ${connected ? `tu_${seq}` : null},
      ${connected ? (opts.username ?? `shop_${seq}`) : null},
      ${method},
      ${connected ? (opts.status ?? "connected") : "not_connected"},
      ${createdAt},
      ${createdAt}
    )
    RETURNING id`) as [{ id: string }];
  await q()`INSERT INTO threads.memberships (user_id, account_id, role) VALUES (${userId}, ${a.id}, 'owner')`;
  return a.id;
}

/**
 * テスター招待の申し込みの行を直接作る。
 * @param values - 状態・枠・外してよい理由
 */
async function applicationOf(accountId: string, values: { status: string; holdsSlot?: boolean; removalReason?: string | null }) {
  await q()`
    INSERT INTO threads.tester_applications (account_id, threads_username, status, holds_slot, removal_reason)
    VALUES (${accountId}, ${`app_${++seq}`}, ${values.status}, ${values.holdsSlot ?? false}, ${values.removalReason ?? null})`;
}

const get = (query = "", user = OP) => callT(app, "GET", `/api/threads/operator/accounts${query}`, { user });
const list = async (query = "") => {
  const res = await get(query);
  expect(res.status).toBe(200);
  return (await res.json()) as OperatorAccounts;
};

describe("GET /api/threads/operator/accounts：行（US1）", () => {
  it("接続方法・接続の状態・@ユーザー名・オーナー・テスター招待の状態を返す", async () => {
    const app1 = await accountOf("u1", { name: "AI部", username: "taku.it.ai" });
    await applicationOf(app1, { status: "connected", holdsSlot: true });
    const token = await accountOf("u2", { name: "カフェ", username: "cafe_b", method: "token", status: "needs_reconnect" });
    const none = await accountOf("u3", { name: "新しいお店", method: null });
    await applicationOf(none, { status: "pending" });
    const { items } = await list();
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(byId[app1]).toMatchObject({
      name: "AI部",
      username: "taku.it.ai",
      method: "app",
      status: "connected",
      owner: { name: "u1", email: "u1@example.com", accountCount: 1 },
      tester: "connected",
    });
    expect(byId[token]).toMatchObject({ username: "cafe_b", method: "token", status: "needs_reconnect", tester: null });
    expect(byId[none]).toMatchObject({ username: null, method: "none", status: "not_connected", tester: "pending" });
  });

  it("行の項目は契約の8つだけ（中身を返さない。FR-006）", async () => {
    await accountOf("u1");
    const { items } = await list();
    expect(Object.keys(items[0]!).sort()).toEqual(["createdAt", "id", "method", "name", "owner", "status", "tester", "username"]);
  });

  it("枠を使ったまま残った行だけなら外してよい、見送り・取り下げだけなら null", async () => {
    const removable = await accountOf("u1");
    await applicationOf(removable, { status: "withdrawn", holdsSlot: true, removalReason: "token_connected" });
    const closed = await accountOf("u1");
    await applicationOf(closed, { status: "declined" });
    await applicationOf(closed, { status: "withdrawn" });
    const byId = Object.fromEntries((await list()).items.map((i) => [i.id, i]));
    expect(byId[removable]!.tester).toBe("removable");
    expect(byId[closed]!.tester).toBeNull();
  });

  it("オーナーが持つアカウントの数（つなぐ前を含む。絞り込み・検索で変わらない）", async () => {
    await accountOf("u1", { username: "first_shop" });
    await accountOf("u1", { method: null });
    await accountOf("u2");
    const all = await list();
    const counts = all.items.map((i) => [i.owner!.email, i.owner!.accountCount]);
    expect(counts.filter(([e]) => e === "u1@example.com").map(([, n]) => n)).toEqual([2, 2]);
    expect(counts.filter(([e]) => e === "u2@example.com").map(([, n]) => n)).toEqual([1]);
    const searched = await list("?method=app&q=first");
    expect(searched.items).toHaveLength(1);
    expect(searched.items[0]!.owner!.accountCount).toBe(2);
  });

  it("オーナーの名前がなければ null", async () => {
    await userOf("u9", { name: null });
    await accountOf("u9");
    expect((await list()).items[0]!.owner).toMatchObject({ name: null, email: "u9@example.com" });
  });

  it("作った日の新しい順に50件ずつ。nextCursor で続きを読み、印のアカウントが消えても位置は変わらない（PR #74 のCodexレビュー）", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 52; i++) ids.push(await accountOf("u1", { createdAt: new Date(Date.UTC(2026, 9, 1, 0, i)) }));
    const first = await list();
    expect(first.items).toHaveLength(50);
    expect(first.items[0]!.id).toBe(ids[51]);
    expect(first.nextCursor).toMatch(new RegExp(`_${ids[2]}$`));
    // 境目のアカウントが消えても、続きは残りの2件だけ（先頭から返し直さない）
    await q()`DELETE FROM threads.accounts WHERE id = ${ids[2]!}`;
    const second = await list(`?cursor=${encodeURIComponent(first.nextCursor!)}`);
    expect(second.items.map((i) => i.id)).toEqual([ids[1], ids[0]]);
    expect(second.nextCursor).toBeNull();
  });

  it("作った日時がマイクロ秒だけ違っても、続きで行を落とさない", async () => {
    await q()`
      INSERT INTO threads.accounts (name, connection_status, connection_method, created_at, updated_at)
      VALUES ('a', 'not_connected', NULL, '2026-10-01 00:00:00.000001+00', now()), ('b', 'not_connected', NULL, '2026-10-01 00:00:00.000002+00', now())`;
    // 印の日時と同じ b は ID で比べ、1マイクロ秒前の a も落とさない
    const cursor = "2026-10-01T00:00:00.000002Z_ffffffff-ffff-4fff-bfff-ffffffffffff";
    const res = await list(`?cursor=${encodeURIComponent(cursor)}`);
    expect(res.items.map((i) => i.name)).toEqual(["b", "a"]);
  });

  it("cursor の形が違えば 400", async () => {
    expect((await get("?cursor=3f2b8c1e-8a3b-4c1d-9e2f-1a2b3c4d5e6f")).status).toBe(400);
  });

  it("運営者でなければ 403 OPERATOR_ONLY。応答は no-store", async () => {
    const res = await get("", "u1");
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe("OPERATOR_ONLY");
    expect((await get()).headers.get("Cache-Control")).toBe("no-store");
  });

  it("書き込むメソッドはない（404）", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect((await callT(app, method, "/api/threads/operator/accounts", { user: OP, body: {} })).status).toBe(404);
    }
  });
});

describe("GET /api/threads/operator/accounts：絞り込みと件数（US2）", () => {
  it("件数は接続方法で数え、要再接続はその方法の側。method で絞っても件数は変わらない", async () => {
    await accountOf("u1");
    await accountOf("u1");
    await accountOf("u2", { status: "needs_reconnect" });
    await accountOf("u2", { method: "token" });
    await accountOf("u3", { method: "token", status: "needs_reconnect" });
    await accountOf("u3", { method: null });
    const all = await list();
    expect(all.counts).toEqual({ all: 6, app: 3, token: 2, none: 1 });
    const token = await list("?method=token");
    expect(token.items.map((i) => i.method)).toEqual(["token", "token"]);
    expect(token.counts).toEqual(all.counts);
    expect((await list("?method=none")).items).toHaveLength(1);
  });

  it("method が合わなければ 400", async () => {
    const res = await get("?method=other");
    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe("VALIDATION_FAILED");
  });
});

describe("GET /api/threads/operator/accounts：検索（US3）", () => {
  it("アカウントの名前・@ユーザー名・オーナーの名前・メールアドレスの一部（大文字・小文字を問わない）", async () => {
    await userOf("owner_a", { name: "山田 太郎", email: "Taro.Yamada@example.com" });
    const a = await accountOf("owner_a", { name: "AI部", username: "taku.it.ai" });
    const b = await accountOf("u2", { name: "Cafe 本店", username: "cafe_b" });
    const ids = async (query: string) => (await list(`?q=${encodeURIComponent(query)}`)).items.map((i) => i.id);
    expect(await ids("TAKU")).toEqual([a]);
    expect(await ids("cafe")).toEqual([b]);
    expect(await ids("太郎")).toEqual([a]);
    expect(await ids("yamada@")).toEqual([a]);
    expect(await ids("ai部")).toEqual([a]);
    expect(await ids("nothing")).toEqual([]);
  });

  it("% と _ はその文字として探す", async () => {
    const underscore = await accountOf("u1", { username: "a_b" });
    await accountOf("u1", { username: "axb" });
    expect((await list("?q=a_b")).items.map((i) => i.id)).toEqual([underscore]);
    expect((await list("?q=%25")).items).toHaveLength(0);
  });

  it("method と合わせて使え、件数は検索で変わらない", async () => {
    await accountOf("u1", { username: "shop_app" });
    const token = await accountOf("u1", { username: "shop_token", method: "token" });
    await accountOf("u2", { username: "other", method: "token" });
    const res = await list("?method=token&q=shop");
    expect(res.items.map((i) => i.id)).toEqual([token]);
    expect(res.counts).toEqual({ all: 3, app: 1, token: 2, none: 0 });
  });

  it("101文字は 400、空白だけは検索なし", async () => {
    await accountOf("u1");
    expect((await get(`?q=${"a".repeat(101)}`)).status).toBe(400);
    expect((await list("?q=%20%20")).items).toHaveLength(1);
  });
});
