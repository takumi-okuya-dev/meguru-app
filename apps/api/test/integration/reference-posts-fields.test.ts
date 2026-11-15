// 参考投稿の新しい項目（specs/014-strategy-guidance FR-095〜FR-098、SC-013、contracts/api.md）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { call, createUserWithAccount, makeApp, resetDb } from "../helpers/app";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
});
afterEach(() => vi.useRealTimers());

const path = (accountId: string) => `/api/threads/accounts/${accountId}/reference-posts`;
type Post = Record<string, unknown> & { id: string; version: number; freshness: string; shortId: string };
type ErrorBody = { error: { code: string; details?: string[] } };

async function list(accountId: string) {
  const res = await call(app, "GET", path(accountId), { user: "u1" });
  expect(res.status).toBe(200);
  return ((await res.json()) as { items: Post[] }).items;
}

describe("参考投稿の新しい項目", () => {
  it("省略すると既定値（Threads・投稿日不明・数字なし）で、鮮度は unknown、shortId はIDの先頭8文字", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const res = await call(app, "POST", path(accountId), { user: "u1", body: { body: "本文" } });
    expect(res.status).toBe(201);
    const [p] = await list(accountId);
    expect(p).toMatchObject({
      platform: "threads",
      postedDateMode: "unknown",
      postedDate: null,
      metrics: { likes: null, replies: null, views: null, saves: null, reposts: null, followers: null },
      author: "",
      memo: "",
      freshness: "unknown",
    });
    expect(p!.shortId).toBe(p!.id.replace(/-/g, "").slice(0, 8));
  });

  it("媒体・投稿日・数字・投稿者・メモを保存し、編集で変えられる。投稿日から鮮度を出す", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const today = new Date();
    const ymd = new Date(today.getTime() + 9 * 3600_000 - 5 * 86_400_000).toISOString().slice(0, 10);
    const res = await call(app, "POST", path(accountId), {
      user: "u1",
      body: {
        body: "本文",
        platform: "instagram",
        postedDateMode: "exact",
        postedDate: ymd,
        metrics: { views: 32000, likes: 820, followers: 1800 },
        author: "@someone",
        memo: "冒頭が気になった",
      },
    });
    expect(res.status).toBe(201);
    const [p] = await list(accountId);
    expect(p).toMatchObject({
      platform: "instagram",
      postedDateMode: "exact",
      postedDate: ymd,
      metrics: { views: 32000, likes: 820, followers: 1800, replies: null },
      author: "@someone",
      memo: "冒頭が気になった",
      freshness: "latest",
    });
    const put = await call(app, "PUT", `${path(accountId)}/${p!.id}`, {
      user: "u1",
      body: { body: "本文", postedDateMode: "3months", expectedVersion: p!.version },
    });
    expect(put.status).toBe(200);
    const [after] = await list(accountId);
    expect(after).toMatchObject({ postedDateMode: "3months", postedDate: null, platform: "threads", freshness: "active" });
  });

  it.each([
    ["exact で日付がない", { postedDateMode: "exact" }, "postedDate"],
    ["未来の日付", { postedDateMode: "exact", postedDate: "2099-01-01" }, "postedDate"],
    ["exact 以外で日付がある", { postedDateMode: "week", postedDate: "2026-10-01" }, "postedDate"],
    ["負の数字", { metrics: { views: -1 } }, "metrics"],
    ["101文字の投稿者", { author: "あ".repeat(101) }, "author"],
    ["一覧にない媒体", { platform: "facebook" }, "platform"],
  ])("%s は 400 で details に項目名", async (_label, extra, field) => {
    const { accountId } = await createUserWithAccount("u1");
    const res = await call(app, "POST", path(accountId), { user: "u1", body: { body: "本文", ...extra } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error.details).toContain(field);
  });
});
