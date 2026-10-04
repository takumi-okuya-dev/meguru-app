// US2・US3：投稿ストックの下書き（specs/003-prompt-bulk-register FR-009〜FR-020・FR-024a・FR-025、research.md R3・R5〜R8・R10）
import { neon } from "@neondatabase/serverless";
import { beforeEach, describe, expect, it } from "vitest";
import { AFTER_TRIAL, call, createUserWithAccount, makeApp, resetDb, setAccount, testEnv } from "../helpers/app";

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
      INSERT INTO draft_batches (account_id, client_request_id, draft_count, delimiter_found)
      VALUES (${accountId}, gen_random_uuid(), ${size}, true) RETURNING id`) as [{ id: string }];
    await sql`
      INSERT INTO post_drafts (account_id, batch_id, position, body)
      SELECT ${accountId}, ${b.id}, g, 'seed ' || g FROM generate_series(0, ${size - 1}) AS g`;
  }
}

async function countRows(accountId: string) {
  const sql = neon(testEnv.DATABASE_URL);
  const [r] = (await sql`SELECT count(*)::int AS n FROM post_drafts WHERE account_id = ${accountId}`) as [{ n: number }];
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

  it("一括登録は全プラン：無料体験の後のプラン1でも 201（FR-024a）", async () => {
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
    expect(await res.json()).toMatchObject({ id: d!.id, body: "直した本文\n2行目", version: 2, position: 0 });
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
