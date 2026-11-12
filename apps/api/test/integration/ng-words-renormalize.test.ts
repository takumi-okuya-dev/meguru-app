// 照合の正規化を変えたときの、登録済みのNGワードとの整合（PR #20 のCodexレビュー）。
//
// `ng_words.normalized` は登録した時点の値で、DBの重複の判定（`(account_id, normalized)` の
// 一意索引）に使う。照合の正規化を変えると保存値は古くなるので、**照合も重複の判定も
// `word` から正規化し直す**。そうしないと、同じ文字どうしでも当たらず、同じ語を二重に
// 登録できてしまう。
import { neon } from "@neondatabase/serverless";
import { beforeEach, describe, expect, it } from "vitest";
import { call, createAccountVia, makeApp, resetDb, testEnv } from "../helpers/app";

const app = makeApp();
const sql = () => neon(testEnv.DATABASE_URL);

beforeEach(async () => {
  await resetDb();
});

/**
 * 古い正規化のまま保存された行を直に入れる（以前は異体字セレクタが normalized に残っていた）。
 * @param accountId - accounts.id
 * @param word - 入力のままの語
 * @param staleNormalized - 古い正規化の値
 */
async function insertStale(accountId: string, word: string, staleNormalized: string) {
  await sql()`INSERT INTO threads.ng_words (account_id, word, normalized) VALUES (${accountId}, ${word}, ${staleNormalized})`;
}

describe("登録済みのNGワードの normalized が古いとき", () => {
  it("承認のチェックで、その語を見落とさない", async () => {
    const { accountId } = await createAccountVia(app, "u1");
    await insertStale(accountId!, "☀️", "☀️");
    // 本文は新しい正規化で「☀」になる。古い保存値をそのまま使うと当たらない
    const res = await call(app, "POST", `/api/accounts/${accountId}/draft-batches`, {
      user: "u1",
      body: { clientRequestId: crypto.randomUUID(), text: "今日は☀です" },
    });
    expect(res.status).toBe(201);
    const list = await call(app, "GET", `/api/accounts/${accountId}/post-drafts`, { user: "u1" });
    const body = (await list.json()) as { needsReview: { id: string; version: number }[] };
    const draft = body.needsReview[0]!;
    // 承認しようとすると、NGワードで止まる
    const review = await call(app, "POST", `/api/accounts/${accountId}/post-drafts/review`, {
      user: "u1",
      body: {
        requestId: crypto.randomUUID(),
        action: "approve",
        items: [{ id: draft.id, expectedVersion: draft.version }],
      },
    });
    const result = (await review.json()) as { skipped: { id: string; reason: string }[] };
    expect(result.skipped).toEqual([expect.objectContaining({ id: draft.id, reason: "NG_WORD" })]);
  });

  it("同じ語を足そうとすると、重複として扱う（二重に登録しない）", async () => {
    const { accountId } = await createAccountVia(app, "u1");
    await insertStale(accountId!, "☀️", "☀️");
    const res = await call(app, "POST", `/api/accounts/${accountId}/ng-words`, {
      user: "u1",
      body: { words: ["☀️"] },
    });
    expect(res.status).toBe(200);
    const added = (await res.json()) as { added: unknown[]; duplicates: string[] };
    expect(added.added).toEqual([]);
    expect(added.duplicates).toEqual(["☀️"]);
    const rows = (await sql()`SELECT count(*)::int AS n FROM threads.ng_words WHERE account_id = ${accountId}`) as {
      n: number;
    }[];
    expect(rows[0]?.n).toBe(1);
  });
});
