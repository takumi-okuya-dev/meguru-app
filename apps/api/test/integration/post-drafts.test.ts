// US2・US3：投稿ストックの下書き（specs/003-prompt-bulk-register FR-009〜FR-020・FR-024a・FR-025、research.md R3・R5〜R8・R10）
import { neon } from "@neondatabase/serverless";
import { beforeEach, describe, expect, it } from "vitest";
import { AFTER_TRIAL, call, createUserWithAccount, makeApp, resetDb, setAccount, testEnv } from "../helpers/app";

import { approvedDrafts, db, setSchedule } from "../helpers/auto-post";
import { putInTeam } from "../helpers/team";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
});

const base = (accountId: string) => `/api/accounts/${accountId}`;

type PostDraft = { id: string; batchId: string; position: number; body: string; status: string; version: number };
type BatchResult = { batchId: string; draftCount: number; delimiterFound: boolean; overLimitCount: number; drafts: PostDraft[] };

function post(accountId: string, text: string, clientRequestId: string = crypto.randomUUID(), user = "u1") {
  return call(app, "POST", `${base(accountId)}/draft-batches`, { user, body: { clientRequestId, text } });
}

async function register(accountId: string, text: string, user = "u1") {
  const res = await post(accountId, text, undefined, user);
  expect(res.status).toBe(201);
  return (await res.json()) as BatchResult;
}

async function list(accountId: string, user = "u1") {
  const res = await call(app, "GET", `${base(accountId)}/post-drafts`, { user });
  expect(res.status).toBe(200);
  return (await res.json()) as { needsReview: PostDraft[]; limits: { needsReview: number; approved: number } };
}

/** 要確認の下書きを n 件、SQL で直接作る（49件ずつのまとまり） */
async function seedDrafts(accountId: string, n: number) {
  const sql = neon(testEnv.DATABASE_URL);
  for (let done = 0; done < n; done += 49) {
    const size = Math.min(49, n - done);
    const [b] = (await sql`
      INSERT INTO threads.draft_batches (account_id, client_request_id, draft_count, delimiter_found)
      VALUES (${accountId}, gen_random_uuid(), ${size}, true) RETURNING id`) as [{ id: string }];
    await sql`
      INSERT INTO threads.post_drafts (account_id, batch_id, position, body)
      SELECT ${accountId}, ${b.id}, g, 'seed ' || g FROM generate_series(0, ${size - 1}) AS g`;
  }
}

async function countRows(accountId: string) {
  const sql = neon(testEnv.DATABASE_URL);
  const [r] = (await sql`SELECT count(*)::int AS n FROM threads.post_drafts WHERE account_id = ${accountId}`) as [{ n: number }];
  return r.n;
}

describe("POST /draft-batches（一括登録）", () => {
  it("@@@ の行で分けて要確認として登録し、貼り付けた順の position を振る", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const r = await register(accountId, "1件目\n@@@\n2件目\n\n続き\n@@@\n3件目\n");
    expect(r).toMatchObject({ draftCount: 3, delimiterFound: true, overLimitCount: 0 });
    expect(r.drafts.map((d) => [d.position, d.body, d.status, d.version])).toEqual([
      [0, "1件目", "needs_review", 1],
      [1, "2件目\n\n続き", "needs_review", 1],
      [2, "3件目", "needs_review", 1],
    ]);
  });

  it("区切りがなければ1件で delimiterFound: false。Threadsの上限を超える下書きは overLimitCount に数える", async () => {
    const { accountId } = await createUserWithAccount("u1");
    expect(await register(accountId, "区切りのない投稿")).toMatchObject({ draftCount: 1, delimiterFound: false });
    const links = Array.from({ length: 6 }, (_, i) => `https://example.com/${i}`).join(" ");
    const r = await register(accountId, ["あ".repeat(501), "😀".repeat(126), links, "ふつう"].join("\n@@@\n"));
    expect(r).toMatchObject({ draftCount: 4, overLimitCount: 3 });
  });

  it("一括登録は無料体験の後（決済OFF）でも 201（FR-024a）", async () => {
    const { accountId } = await createUserWithAccount("u1", { userCreatedAt: AFTER_TRIAL() });
    await register(accountId, "A\n@@@\nB");
  });

  it("要再接続のAccountでも 201（FR-025）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await setAccount(accountId, { connectionStatus: "needs_reconnect" });
    await register(accountId, "A");
  });

  it("二重送信：同じ clientRequestId の2回目は 200 で同じ batchId、下書きは増えない（FR-015）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const id = crypto.randomUUID();
    const first = await post(accountId, "A\n@@@\nB", id);
    expect(first.status).toBe(201);
    const second = await post(accountId, "A\n@@@\nB", id);
    expect(second.status).toBe(200);
    const [a, b] = [(await first.json()) as BatchResult, (await second.json()) as BatchResult];
    expect(b.batchId).toBe(a.batchId);
    expect(b.drafts.map((d) => d.id)).toEqual(a.drafts.map((d) => d.id));
    expect(await countRows(accountId)).toBe(2);
  });

  it("1回の上限：51件・50,001文字・2,001文字の1件は 400 PASTE_TOO_LARGE で、何も登録されない（FR-014）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const cases: [string, string][] = [
      [Array.from({ length: 51 }, (_, i) => `投稿${i}`).join("\n@@@\n"), "drafts"],
      ["あ".repeat(50001), "text"],
      [["短い", "あ".repeat(2001)].join("\n@@@\n"), "draft:2"],
    ];
    for (const [text, detail] of cases) {
      const res = await post(accountId, text);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: "PASTE_TOO_LARGE", details: [detail] } });
    }
    expect(await countRows(accountId)).toBe(0);
  });

  it("空・空白だけ・clientRequestId の形の誤りは 400 VALIDATION_FAILED", async () => {
    const { accountId } = await createUserWithAccount("u1");
    expect((await post(accountId, "  \n ")).status).toBe(400);
    expect((await post(accountId, "@@@\n@@@")).status).toBe(400);
    expect((await post(accountId, "A", "not-a-uuid")).status).toBe(400);
  });

  it("下書きの上限と同時実行：要確認490件に6件と6件を同時に送ると、片方だけ成功し500件を超えない（R6）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await seedDrafts(accountId, 490);
    const six = Array.from({ length: 6 }, (_, i) => `新${i}`).join("\n@@@\n");
    const results = await Promise.all([post(accountId, six), post(accountId, six)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const failed = results.find((r) => r.status === 409)!;
    expect(await failed.json()).toMatchObject({ error: { code: "ITEM_LIMIT_REACHED" } });
    expect(await countRows(accountId)).toBe(496);
  });

  it("他人のAccountは 404 ACCOUNT_NOT_FOUND", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await createUserWithAccount("u2");
    const res = await post(accountId, "A", undefined, "u2");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "ACCOUNT_NOT_FOUND" } });
  });
});

describe("GET /post-drafts（一覧）", () => {
  it("並び順：新しい登録が上、同じ登録の中は貼り付けた順（FR-018）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await register(accountId, "1-A\n@@@\n1-B");
    await register(accountId, "2-A\n@@@\n2-B\n@@@\n2-C");
    const { needsReview, limits } = await list(accountId);
    expect(needsReview.map((d) => d.body)).toEqual(["2-A", "2-B", "2-C", "1-A", "1-B"]);
    expect(limits).toEqual({ needsReview: 500, approved: 500 });
  });
});

describe("DELETE /draft-batches/:batchId（取り消し）", () => {
  it("その登録の下書きだけが消え、deletedCount が返る。2回目は 0（FR-016a）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await register(accountId, "残す");
    const r = await register(accountId, "A\n@@@\nB");
    const res = await call(app, "DELETE", `${base(accountId)}/draft-batches/${r.batchId}`, { user: "u1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deletedCount: 2 });
    expect((await list(accountId)).needsReview.map((d) => d.body)).toEqual(["残す"]);
    const again = await call(app, "DELETE", `${base(accountId)}/draft-batches/${r.batchId}`, { user: "u1" });
    expect(await again.json()).toEqual({ deletedCount: 0 });
  });

  it("別のAccountの登録・存在しない登録・UUIDでないIDは 404 ITEM_NOT_FOUND", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const other = await createUserWithAccount("u2");
    const r = await register(other.accountId, "他人の下書き", "u2");
    for (const id of [r.batchId, crypto.randomUUID(), "abc"]) {
      const res = await call(app, "DELETE", `${base(accountId)}/draft-batches/${id}`, { user: "u1" });
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: { code: "ITEM_NOT_FOUND" } });
    }
    expect(await countRows(other.accountId)).toBe(1);
  });
});

describe("PUT /post-drafts/:draftId（編集）", () => {
  it("本文を更新して version が1増える。前後の空白は除いて保存する（FR-019）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const [d] = (await register(accountId, "元の本文")).drafts;
    const res = await call(app, "PUT", `${base(accountId)}/post-drafts/${d!.id}`, {
      user: "u1",
      body: { body: "  直した本文\n2行目 \n", expectedVersion: 1 },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      draft: { id: d!.id, body: "直した本文\n2行目", version: 2, position: 0, status: "needs_review" },
      reopened: false,
    });
  });

  it("空白だけ・2,001文字は 400 VALIDATION_FAILED（details: body）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const [d] = (await register(accountId, "A")).drafts;
    for (const body of [" \n ", "あ".repeat(2001)]) {
      const res = await call(app, "PUT", `${base(accountId)}/post-drafts/${d!.id}`, { user: "u1", body: { body, expectedVersion: 1 } });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: "VALIDATION_FAILED", details: ["body"] } });
    }
  });

  it("同じ expectedVersion の2回目は 409 STALE_UPDATE（latest 付き）、削除済みは 404 ITEM_NOT_FOUND", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const [d] = (await register(accountId, "A")).drafts;
    const path = `${base(accountId)}/post-drafts/${d!.id}`;
    expect((await call(app, "PUT", path, { user: "u1", body: { body: "B", expectedVersion: 1 } })).status).toBe(200);
    const stale = await call(app, "PUT", path, { user: "u1", body: { body: "C", expectedVersion: 1 } });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: { code: "STALE_UPDATE" }, latest: { body: "B", version: 2 } });
    await call(app, "POST", `${base(accountId)}/post-drafts/delete`, { user: "u1", body: { ids: [d!.id] } });
    const gone = await call(app, "PUT", path, { user: "u1", body: { body: "D", expectedVersion: 2 } });
    expect(gone.status).toBe(404);
    expect(await gone.json()).toMatchObject({ error: { code: "ITEM_NOT_FOUND" } });
  });

  it("他人のAccountの下書きは 404 ITEM_NOT_FOUND", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const other = await createUserWithAccount("u2");
    const [d] = (await register(other.accountId, "他人", "u2")).drafts;
    const res = await call(app, "PUT", `${base(accountId)}/post-drafts/${d!.id}`, { user: "u1", body: { body: "X", expectedVersion: 1 } });
    expect(res.status).toBe(404);
  });
});

describe("承認済み・却下の下書き（specs/004-review-approval FR-007・FR-009・FR-012・FR-013）", () => {
  const review = (accountId: string, body: unknown) =>
    call(app, "POST", `${base(accountId)}/post-drafts/review`, { user: "u1", body });

  it("承認済みの下書きを編集すると reopened: true で要確認に戻る", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const [d] = (await register(accountId, "A")).drafts;
    await review(accountId, { requestId: crypto.randomUUID(), action: "approve", items: [{ id: d!.id, expectedVersion: 1 }] });
    const res = await call(app, "PUT", `${base(accountId)}/post-drafts/${d!.id}`, {
      user: "u1",
      body: { body: "直した", expectedVersion: 2 },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      draft: { body: "直した", status: "needs_review", reviewedAt: null, version: 3 },
      reopened: true,
    });
  });

  it("却下の下書きは編集できない（404 ITEM_NOT_FOUND）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const [d] = (await register(accountId, "A")).drafts;
    await review(accountId, { requestId: crypto.randomUUID(), action: "reject", items: [{ id: d!.id, expectedVersion: 1 }], reject: { reasons: ["tone"], note: "" } });
    const res = await call(app, "PUT", `${base(accountId)}/post-drafts/${d!.id}`, {
      user: "u1",
      body: { body: "直した", expectedVersion: 2 },
    });
    expect(res.status).toBe(404);
  });

  it("まとめての削除は要確認と却下を消し、承認済みは無視する。取り消しは要確認だけを消す", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const r = await register(accountId, "要確認\n@@@\n承認\n@@@\n却下");
    const [n, a, j] = r.drafts;
    await review(accountId, { requestId: crypto.randomUUID(), action: "approve", items: [{ id: a!.id, expectedVersion: 1 }] });
    await review(accountId, { requestId: crypto.randomUUID(), action: "reject", items: [{ id: j!.id, expectedVersion: 1 }], reject: { reasons: [], note: "x" } });
    const del = await call(app, "POST", `${base(accountId)}/post-drafts/delete`, {
      user: "u1",
      body: { ids: [n!.id, a!.id, j!.id] },
    });
    expect(await del.json()).toEqual({ deletedCount: 2 });
    expect(await countRows(accountId)).toBe(1);

    const r2 = await register(accountId, "B1\n@@@\nB2");
    await review(accountId, { requestId: crypto.randomUUID(), action: "approve", items: [{ id: r2.drafts[0]!.id, expectedVersion: 1 }] });
    const undo = await call(app, "DELETE", `${base(accountId)}/draft-batches/${r2.batchId}`, { user: "u1" });
    expect(await undo.json()).toEqual({ deletedCount: 1 });
    expect(await countRows(accountId)).toBe(2);
  });

  it("一覧：承認済みは投稿の順（承認した古い順。005）、却下は reviewedAt の新しい順。件数のAPIは一覧の counts と一致する", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const ds = (await register(accountId, "A\n@@@\nB\n@@@\nC\n@@@\nD")).drafts;
    for (const d of ds.slice(0, 2)) await review(accountId, { requestId: crypto.randomUUID(), action: "approve", items: [{ id: d.id, expectedVersion: 1 }] });
    await review(accountId, { requestId: crypto.randomUUID(), action: "reject", items: [{ id: ds[2]!.id, expectedVersion: 1 }], reject: { reasons: ["thin"], note: "" } });
    const res = await call(app, "GET", `${base(accountId)}/post-drafts`, { user: "u1" });
    const body = (await res.json()) as {
      needsReview: PostDraft[];
      approved: PostDraft[];
      rejected: PostDraft[];
      counts: unknown;
    };
    expect(body.approved.map((d) => d.body)).toEqual(["A", "B"]);
    expect(body.rejected.map((d) => d.body)).toEqual(["C"]);
    expect(body.needsReview.map((d) => d.body)).toEqual(["D"]);
    expect(body.counts).toEqual({ needsReview: 1, approved: 2, rejected: 1, published: 0, publishFailed: 0 });
    const counts = await call(app, "GET", `${base(accountId)}/post-drafts/counts`, { user: "u1" });
    expect(await counts.json()).toEqual(body.counts);
  });

  it("却下の一覧は新しい500件まで返し、counts.rejected は全件", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const sql = neon(testEnv.DATABASE_URL);
    // position は1つのまとまりで50未満なので、まとまりを分けて501件作る
    for (let i = 0; i < 501; i += 49) {
      const [bb] = (await sql`
        INSERT INTO threads.draft_batches (account_id, client_request_id, draft_count, delimiter_found)
        VALUES (${accountId}, gen_random_uuid(), 49, true) RETURNING id`) as [{ id: string }];
      await sql`
        INSERT INTO threads.post_drafts (account_id, batch_id, position, body, status, reviewed_at, reject_reasons)
        SELECT ${accountId}, ${bb.id}, g, 'r ' || g, 'rejected', now(), '{tone}'
        FROM generate_series(0, ${Math.min(48, 500 - i)}) AS g`;
    }
    const res = await call(app, "GET", `${base(accountId)}/post-drafts`, { user: "u1" });
    const body = (await res.json()) as { rejected: PostDraft[]; counts: { rejected: number } };
    expect(body.rejected).toHaveLength(500);
    expect(body.counts.rejected).toBe(501);
  });
});

describe("POST /post-drafts/delete（まとめての削除）", () => {
  it("自分のAccountの要確認の下書きだけを消し、他人の下書きのIDは無視して数えない（FR-020）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const other = await createUserWithAccount("u2");
    const mine = (await register(accountId, "A\n@@@\nB\n@@@\nC")).drafts;
    const theirs = (await register(other.accountId, "他人", "u2")).drafts;
    const res = await call(app, "POST", `${base(accountId)}/post-drafts/delete`, {
      user: "u1",
      body: { ids: [mine[0]!.id, mine[2]!.id, theirs[0]!.id, crypto.randomUUID()] },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deletedCount: 2 });
    expect((await list(accountId)).needsReview.map((d) => d.body)).toEqual(["B"]);
    expect(await countRows(other.accountId)).toBe(1);
  });

  it("0件・501件・UUIDでないIDは 400", async () => {
    const { accountId } = await createUserWithAccount("u1");
    for (const ids of [[], Array.from({ length: 501 }, () => crypto.randomUUID()), ["abc"]]) {
      const res = await call(app, "POST", `${base(accountId)}/post-drafts/delete`, { user: "u1", body: { ids } });
      expect(res.status).toBe(400);
    }
  });
});

describe("要再接続のAccount（FR-025）", () => {
  it("編集・まとめての削除・取り消しが使える", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const r = await register(accountId, "A\n@@@\nB");
    await setAccount(accountId, { connectionStatus: "needs_reconnect" });
    const put = await call(app, "PUT", `${base(accountId)}/post-drafts/${r.drafts[0]!.id}`, {
      user: "u1",
      body: { body: "直した", expectedVersion: 1 },
    });
    expect(put.status).toBe(200);
    const del = await call(app, "POST", `${base(accountId)}/post-drafts/delete`, { user: "u1", body: { ids: [r.drafts[1]!.id] } });
    expect(await del.json()).toEqual({ deletedCount: 1 });
    const undo = await call(app, "DELETE", `${base(accountId)}/draft-batches/${r.batchId}`, { user: "u1" });
    expect(await undo.json()).toEqual({ deletedCount: 1 });
  });
});

// ---- specs/005-auto-post：一覧の新しい形（T014）と、既存の操作で新しい列が消えること（analyze I2）----

describe("005：一覧の形（research.md R10）", () => {
  const review = (accountId: string, body: unknown) =>
    call(app, "POST", `${base(accountId)}/post-drafts/review`, { user: "u1", body });
  const approve = (accountId: string, id: string, expectedVersion = 1) =>
    review(accountId, { requestId: crypto.randomUUID(), action: "approve", items: [{ id, expectedVersion }] });

  it("承認済みは「次に投稿する」の新しい順 → 承認した古い順。処理中は先頭で、件数は承認済みに数える", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const ds = (await register(accountId, "A\n@@@\nB\n@@@\nC\n@@@\nD")).drafts;
    for (const d of ds) await approve(accountId, d.id);
    const sql = neon(testEnv.DATABASE_URL);
    await sql`UPDATE threads.post_drafts SET prioritized_at = now() - interval '1 minute' WHERE id = ${ds[2]!.id}`;
    await sql`UPDATE threads.post_drafts SET prioritized_at = now() WHERE id = ${ds[3]!.id}`;
    await sql`UPDATE threads.post_drafts SET status = 'publishing' WHERE id = ${ds[1]!.id}`;
    const res = await call(app, "GET", `${base(accountId)}/post-drafts`, { user: "u1" });
    const body = (await res.json()) as Record<string, unknown> & { approved: PostDraft[]; counts: Record<string, number> };
    expect(body.approved.map((d) => d.body)).toEqual(["B", "D", "C", "A"]);
    expect(body.counts).toMatchObject({ approved: 4, published: 0, publishFailed: 0 });
    expect(body).toHaveProperty("publishFailed", []);
    expect(body).toHaveProperty("schedule", {});
    expect(body).toHaveProperty("autoPost", { enabled: false, slotCount: 0, stoppedReason: null });
    expect(body).not.toHaveProperty("published");
  });

  it("投稿済み・投稿に失敗を数え、投稿に失敗は一覧に入る。新しい項目の既定値", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const ds = (await register(accountId, "A\n@@@\nB\n@@@\nC")).drafts;
    for (const d of ds) await approve(accountId, d.id);
    const sql = neon(testEnv.DATABASE_URL);
    await sql`UPDATE threads.post_drafts SET status = 'published', published_at = now(), threads_media_id = 'm1' WHERE id = ${ds[0]!.id}`;
    await sql`UPDATE threads.post_drafts SET status = 'publish_failed', publish_failed_at = now(), publish_error = 'network' WHERE id = ${ds[1]!.id}`;
    const res = await call(app, "GET", `${base(accountId)}/post-drafts`, { user: "u1" });
    const body = (await res.json()) as { approved: PostDraft[]; publishFailed: (PostDraft & Record<string, unknown>)[]; counts: unknown };
    expect(body.counts).toEqual({ needsReview: 0, approved: 1, rejected: 0, published: 1, publishFailed: 1 });
    expect(body.publishFailed.map((d) => [d.body, d.publishError])).toEqual([["B", "network"]]);
    expect(body.approved[0]).toMatchObject({
      body: "C",
      carryover: false,
      blockedWords: [],
      prioritizedAt: null,
      publishedAt: null,
      blockedReason: null,
    });
  });
});

describe("005：既存の操作で新しい列が消える（CHECK制約の違反で500にならない。analyze I2）", () => {
  const review = (accountId: string, body: unknown) =>
    call(app, "POST", `${base(accountId)}/post-drafts/review`, { user: "u1", body });

  /** 要確認の下書きに、投稿の直前のチェックの記録を入れる。 */
  async function block(id: string) {
    const sql = neon(testEnv.DATABASE_URL);
    await sql`UPDATE threads.post_drafts SET blocked_at = now(), blocked_reason = 'ng_word', blocked_words = '{絶対}' WHERE id = ${id}`;
  }

  /** 承認済みの下書きに、「次に投稿する」と持ち越しの記録を入れる。 */
  async function prioritizeAndCarry(accountId: string, id: string) {
    const sql = neon(testEnv.DATABASE_URL);
    const [a] = (await sql`
      INSERT INTO threads.publish_attempts (account_id, slot_at, slot_date, slot_minute, state)
      VALUES (${accountId}, now(), current_date, 0, 'carried_over') RETURNING id`) as [{ id: string }];
    await sql`UPDATE threads.post_drafts SET prioritized_at = now(), carryover_attempt_id = ${a.id} WHERE id = ${id}`;
  }

  async function row(id: string) {
    const sql = neon(testEnv.DATABASE_URL);
    const [r] = (await sql`SELECT * FROM threads.post_drafts WHERE id = ${id}`) as [Record<string, unknown>];
    return r;
  }

  it("直前のチェックの記録のある要確認の下書きを、編集・承認・却下すると記録が消え、削除もできる", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const [e, a, j, x] = (await register(accountId, "E\n@@@\nA\n@@@\nJ\n@@@\nX")).drafts;
    for (const d of [e!, a!, j!, x!]) await block(d.id);

    const edit = await call(app, "PUT", `${base(accountId)}/post-drafts/${e!.id}`, { user: "u1", body: { body: "E2", expectedVersion: 1 } });
    expect(edit.status).toBe(200);
    expect(await edit.json()).toMatchObject({ draft: { blockedAt: null, blockedReason: null, blockedWords: [] } });

    const ap = await review(accountId, { requestId: crypto.randomUUID(), action: "approve", items: [{ id: a!.id, expectedVersion: 1 }] });
    expect(((await ap.json()) as { updated: unknown[] }).updated).toHaveLength(1);
    expect(await row(a!.id)).toMatchObject({ status: "approved", blocked_at: null, blocked_reason: null, blocked_words: null });

    const rj = await review(accountId, {
      requestId: crypto.randomUUID(),
      action: "reject",
      items: [{ id: j!.id, expectedVersion: 1 }],
      reject: { reasons: ["tone"], note: "" },
    });
    expect(((await rj.json()) as { updated: unknown[] }).updated).toHaveLength(1);
    expect(await row(j!.id)).toMatchObject({ status: "rejected", blocked_at: null });

    const del = await call(app, "POST", `${base(accountId)}/post-drafts/delete`, { user: "u1", body: { ids: [x!.id] } });
    expect(await del.json()).toEqual({ deletedCount: 1 });
  });

  it("「次に投稿する」・持ち越しのある承認済みを、要確認に戻す・編集・NGワードの追加で戻すと、2つとも消える", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const [r, e, n] = (await register(accountId, "R\n@@@\nE\n@@@\n絶対N")).drafts;
    for (const d of [r!, e!, n!]) {
      await review(accountId, { requestId: crypto.randomUUID(), action: "approve", items: [{ id: d.id, expectedVersion: 1 }] });
      await prioritizeAndCarry(accountId, d.id);
    }

    const reopen = await review(accountId, { requestId: crypto.randomUUID(), action: "reopen", items: [{ id: r!.id, expectedVersion: 2 }] });
    expect(((await reopen.json()) as { updated: unknown[] }).updated).toHaveLength(1);
    expect(await row(r!.id)).toMatchObject({ status: "needs_review", prioritized_at: null, carryover_attempt_id: null });

    const edit = await call(app, "PUT", `${base(accountId)}/post-drafts/${e!.id}`, { user: "u1", body: { body: "E2", expectedVersion: 2 } });
    expect(edit.status).toBe(200);
    expect(await row(e!.id)).toMatchObject({ status: "needs_review", prioritized_at: null, carryover_attempt_id: null });

    const ng = await call(app, "POST", `${base(accountId)}/ng-words`, { user: "u1", body: { words: ["絶対"] } });
    expect(ng.status).toBe(200);
    expect(await row(n!.id)).toMatchObject({ status: "needs_review", prioritized_at: null, carryover_attempt_id: null });
  });
});

describe("005：処理中・投稿済みの下書き（FR-008・FR-020）と、投稿済みの一覧（research.md R14）", () => {
  const review = (accountId: string, body: unknown) =>
    call(app, "POST", `${base(accountId)}/post-drafts/review`, { user: "u1", body });

  it("処理中の下書きの編集は 409 DRAFT_PUBLISHING、承認・却下・戻すは skipped: PUBLISHING", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const [d] = (await register(accountId, "A")).drafts;
    await review(accountId, { requestId: crypto.randomUUID(), action: "approve", items: [{ id: d!.id, expectedVersion: 1 }] });
    const sql = neon(testEnv.DATABASE_URL);
    await sql`UPDATE threads.post_drafts SET status = 'publishing' WHERE id = ${d!.id}`;

    const edit = await call(app, "PUT", `${base(accountId)}/post-drafts/${d!.id}`, { user: "u1", body: { body: "B", expectedVersion: 2 } });
    expect(edit.status).toBe(409);
    expect(await edit.json()).toMatchObject({ error: { code: "DRAFT_PUBLISHING" }, latest: { status: "publishing" } });

    const reopen = await review(accountId, { requestId: crypto.randomUUID(), action: "reopen", items: [{ id: d!.id, expectedVersion: 2 }] });
    expect(await reopen.json()).toMatchObject({ updated: [], skipped: [{ id: d!.id, reason: "PUBLISHING" }] });
  });

  it("投稿済みの下書きは、編集は 404、削除されない、要確認に戻すは STALE", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const [d] = (await register(accountId, "A")).drafts;
    await review(accountId, { requestId: crypto.randomUUID(), action: "approve", items: [{ id: d!.id, expectedVersion: 1 }] });
    const sql = neon(testEnv.DATABASE_URL);
    await sql`UPDATE threads.post_drafts SET status = 'published', published_at = now() WHERE id = ${d!.id}`;

    expect((await call(app, "PUT", `${base(accountId)}/post-drafts/${d!.id}`, { user: "u1", body: { body: "B", expectedVersion: 2 } })).status).toBe(404);
    const del = await call(app, "POST", `${base(accountId)}/post-drafts/delete`, { user: "u1", body: { ids: [d!.id] } });
    expect(await del.json()).toEqual({ deletedCount: 0 });
    const reopen = await review(accountId, { requestId: crypto.randomUUID(), action: "reopen", items: [{ id: d!.id, expectedVersion: 2 }] });
    expect(await reopen.json()).toMatchObject({ skipped: [{ id: d!.id, reason: "STALE" }] });
  });

  it("GET /post-drafts/published：120件を 50・50・20件に分けて、投稿した日時の新しい順に返す", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const sql = neon(testEnv.DATABASE_URL);
    for (let i = 0; i < 120; i += 40) {
      const [bb] = (await sql`
        INSERT INTO threads.draft_batches (account_id, client_request_id, draft_count, delimiter_found)
        VALUES (${accountId}, gen_random_uuid(), 40, true) RETURNING id`) as [{ id: string }];
      // 2件ずつ同じ投稿日時にして、同じ日時の並び（id の順）も確かめる
      await sql`
        INSERT INTO threads.post_drafts (account_id, batch_id, position, body, status, reviewed_at, published_at, threads_media_id, threads_permalink)
        SELECT ${accountId}, ${bb.id}, g, 'p' || (${i} + g), 'published', now(),
          timestamp '2030-01-01 00:00:00+00' + make_interval(mins => (${i} + g) / 2), 'm' || (${i} + g), 'https://t/' || (${i} + g)
        FROM generate_series(0, 39) AS g`;
    }
    const page = async (before?: string) => {
      const q = before ? `?before=${encodeURIComponent(before)}` : "";
      const res = await call(app, "GET", `${base(accountId)}/post-drafts/published${q}`, { user: "u1" });
      expect(res.status).toBe(200);
      return (await res.json()) as { items: { id: string; body: string; publishedAt: string; threadsPermalink: string | null }[]; nextCursor: string | null };
    };
    const p1 = await page();
    const p2 = await page(p1.nextCursor!);
    const p3 = await page(p2.nextCursor!);
    expect([p1.items.length, p2.items.length, p3.items.length]).toEqual([50, 50, 20]);
    expect(p3.nextCursor).toBeNull();
    const all = [...p1.items, ...p2.items, ...p3.items];
    expect(new Set(all.map((d) => d.id)).size).toBe(120);
    for (let i = 1; i < all.length; i++) {
      const prev = all[i - 1]!;
      const cur = all[i]!;
      const order = Date.parse(prev.publishedAt) - Date.parse(cur.publishedAt);
      expect(order > 0 || (order === 0 && prev.id < cur.id)).toBe(true);
    }
    expect(Object.keys(p1.items[0]!).sort()).toEqual(["body", "id", "mention", "publishedAt", "threadsMediaId", "threadsPermalink", "version"]);
  });

  it("GET /post-drafts/published：読めないカーソル（IDがUUIDでない など）は 400 VALIDATION_FAILED（PR #6 のCodexレビュー）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const cursor = (v: unknown) =>
      btoa(JSON.stringify(v)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    for (const before of [
      cursor(["2030-01-01T00:00:00.000Z", "-".repeat(36)]),
      cursor(["2030-01-01T00:00:00.000Z", "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz"]),
      cursor(["not a date", crypto.randomUUID()]),
      "@@@",
    ]) {
      const res = await call(app, "GET", `${base(accountId)}/post-drafts/published?before=${encodeURIComponent(before)}`, { user: "u1" });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: "VALIDATION_FAILED", details: ["before"] } });
    }
  });

  it("他人のAccountの GET /post-drafts/published は 404 ACCOUNT_NOT_FOUND", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await createUserWithAccount("u2");
    expect((await call(app, "GET", `${base(accountId)}/post-drafts/published`, { user: "u2" })).status).toBe(404);
  });
});


describe("005：予定と次に投稿する操作", () => {
  it("予定を先頭から割り当て、優先した下書きは先頭へ移りversionが増える", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const ids = await approvedDrafts(accountId, ["A", "B", "C"]);
    await setSchedule(accountId, { slotMinutes: [450, 720, 1260] });
    const read = async () => (await (await call(app, "GET", `${base(accountId)}/post-drafts`, { user: "u1" })).json()) as { schedule: Record<string, string>; approved: PostDraft[] };
    let body = await read();
    expect(Object.keys(body.schedule)).toEqual(ids);
    expect(Object.values(body.schedule).map(Date.parse)).toEqual([...Object.values(body.schedule).map(Date.parse)].sort((a, b) => a - b));
    const res = await call(app, "POST", `${base(accountId)}/post-drafts/${ids[2]}/prioritize`, { user: "u1", body: { expectedVersion: 1 } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ draft: { id: ids[2], version: 2 } });
    body = await read();
    expect(body.approved.map(d => d.id)).toEqual([ids[2], ids[0], ids[1]]);
    await db()`UPDATE threads.post_drafts SET status = 'publishing' WHERE id = ${ids[2]!}`;
    expect(Object.keys((await read()).schedule)).toEqual([ids[0], ids[1]]);
    await db()`UPDATE threads.posting_schedules SET enabled = false WHERE account_id = ${accountId}`;
    expect((await read()).schedule).toEqual({});
  });
  it("古い版・処理中・対象外・他人のAccountを拒む", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await createUserWithAccount("u2");
    const [id] = await approvedDrafts(accountId, ["A"]);
    const request = (version: number, user = "u1") => call(app, "POST", `${base(accountId)}/post-drafts/${id}/prioritize`, { user, body: { expectedVersion: version } });
    expect((await request(0, "u2")).status).toBe(404);
    expect((await request(2)).status).toBe(409);
    await db()`UPDATE threads.post_drafts SET status = 'publishing' WHERE id = ${id!}`;
    expect(await (await request(1)).json()).toMatchObject({ error: { code: "DRAFT_PUBLISHING" } });
    await db()`UPDATE threads.post_drafts SET status = 'needs_review', reviewed_at = NULL WHERE id = ${id!}`;
    expect((await request(1)).status).toBe(404);
  });
});

// ---- チーム運用：削除の範囲（specs/008 FR-002a）----
describe("編集者の削除（チーム運用）", () => {
  it("編集者は要確認の案だけを消せ、却下の案は消さずに飛ばす", async () => {
    const { accountId } = await createUserWithAccount("o1");
    await putInTeam(accountId, "o1", { editor: "e1" });
    const reg = await call(app, "POST", `/api/accounts/${accountId}/draft-batches`, {
      user: "e1",
      body: { clientRequestId: crypto.randomUUID(), text: "残す案\n@@@\n却下する案" },
    });
    expect(reg.status).toBe(201);
    const [keep, rejected] = ((await reg.json()) as { drafts: { id: string; version: number }[] }).drafts;
    const rej = await call(app, "POST", `/api/accounts/${accountId}/post-drafts/review`, {
      user: "o1",
      body: {
        requestId: crypto.randomUUID(),
        action: "reject",
        items: [{ id: rejected!.id, expectedVersion: rejected!.version }],
        reject: { reasons: [], note: "違う" },
      },
    });
    expect(rej.status).toBe(200);
    const del = await call(app, "POST", `/api/accounts/${accountId}/post-drafts/delete`, {
      user: "e1",
      body: { ids: [keep!.id, rejected!.id] },
    });
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ deletedCount: 1 });
    const left = (await neon(testEnv.DATABASE_URL)`SELECT id FROM threads.post_drafts WHERE account_id = ${accountId}`) as { id: string }[];
    expect(left.map((r) => r.id)).toEqual([rejected!.id]);
  });
});
