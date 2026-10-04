// US1：下書きの承認・却下・要確認に戻す（specs/004-review-approval FR-002〜FR-010・FR-034・FR-035、research.md R1〜R3）
import { neon } from "@neondatabase/serverless";
import { beforeEach, describe, expect, it } from "vitest";
import { AFTER_TRIAL, call, createUserWithAccount, makeApp, resetDb, setAccount, testEnv } from "../helpers/app";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
});

const base = (accountId: string) => `/api/accounts/${accountId}`;

type PostDraft = {
  id: string;
  body: string;
  status: "needs_review" | "approved" | "rejected";
  version: number;
  reviewedAt: string | null;
  rejectReasons: string[];
  rejectNote: string | null;
};
type ReviewResult = {
  updated: PostDraft[];
  skipped: { id: string; reason: string; latest?: PostDraft }[];
  counts: { needsReview: number; approved: number; rejected: number };
};

async function register(accountId: string, bodies: string[], user = "u1") {
  const res = await call(app, "POST", `${base(accountId)}/draft-batches`, {
    user,
    body: { clientRequestId: crypto.randomUUID(), text: bodies.join("\n@@@\n") },
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { drafts: PostDraft[] }).drafts;
}

function review(accountId: string, body: unknown, user = "u1") {
  return call(app, "POST", `${base(accountId)}/post-drafts/review`, { user, body });
}

async function reviewOk(accountId: string, body: unknown) {
  const res = await review(accountId, body);
  expect(res.status).toBe(200);
  return (await res.json()) as ReviewResult;
}

const items = (...ds: PostDraft[]) => ds.map((d) => ({ id: d.id, expectedVersion: d.version }));

async function addNgWord(accountId: string, word: string, normalized = word) {
  const sql = neon(testEnv.DATABASE_URL);
  await sql`INSERT INTO ng_words (account_id, word, normalized) VALUES (${accountId}, ${word}, ${normalized})`;
}

/** 状態の下書きを n 件、SQL で直接作る（49件ずつのまとまり） */
async function seed(accountId: string, n: number, status: "needs_review" | "approved") {
  const sql = neon(testEnv.DATABASE_URL);
  for (let done = 0; done < n; done += 49) {
    const size = Math.min(49, n - done);
    const [b] = (await sql`
      INSERT INTO draft_batches (account_id, client_request_id, draft_count, delimiter_found)
      VALUES (${accountId}, gen_random_uuid(), ${size}, true) RETURNING id`) as [{ id: string }];
    if (status === "approved") {
      await sql`
        INSERT INTO post_drafts (account_id, batch_id, position, body, status, reviewed_at)
        SELECT ${accountId}, ${b.id}, g, 'seed ' || g, 'approved', now() FROM generate_series(0, ${size - 1}) AS g`;
    } else {
      await sql`
        INSERT INTO post_drafts (account_id, batch_id, position, body)
        SELECT ${accountId}, ${b.id}, g, 'seed ' || g FROM generate_series(0, ${size - 1}) AS g`;
    }
  }
}

describe("POST /post-drafts/review：承認・却下・戻す（FR-002・FR-003・FR-006）", () => {
  it("承認で approved・reviewedAt が入り version が増える。戻すと記録が消える", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const [a] = await register(accountId, ["承認する投稿"]);
    const r = await reviewOk(accountId, { action: "approve", items: items(a!) });
    expect(r.skipped).toEqual([]);
    expect(r.updated[0]).toMatchObject({ status: "approved", version: 2, rejectReasons: [], rejectNote: null });
    expect(r.updated[0]!.reviewedAt).not.toBeNull();
    expect(r.counts).toEqual({ needsReview: 0, approved: 1, rejected: 0 });

    const back = await reviewOk(accountId, { action: "reopen", items: items(r.updated[0]!) });
    expect(back.updated[0]).toMatchObject({ status: "needs_review", version: 3, reviewedAt: null, rejectReasons: [] });
    expect(back.counts).toEqual({ needsReview: 1, approved: 0, rejected: 0 });
  });

  it("却下で理由（候補と自由記述）が入る", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const [a] = await register(accountId, ["却下する投稿"]);
    const r = await reviewOk(accountId, {
      action: "reject",
      items: items(a!),
      reject: { reasons: ["tone", "thin"], note: "語尾がきつい" },
    });
    expect(r.updated[0]).toMatchObject({ status: "rejected", rejectReasons: ["tone", "thin"], rejectNote: "語尾がきつい" });
    expect(r.counts.rejected).toBe(1);
  });

  it("自由記述だけの却下もできる（候補は空）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const [a] = await register(accountId, ["却下する投稿"]);
    const r = await reviewOk(accountId, { action: "reject", items: items(a!), reject: { reasons: [], note: "なんとなく違う" } });
    expect(r.updated[0]).toMatchObject({ status: "rejected", rejectReasons: [], rejectNote: "なんとなく違う" });
  });
});

describe("承認のチェック（FR-005、SC-001）", () => {
  it("NGワード・Threadsの上限は skipped で、状態は変わらない", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await addNgWord(accountId, "絶対");
    const links = Array.from({ length: 6 }, (_, i) => `https://example.com/${i}`).join(" ");
    const [ng, long, link] = await register(accountId, ["絶対に伸びる", "あ".repeat(501), links]);
    const r = await reviewOk(accountId, { action: "approve", items: items(ng!, long!, link!) });
    expect(r.updated).toEqual([]);
    expect(r.skipped.map((s) => [s.id, s.reason])).toEqual([
      [ng!.id, "NG_WORD"],
      [long!.id, "OVER_THREADS_LIMIT"],
      [link!.id, "OVER_THREADS_LIMIT"],
    ]);
    expect(r.counts).toEqual({ needsReview: 3, approved: 0, rejected: 0 });
  });

  it("NGワードの照合は全角／半角・大文字／小文字をそろえる", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await addNgWord(accountId, "ＡＢＣ", "abc");
    const [a] = await register(accountId, ["Abc な話"]);
    const r = await reviewOk(accountId, { action: "approve", items: items(a!) });
    expect(r.skipped[0]!.reason).toBe("NG_WORD");
  });

  it("まとめての承認：10件のうち2件がNGワードなら、8件が承認され2件が skipped", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await addNgWord(accountId, "絶対");
    const bodies = Array.from({ length: 10 }, (_, i) => (i === 3 || i === 7 ? `絶対${i}` : `ふつう${i}`));
    const ds = await register(accountId, bodies);
    const r = await reviewOk(accountId, { action: "approve", items: items(...ds) });
    expect(r.updated).toHaveLength(8);
    expect(r.skipped.map((s) => s.reason)).toEqual(["NG_WORD", "NG_WORD"]);
    expect(r.counts).toEqual({ needsReview: 2, approved: 8, rejected: 0 });
  });
});

describe("二重の記録の防止と競合（FR-010）", () => {
  it("同じ承認・却下を2回送っても、2回目は updated で記録が変わらない", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const [a, b] = await register(accountId, ["A", "B"]);
    const first = await reviewOk(accountId, { action: "approve", items: items(a!) });
    const again = await reviewOk(accountId, { action: "approve", items: items(a!) });
    expect(again.updated[0]).toEqual(first.updated[0]);

    const rej = { action: "reject", items: items(b!), reject: { reasons: ["tone"], note: "" } };
    const r1 = await reviewOk(accountId, rej);
    const r2 = await reviewOk(accountId, { ...rej, reject: { reasons: ["thin"], note: "" } });
    expect(r2.updated[0]).toEqual(r1.updated[0]);
    expect(r2.updated[0]!.rejectReasons).toEqual(["tone"]);
  });

  it("version が古く、目的の状態でもないものは STALE（latest 付き）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const [a] = await register(accountId, ["A"]);
    await call(app, "PUT", `${base(accountId)}/post-drafts/${a!.id}`, { user: "u1", body: { body: "A2", expectedVersion: 1 } });
    const r = await reviewOk(accountId, { action: "approve", items: items(a!) });
    expect(r.skipped).toMatchObject([{ id: a!.id, reason: "STALE", latest: { body: "A2", version: 2 } }]);
  });

  it("却下 → 承認は STALE（要確認に戻してから）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const [a] = await register(accountId, ["A"]);
    const rej = await reviewOk(accountId, { action: "reject", items: items(a!), reject: { reasons: ["tone"], note: "" } });
    const r = await reviewOk(accountId, { action: "approve", items: items(rej.updated[0]!) });
    expect(r.skipped[0]).toMatchObject({ reason: "STALE", latest: { status: "rejected" } });
  });

  it("別のAccountの下書きのIDは NOT_FOUND", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const other = await createUserWithAccount("u2");
    const [x] = await register(other.accountId, ["他人の投稿"], "u2");
    const r = await reviewOk(accountId, { action: "approve", items: items(x!) });
    expect(r.skipped).toEqual([{ id: x!.id, reason: "NOT_FOUND" }]);
  });
});

describe("理由のない却下と入力の検証（FR-003、Constitution原則II）", () => {
  it("候補も自由記述も空の却下は 400", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const [a] = await register(accountId, ["A"]);
    expect((await review(accountId, { action: "reject", items: items(a!), reject: { reasons: [], note: "  " } })).status).toBe(400);
    expect((await review(accountId, { action: "reject", items: items(a!) })).status).toBe(400);
  });

  it("approve に reject を付ける・items が0件・501件・重複は 400", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const [a] = await register(accountId, ["A"]);
    const reject = { reasons: ["tone"], note: "" };
    expect((await review(accountId, { action: "approve", items: items(a!), reject })).status).toBe(400);
    expect((await review(accountId, { action: "approve", items: [] })).status).toBe(400);
    const many = Array.from({ length: 501 }, () => ({ id: crypto.randomUUID(), expectedVersion: 1 }));
    expect((await review(accountId, { action: "approve", items: many })).status).toBe(400);
    expect((await review(accountId, { action: "approve", items: [...items(a!), ...items(a!)] })).status).toBe(400);
    expect((await review(accountId, { action: "approve", items: [{ id: "x", expectedVersion: 1 }] })).status).toBe(400);
  });

  it("DBに直接、理由のない rejected の行を入れると CHECK 制約で失敗する", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const [a] = await register(accountId, ["A"]);
    const sql = neon(testEnv.DATABASE_URL);
    await expect(
      sql`UPDATE post_drafts SET status = 'rejected', reviewed_at = now() WHERE id = ${a!.id}`,
    ).rejects.toThrow(/post_drafts_review_state/);
    await expect(
      sql`UPDATE post_drafts SET status = 'rejected', reviewed_at = now(), reject_reasons = '{}' WHERE id = ${a!.id}`,
    ).rejects.toThrow(/post_drafts_review_state/);
    await expect(
      sql`UPDATE post_drafts SET status = 'approved' WHERE id = ${a!.id}`,
    ).rejects.toThrow(/post_drafts_review_state/);
  });
});

describe("上限（research.md R9）", () => {
  it("承認済みが500件なら承認は LIMIT。同じ送信で先に変えた分も数える", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await seed(accountId, 499, "approved");
    const [a, b] = await register(accountId, ["A", "B"]);
    const r = await reviewOk(accountId, { action: "approve", items: items(a!, b!) });
    expect(r.updated.map((d) => d.id)).toEqual([a!.id]);
    expect(r.skipped).toMatchObject([{ id: b!.id, reason: "LIMIT" }]);
  });

  it("要確認が500件なら reopen は LIMIT", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const [a] = await register(accountId, ["A"]);
    const ap = await reviewOk(accountId, { action: "approve", items: items(a!) });
    await seed(accountId, 500, "needs_review");
    const r = await reviewOk(accountId, { action: "reopen", items: items(ap.updated[0]!) });
    expect(r.skipped).toMatchObject([{ id: a!.id, reason: "LIMIT" }]);
  });
});

describe("アクセス範囲・プラン（FR-033〜FR-035）", () => {
  it("他人のAccountは 404 ACCOUNT_NOT_FOUND", async () => {
    const other = await createUserWithAccount("u2");
    await createUserWithAccount("u1");
    const res = await review(other.accountId, { action: "approve", items: [{ id: crypto.randomUUID(), expectedVersion: 1 }] });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "ACCOUNT_NOT_FOUND" } });
  });

  it("要再接続のAccount・無料体験の後のプラン1でも使える", async () => {
    const { accountId } = await createUserWithAccount("u1", { userCreatedAt: AFTER_TRIAL() });
    await setAccount(accountId, { connectionStatus: "needs_reconnect" });
    const [a] = await register(accountId, ["A"]);
    const r = await reviewOk(accountId, { action: "approve", items: items(a!) });
    expect(r.updated[0]!.status).toBe("approved");
  });
});
