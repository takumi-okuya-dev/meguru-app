// 利用の数・利用の状態（specs/meguru/029-threads-pattern1 research.md R6、contracts/platform-entry.md 4・6、T002・T005）。
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { subscriptions } from "../../src/platform/schema";
import { billingQuantityOf, reportUsage, usingAppsOf } from "../../src/platform/usage/usage";
import { createUserWithAccount, db, insertSubscription, resetDb } from "../helpers/app";
import { ensureUser } from "../helpers/team";

beforeEach(async () => {
  await resetDb();
});

/**
 * Stripeへ数を合わせる印を読む。
 * @param userId - users.id
 * @returns 印
 */
async function dirty(userId: string) {
  const [row] = await db().select({ d: subscriptions.quantitySyncNeeded }).from(subscriptions).where(eq(subscriptions.userId, userId));
  return row?.d;
}

describe("reportUsage", () => {
  it("行がない人は、数0・使っていないとみなす", async () => {
    const userId = await ensureUser("u1");
    expect(await billingQuantityOf(db(), userId)).toBe(0);
    expect(await usingAppsOf(db(), userId)).toEqual([]);
  });

  it("書いて、数と使っているアプリを返す。書き直すと置き換わる", async () => {
    const { userId } = await createUserWithAccount("u1");
    await reportUsage(db(), userId, "threads", { quantity: 2, using: true });
    expect(await billingQuantityOf(db(), userId)).toBe(2);
    expect(await usingAppsOf(db(), userId)).toEqual(["threads"]);
    await reportUsage(db(), userId, "threads", { quantity: 0, using: false });
    expect(await billingQuantityOf(db(), userId)).toBe(0);
    expect(await usingAppsOf(db(), userId)).toEqual([]);
  });

  it("料金の数は全アプリの合計", async () => {
    const { userId } = await createUserWithAccount("u1");
    await reportUsage(db(), userId, "threads", { quantity: 2, using: true });
    await reportUsage(db(), userId, "people", { quantity: 1, using: true });
    expect(await billingQuantityOf(db(), userId)).toBe(3);
    expect((await usingAppsOf(db(), userId)).sort()).toEqual(["people", "threads"]);
  });

  it("料金の数が最後にStripeへ送った数と違えば印を付ける。同じなら付けない。印が消えても、伝え直せば付き直る", async () => {
    const { userId } = await createUserWithAccount("u1");
    await insertSubscription(userId, { status: "active", quantity: 1 });
    // Stripeへ送った数（1）と同じ（数0も、料金の数は最低1）
    await reportUsage(db(), userId, "threads", { quantity: 1, using: true });
    expect(await dirty(userId)).toBe(false);
    await reportUsage(db(), userId, "threads", { quantity: 3, using: true });
    expect(await dirty(userId)).toBe(true);
    // 印を付けたあとで止まったなどで印が消えても、同じ数を伝え直せば付き直る（PR #92 のCodexレビュー）
    await db().update(subscriptions).set({ quantitySyncNeeded: false }).where(eq(subscriptions.userId, userId));
    await reportUsage(db(), userId, "threads", { quantity: 3, using: true });
    expect(await dirty(userId)).toBe(true);
  });

  it("先に数えた古い値は、あとから数えた新しい値を上書きしない（同時に伝えたとき）", async () => {
    const { userId } = await createUserWithAccount("u1");
    const t1 = new Date(Date.now() - 1000);
    const t2 = new Date();
    await reportUsage(db(), userId, "threads", { quantity: 2, using: true, countedAt: t2 });
    await reportUsage(db(), userId, "threads", { quantity: 1, using: true, countedAt: t1 });
    expect(await billingQuantityOf(db(), userId)).toBe(2);
  });

  it("負の数・小数は受け付けない", async () => {
    const { userId } = await createUserWithAccount("u1");
    await expect(reportUsage(db(), userId, "threads", { quantity: -1, using: false })).rejects.toThrow();
    await expect(reportUsage(db(), userId, "threads", { quantity: 1.5, using: true })).rejects.toThrow();
  });
});
