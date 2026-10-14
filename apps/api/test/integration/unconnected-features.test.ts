// US1：未接続のアカウントでも中身を使える（specs/012 FR-031・FR-037、SC-002）。
// 戦略・宣伝内容・リサーチ・プロンプト・案の一括登録・承認・却下・NGワード・投稿のルール・操作の記録が、接続中と同じに通り、
// 承認した案はThreadsに投稿されない。
import { beforeEach, describe, expect, it } from "vitest";
import { postDrafts, publishAttempts } from "../../src/db/schema";
import { call, db, makeApp, resetDb } from "../helpers/app";

const app = makeApp();
const base = (id: string) => `/api/accounts/${id}`;

async function json<T>(res: Response, status = 200): Promise<T> {
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
}

let accountId: string;

beforeEach(async () => {
  await resetDb();
  const created = await json<{ id: string }>(
    await call(app, "POST", "/api/accounts", { user: "u1", body: { name: "カフェの公式" } }),
    201,
  );
  accountId = created.id;
});

describe("未接続のアカウントで使える機能（FR-031）", () => {
  it("戦略・宣伝内容・リサーチを保存でき、プロンプトにアカウントの名前が入る（FR-037）", async () => {
    const current = await json<Record<string, unknown>>(await call(app, "GET", `${base(accountId)}/strategy`, { user: "u1" }));
    const { canEdit: _c, filledCount: _f, totalCount: _t, updatedAt: _u, version, ...values } = current;
    await json(
      await call(app, "PUT", `${base(accountId)}/strategy`, {
        user: "u1",
        body: { ...values, targetPersona: "28歳の会社員", expectedVersion: version },
      }),
    );
    await json(
      await call(app, "POST", `${base(accountId)}/promotions`, {
        user: "u1",
        body: { title: "新メニュー", content: "秋の新メニュー", status: "active", cta: "来店" },
      }),
      201,
    );
    await json(
      await call(app, "POST", `${base(accountId)}/reference-posts`, { user: "u1", body: { body: "参考投稿", whyGood: "数字" } }),
      201,
    );
    await json(
      await call(app, "POST", `${base(accountId)}/research-keywords`, { user: "u1", body: { keyword: "カフェ", purpose: "" } }),
      201,
    );
    const { prompt } = await json<{ prompt: string }>(await call(app, "GET", `${base(accountId)}/prompt`, { user: "u1" }));
    expect(prompt).toContain("表示名: カフェの公式");
    expect(prompt).not.toMatch(/@null|@undefined/);
  });

  it("案の一括登録・承認・却下、NGワードと投稿のルールの保存、操作の記録の読み出しが通り、承認した案は投稿されない（SC-002）", async () => {
    await json(await call(app, "POST", `${base(accountId)}/ng-words`, { user: "u1", body: { words: ["絶対"] } }));
    await json(await call(app, "PUT", `${base(accountId)}/core-rules`, { user: "u1", body: { text: "ルール", expectedVersion: 1 } }));
    const batch = await json<{ drafts: { id: string; version: number }[] }>(
      await call(app, "POST", `${base(accountId)}/draft-batches`, {
        user: "u1",
        body: { clientRequestId: crypto.randomUUID(), text: "1件目\n@@@\n2件目" },
      }),
      201,
    );
    const [first, second] = batch.drafts;
    await json(
      await call(app, "POST", `${base(accountId)}/post-drafts/review`, {
        user: "u1",
        body: { requestId: crypto.randomUUID(), action: "approve", items: [{ id: first!.id, expectedVersion: first!.version }] },
      }),
    );
    await json(
      await call(app, "POST", `${base(accountId)}/post-drafts/review`, {
        user: "u1",
        body: {
          requestId: crypto.randomUUID(),
          action: "reject",
          items: [{ id: second!.id, expectedVersion: second!.version }],
          reject: { reasons: ["tone"], note: "" },
        },
      }),
    );
    const counts = await json<{ approved: number; rejected: number }>(
      await call(app, "GET", `${base(accountId)}/post-drafts/counts`, { user: "u1" }),
    );
    expect(counts).toMatchObject({ approved: 1, rejected: 1 });
    await json(await call(app, "GET", `${base(accountId)}/activity`, { user: "u1" }));
    // 承認しても投稿の試みは作られない（Threadsにつないで自動投稿をオンにするまで）
    expect(await db().select().from(publishAttempts)).toHaveLength(0);
    const statuses = (await db().select({ s: postDrafts.status }).from(postDrafts)).map((r) => r.s).sort();
    expect(statuses).toEqual(["approved", "rejected"]);
  });
});
