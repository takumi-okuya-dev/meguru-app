// US2・US4：投稿のルール（NGワード・投稿ルール）（specs/004-review-approval FR-014〜FR-021、research.md R3・R6・R11）
import { neon } from "@neondatabase/serverless";
import { beforeEach, describe, expect, it } from "vitest";
import { AFTER_TRIAL, call, createUserWithAccount, makeApp, resetDb, testEnv } from "../helpers/app";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
});

const base = (accountId: string) => `/api/accounts/${accountId}`;

type NgWord = { id: string; word: string; normalized: string };
type PostDraft = { id: string; body: string; status: string; version: number; reviewedAt: string | null };

async function register(accountId: string, bodies: string[]) {
  const res = await call(app, "POST", `${base(accountId)}/draft-batches`, {
    user: "u1",
    body: { clientRequestId: crypto.randomUUID(), text: bodies.join("\n@@@\n") },
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { drafts: PostDraft[] }).drafts;
}

async function approve(accountId: string, d: PostDraft) {
  const res = await call(app, "POST", `${base(accountId)}/post-drafts/review`, {
    user: "u1",
    body: { requestId: crypto.randomUUID(), action: "approve", items: [{ id: d.id, expectedVersion: d.version }] },
  });
  return (await res.json()) as { updated: PostDraft[]; skipped: { reason: string }[] };
}

const addWords = (accountId: string, words: string[], user = "u1") =>
  call(app, "POST", `${base(accountId)}/ng-words`, { user, body: { words } });

async function rules(accountId: string, user = "u1") {
  const res = await call(app, "GET", `${base(accountId)}/posting-rules`, { user });
  expect(res.status).toBe(200);
  return (await res.json()) as {
    ngWords: NgWord[];
    ngWordLimit: number;
    coreRules: string;
    coreRulesVersion: number;
    canEditCoreRules: boolean;
  };
}

describe("GET /posting-rules", () => {
  it("NGワード（古い順）・上限・投稿ルール・編集できるかを返す", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await addWords(accountId, ["絶対"]);
    await addWords(accountId, ["必ず儲かる"]);
    expect(await rules(accountId)).toMatchObject({
      ngWords: [{ word: "絶対" }, { word: "必ず儲かる" }],
      ngWordLimit: 200,
      coreRules: "",
      coreRulesVersion: 1,
      canEditCoreRules: true,
    });
  });
});

describe("POST /ng-words（FR-014・FR-016a）", () => {
  it("重複（正規化して同じもの）と空白だけの語を除いて足す", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await addWords(accountId, ["絶対"]);
    const res = await addWords(accountId, ["絶対", "ＡＢＣ", "abc", "  "]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { added: NgWord[]; duplicates: string[]; reopenedCount: number };
    expect(body.added.map((w) => [w.word, w.normalized])).toEqual([["ＡＢＣ", "abc"]]);
    expect(body.duplicates).toEqual(["絶対", "abc"]);
    expect(body.reopenedCount).toBe(0);
  });

  it("前後の空白を除いて保存する", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await addWords(accountId, ["  絶対 "]);
    expect((await rules(accountId)).ngWords.map((w) => w.word)).toEqual(["絶対"]);
  });

  it("既存199語に2語を足すと 409 ITEM_LIMIT_REACHED で、何も足さない", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const sql = neon(testEnv.DATABASE_URL);
    await sql`INSERT INTO ng_words (account_id, word, normalized)
      SELECT ${accountId}, 'w' || g, 'w' || g FROM generate_series(1, 199) AS g`;
    const res = await addWords(accountId, ["新しい1", "新しい2"]);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "ITEM_LIMIT_REACHED" } });
    expect((await rules(accountId)).ngWords).toHaveLength(199);
  });

  it("51文字の語・201件・0件は 400", async () => {
    const { accountId } = await createUserWithAccount("u1");
    expect((await addWords(accountId, ["あ".repeat(51)])).status).toBe(400);
    expect((await addWords(accountId, Array.from({ length: 201 }, (_, i) => `w${i}`))).status).toBe(400);
    expect((await addWords(accountId, [])).status).toBe(400);
  });

  it("足した語を含む承認済みの下書きは要確認に戻る。語を消しても戻らない（Clarifications Q2）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const [hit, other] = await register(accountId, ["絶対に伸びる", "ふつうの投稿"]);
    const a = (await approve(accountId, hit!)).updated[0]!;
    await approve(accountId, other!);
    const res = await addWords(accountId, ["絶対"]);
    const body = (await res.json()) as { added: NgWord[]; reopenedCount: number };
    expect(body.reopenedCount).toBe(1);

    const list = await call(app, "GET", `${base(accountId)}/post-drafts`, { user: "u1" });
    const drafts = (await list.json()) as { needsReview: PostDraft[]; approved: PostDraft[] };
    expect(drafts.needsReview.map((d) => [d.id, d.reviewedAt, d.version])).toEqual([[hit!.id, null, a.version + 1]]);
    expect(drafts.approved.map((d) => d.id)).toEqual([other!.id]);

    expect((await call(app, "DELETE", `${base(accountId)}/ng-words/${body.added[0]!.id}`, { user: "u1" })).status).toBe(204);
    const after = await call(app, "GET", `${base(accountId)}/post-drafts`, { user: "u1" });
    expect(((await after.json()) as { needsReview: PostDraft[] }).needsReview.map((d) => d.id)).toEqual([hit!.id]);
  });

  it("NGワードの追加と承認を同時に送っても、NGワードを含む承認済みが残らない（research.md R3）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const sql = neon(testEnv.DATABASE_URL);
    // 1回ごとに登録・承認・追加の3リクエストを送る。CIでは1リクエスト1〜3秒かかるので、回数を抑えて時間の上限を延ばす
    for (let i = 0; i < 8; i++) {
      await sql`DELETE FROM ng_words WHERE account_id = ${accountId}`;
      const [d] = await register(accountId, [`絶対に伸びる ${i}`]);
      await Promise.all([approve(accountId, d!), addWords(accountId, ["絶対"])]);
      const [r] = (await sql`
        SELECT count(*)::int AS n FROM post_drafts
        WHERE account_id = ${accountId} AND status = 'approved' AND body LIKE '%絶対%'`) as [{ n: number }];
      expect(r.n).toBe(0);
    }
  }, 120_000);

  it("要確認が500件でも、足した語を含む承認済みはすべて要確認に戻す（安全を優先。data-model.md、PR #5 のCodexレビュー）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const [hit] = await register(accountId, ["絶対に伸びる"]);
    await approve(accountId, hit!);
    const sql = neon(testEnv.DATABASE_URL);
    for (let done = 0; done < 500; done += 49) {
      const size = Math.min(49, 500 - done);
      const [b] = (await sql`
        INSERT INTO draft_batches (account_id, client_request_id, draft_count, delimiter_found)
        VALUES (${accountId}, gen_random_uuid(), ${size}, true) RETURNING id`) as [{ id: string }];
      await sql`
        INSERT INTO post_drafts (account_id, batch_id, position, body)
        SELECT ${accountId}, ${b.id}, g, 'seed ' || g FROM generate_series(0, ${size - 1}) AS g`;
    }
    const res = await addWords(accountId, ["絶対"]);
    expect(((await res.json()) as { reopenedCount: number }).reopenedCount).toBe(1);
    const counts = await call(app, "GET", `${base(accountId)}/post-drafts/counts`, { user: "u1" });
    expect(await counts.json()).toMatchObject({ needsReview: 501, approved: 0 });
  });

  it("無料体験の後のプラン1でも追加・削除できる（FR-017）", async () => {
    const { accountId } = await createUserWithAccount("u1", { userCreatedAt: AFTER_TRIAL() });
    const res = await addWords(accountId, ["絶対"]);
    expect(res.status).toBe(200);
    const [w] = ((await res.json()) as { added: NgWord[] }).added;
    expect((await call(app, "DELETE", `${base(accountId)}/ng-words/${w!.id}`, { user: "u1" })).status).toBe(204);
  });
});

describe("DELETE /ng-words/:id とアクセス範囲", () => {
  it("別のAccountの語のIDは 404 ITEM_NOT_FOUND", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const other = await createUserWithAccount("u2");
    const res = await addWords(other.accountId, ["他人の語"], "u2");
    const [w] = ((await res.json()) as { added: NgWord[] }).added;
    const del = await call(app, "DELETE", `${base(accountId)}/ng-words/${w!.id}`, { user: "u1" });
    expect(del.status).toBe(404);
    expect(await del.json()).toMatchObject({ error: { code: "ITEM_NOT_FOUND" } });
  });

  it("他人のAccountは 404 ACCOUNT_NOT_FOUND", async () => {
    const other = await createUserWithAccount("u2");
    await createUserWithAccount("u1");
    expect((await call(app, "GET", `${base(other.accountId)}/posting-rules`, { user: "u1" })).status).toBe(404);
    expect((await addWords(other.accountId, ["x"])).status).toBe(404);
  });
});

describe("PUT /core-rules（FR-019〜FR-021）", () => {
  const put = (accountId: string, text: string, expectedVersion: number) =>
    call(app, "PUT", `${base(accountId)}/core-rules`, { user: "u1", body: { text, expectedVersion } });

  it("保存すると版が1増え、GET /posting-rules に反映される。全体の前後の空白は除く", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const res = await put(accountId, "  断定口調は使わない\n医療の効果をうたわない \n", 1);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ coreRules: "断定口調は使わない\n医療の効果をうたわない", coreRulesVersion: 2 });
    expect(await rules(accountId)).toMatchObject({ coreRules: "断定口調は使わない\n医療の効果をうたわない", coreRulesVersion: 2 });
  });

  it("同じ expectedVersion の2回目は 409 STALE_UPDATE（latest 付き）。2,001文字は 400", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await put(accountId, "A", 1);
    const stale = await put(accountId, "B", 1);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: { code: "STALE_UPDATE" }, latest: { coreRules: "A", coreRulesVersion: 2 } });
    expect((await put(accountId, "あ".repeat(2001), 2)).status).toBe(400);
  });

  it("無料体験の後のプラン1は 403 GROWER_FEATURE_REQUIRED で、GET は canEditCoreRules: false（FR-020）", async () => {
    const { accountId } = await createUserWithAccount("u1", { userCreatedAt: AFTER_TRIAL() });
    const res = await put(accountId, "A", 1);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "GROWER_FEATURE_REQUIRED" } });
    expect((await rules(accountId)).canEditCoreRules).toBe(false);
  });
});
