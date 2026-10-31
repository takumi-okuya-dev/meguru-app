// US4：Metaのデータ削除要求（research.md R7、quickstart.md の該当行）
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { accounts, followerSnapshots, postMetricSnapshots, postMetrics, threadsDeletionRequests } from "../../src/db/schema";
import {
  attemptDeletion,
  cleanupDeletionIdentifiers,
  receiveDeletion,
  retryDeletions,
} from "../../src/services/data-deletion";
import { TEST_APP_SECRET } from "../env";
import { call, connectNew, db, fake, makeApp, redirectTarget, resetDb, testEnv } from "../helpers/app";
import { makeSignedRequest } from "../helpers/signed-request";
import { confirmedMetrics, publishedDrafts } from "../helpers/auto-post";

const app = makeApp();
const MIN = 60_000;

beforeEach(async () => {
  await resetDb();
  await fake.reset();
  await fake.addUser("1001", "takumi");
});

async function postDeletion(signedRequest: string) {
  return call(app, "POST", "/api/threads/webhooks/data-deletion", {
    body: new URLSearchParams({ signed_request: signedRequest }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
}

async function request(code: string) {
  const [row] = await db().select().from(threadsDeletionRequests).where(eq(threadsDeletionRequests.confirmationCode, code));
  return row!;
}

describe("POST /api/threads/webhooks/data-deletion", () => {
  it("Accountと関連行が消え、状況確認APIが completed を返す。平文のIDは消え、hmacは残る", async () => {
    await connectNew(app, "u1", "1001");
    const res = await postDeletion(await makeSignedRequest(TEST_APP_SECRET, { user_id: "1001", issued_at: 1 }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; confirmation_code: string };
    expect(body.url).toContain(`/data-deletion/${body.confirmation_code}`);
    expect(await db().select().from(accounts)).toHaveLength(0);

    const status = await call(app, "GET", `/api/data-deletion/${body.confirmation_code}`);
    const s = (await status.json()) as { status: string; completedAt: string | null };
    expect(s.status).toBe("completed");
    expect(s.completedAt).not.toBeNull();
    expect(JSON.stringify(s)).not.toContain("1001");

    const row = await request(body.confirmation_code);
    expect(row.threadsUserId).toBeNull();
    expect(row.threadsUserHmac).not.toBeNull();
  });

  it("反応数の記録・取り込みの履歴・フォロワー数の記録も一緒に消える（specs/006 前提）", async () => {
    await connectNew(app, "u1", "1001");
    const [a] = await db().select().from(accounts);
    const [p] = await publishedDrafts(a!.id, [{ publishedAt: new Date(Date.now() - 200 * 3600_000) }]);
    await confirmedMetrics(a!.id, p!.id, 10);
    await db().insert(postMetricSnapshots).values({
      draftId: p!.id, accountId: a!.id, kind: "d7", method: "slot", fetchedAt: new Date(), elapsedMinutes: 10080, views: 10,
    });
    await db().insert(followerSnapshots).values({ accountId: a!.id, snapshotDate: "2026-10-08", followersCount: 5, capturedAt: new Date() });

    const res = await postDeletion(await makeSignedRequest(TEST_APP_SECRET, { user_id: "1001", issued_at: 1 }));
    expect(res.status).toBe(200);
    expect(await db().select().from(postMetrics)).toHaveLength(0);
    expect(await db().select().from(postMetricSnapshots)).toHaveLength(0);
    expect(await db().select().from(followerSnapshots)).toHaveLength(0);
  });

  it("同じ signed_request の再送は、同じ確認コードを返して新しい行を作らず、再接続したAccountは残る", async () => {
    await connectNew(app, "u1", "1001");
    const sr = await makeSignedRequest(TEST_APP_SECRET, { user_id: "1001", issued_at: 1 });
    const first = (await (await postDeletion(sr)).json()) as { confirmation_code: string };
    // 削除の完了後にユーザーが改めて接続する
    const { callbackRes } = await connectNew(app, "u1", "1001");
    expect(redirectTarget(callbackRes!).searchParams.get("connected")).toBe("connect");
    const second = (await (await postDeletion(sr)).json()) as { confirmation_code: string };
    expect(second.confirmation_code).toBe(first.confirmation_code);
    expect(await db().select().from(threadsDeletionRequests)).toHaveLength(1);
    expect(await db().select().from(accounts)).toHaveLength(1);
  });

  it("署名が違えば 400", async () => {
    const res = await postDeletion(await makeSignedRequest("wrong", { user_id: "1001" }));
    expect(res.status).toBe(400);
  });

  it("トークンを貼る方法だけでシークレットがなければ、見本の鍵の署名でも 400 で、何も消さない", async () => {
    await connectNew(app, "u1", "1001");
    const sr = await makeSignedRequest("xxxxxxxx", { user_id: "1001" });
    for (const secret of [undefined, "xxxxxxxx"]) {
      const res = await call(app, "POST", "/api/threads/webhooks/data-deletion", {
        body: new URLSearchParams({ signed_request: sr }),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        env: { ...testEnv, THREADS_CONNECT_METHODS: "token", THREADS_APP_SECRET: secret } as typeof testEnv,
      });
      expect(res.status).toBe(400);
    }
    expect(await db().select().from(accounts)).toHaveLength(1);
    expect(await db().select().from(threadsDeletionRequests)).toHaveLength(0);
  });

  it("存在しない確認コードは 404", async () => {
    expect((await call(app, "GET", "/api/data-deletion/nope")).status).toBe(404);
  });
});

describe("削除要求の再試行（Cron）", () => {
  it("削除に失敗すると failed になり、15分経った後の再試行で completed になる", async () => {
    await connectNew(app, "u1", "1001");
    const sr = await makeSignedRequest(TEST_APP_SECRET, { user_id: "1001", issued_at: 1 });
    const { code } = await receiveDeletion(testEnv, sr, new Date());
    await attemptDeletion(testEnv, code, (await request(code)).lastAttemptedAt, {
      beforeDelete: () => {
        throw new Error("injected failure");
      },
    });
    const failed = await request(code);
    expect(failed.status).toBe("failed");
    expect(failed.attempts).toBe(1);
    expect(await db().select().from(accounts)).toHaveLength(1);

    // 15分経つ前は対象外
    expect((await retryDeletions(testEnv, new Date(Date.now() + 10 * MIN))).attempted).toBe(0);
    const result = await retryDeletions(testEnv, new Date(Date.now() + 16 * MIN));
    expect(result.completed).toBe(1);
    expect((await request(code)).status).toBe("completed");
    expect(await db().select().from(accounts)).toHaveLength(0);
  });

  it("受付の記録だけ残して中断した pending の要求は、15分経った後の再試行で completed になる", async () => {
    await connectNew(app, "u1", "1001");
    const sr = await makeSignedRequest(TEST_APP_SECRET, { user_id: "1001", issued_at: 1 });
    const { code } = await receiveDeletion(testEnv, sr, new Date());
    expect((await request(code)).status).toBe("pending");
    expect((await retryDeletions(testEnv, new Date(Date.now() + 10 * MIN))).attempted).toBe(0);
    await retryDeletions(testEnv, new Date(Date.now() + 16 * MIN));
    expect((await request(code)).status).toBe("completed");
  });

  it("2つのWorkerが同じ古い要求を処理しても、claimに失敗した側は何も削除しない（再接続したAccountが残る）", async () => {
    await connectNew(app, "u1", "1001");
    const sr = await makeSignedRequest(TEST_APP_SECRET, { user_id: "1001", issued_at: 1 });
    const { code } = await receiveDeletion(testEnv, sr, new Date());
    const observed = (await request(code)).lastAttemptedAt;
    // Worker A が先に完了させる
    await attemptDeletion(testEnv, code, observed);
    expect((await request(code)).status).toBe("completed");
    // ユーザーが削除の完了後に新しい認可フローで再接続する
    const { callbackRes } = await connectNew(app, "u1", "1001");
    expect(redirectTarget(callbackRes!).searchParams.get("connected")).toBe("connect");
    // 遅れて Worker B が、古い読み取り結果のまま処理を続ける
    const outcome = await attemptDeletion(testEnv, code, observed);
    expect(outcome).toBe("skipped");
    expect(await db().select().from(accounts)).toHaveLength(1);
  });

  it("未完了の要求がある間に始めた認可フローは拒否され、完了の後で始めた認可フローは成功する", async () => {
    await connectNew(app, "u1", "1001");
    const sr = await makeSignedRequest(TEST_APP_SECRET, { user_id: "1001", issued_at: 1 });
    const { code } = await receiveDeletion(testEnv, sr, new Date());
    await attemptDeletion(testEnv, code, (await request(code)).lastAttemptedAt, {
      beforeDelete: () => {
        throw new Error("injected failure");
      },
    });
    // failed のまま残っている間に始めた認可フロー
    const blocked = await connectNew(app, "u1", "1001");
    expect(redirectTarget(blocked.callbackRes!).searchParams.get("error")).toBe("THREADS_DATA_DELETION_REQUESTED");
    await retryDeletions(testEnv, new Date(Date.now() + 16 * MIN));
    const after = await connectNew(app, "u1", "1001");
    expect(redirectTarget(after.callbackRes!).searchParams.get("connected")).toBe("connect");
  });
});

describe("識別子の消去", () => {
  it("完了の時点では hmac が残り、完了から15分以上経った後の掃除で消える", async () => {
    await connectNew(app, "u1", "1001");
    const sr = await makeSignedRequest(TEST_APP_SECRET, { user_id: "1001", issued_at: 1 });
    const { code } = await receiveDeletion(testEnv, sr, new Date());
    await attemptDeletion(testEnv, code, (await request(code)).lastAttemptedAt);
    expect((await request(code)).threadsUserHmac).not.toBeNull();
    await cleanupDeletionIdentifiers(testEnv, new Date(Date.now() + 10 * MIN));
    expect((await request(code)).threadsUserHmac).not.toBeNull();
    const result = await cleanupDeletionIdentifiers(testEnv, new Date(Date.now() + 16 * MIN));
    expect(result.cleared).toBe(1);
    const row = await request(code);
    expect(row.threadsUserHmac).toBeNull();
    expect(row.threadsUserId).toBeNull();
  });
});
