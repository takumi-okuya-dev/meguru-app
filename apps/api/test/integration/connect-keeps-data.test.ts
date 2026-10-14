// US2：つないでもデータは残り、自動投稿はオフのまま（specs/012 FR-013・FR-014・FR-018、SC-003）
import { count, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  accounts,
  activityLogs,
  ngWords,
  postDrafts,
  postingSchedules,
  promotions,
  referencePosts,
  researchKeywords,
  strategyDesigns,
  threadsConnections,
} from "../../src/db/schema";
import {
  authorizeAndCallback,
  call,
  connectExisting,
  createAccountVia,
  db,
  fake,
  makeApp,
  redirectTarget,
  resetDb,
} from "../helpers/app";

const app = makeApp();
const base = (id: string) => `/api/accounts/${id}`;

beforeEach(async () => {
  await resetDb();
  await fake.reset();
  await fake.addUser("1001", "cafe_b");
  await fake.addUser("1002", "shop_c");
});

async function counts(accountId: string) {
  const out: Record<string, number> = {};
  for (const [name, t] of Object.entries({ strategyDesigns, promotions, referencePosts, researchKeywords, postDrafts, ngWords, postingSchedules })) {
    const [row] = await db().select({ n: count() }).from(t).where(eq(t.accountId, accountId));
    out[name] = Number(row!.n);
  }
  return out;
}

/** 未接続のアカウントに、戦略・宣伝内容・リサーチ・承認済みと却下の案・NGワード・ルール・時刻（オフ）を入れる */
async function fill(accountId: string) {
  const ok = async (res: Response) => expect(res.status, await res.clone().text()).toBeLessThan(300);
  const current = (await (await call(app, "GET", `${base(accountId)}/strategy`, { user: "u1" })).json()) as Record<string, unknown>;
  const { canEdit: _c, filledCount: _f, totalCount: _t, updatedAt: _u, version, ...values } = current;
  await ok(await call(app, "PUT", `${base(accountId)}/strategy`, { user: "u1", body: { ...values, targetPersona: "会社員", expectedVersion: version } }));
  await ok(await call(app, "POST", `${base(accountId)}/promotions`, { user: "u1", body: { title: "秋", content: "秋の新メニュー", status: "active", cta: "来店" } }));
  await ok(await call(app, "POST", `${base(accountId)}/reference-posts`, { user: "u1", body: { body: "参考" } }));
  await ok(await call(app, "POST", `${base(accountId)}/research-keywords`, { user: "u1", body: { keyword: "カフェ", purpose: "" } }));
  await ok(await call(app, "POST", `${base(accountId)}/ng-words`, { user: "u1", body: { words: ["絶対"] } }));
  await ok(await call(app, "PUT", `${base(accountId)}/core-rules`, { user: "u1", body: { text: "ルール", expectedVersion: 1 } }));
  const batch = (await (
    await call(app, "POST", `${base(accountId)}/draft-batches`, { user: "u1", body: { clientRequestId: crypto.randomUUID(), text: "A\n@@@\nB" } })
  ).json()) as { drafts: { id: string; version: number }[] };
  await ok(
    await call(app, "POST", `${base(accountId)}/post-drafts/review`, {
      user: "u1",
      body: { requestId: crypto.randomUUID(), action: "approve", items: [{ id: batch.drafts[0]!.id, expectedVersion: 1 }] },
    }),
  );
  await ok(
    await call(app, "POST", `${base(accountId)}/post-drafts/review`, {
      user: "u1",
      body: { requestId: crypto.randomUUID(), action: "reject", items: [{ id: batch.drafts[1]!.id, expectedVersion: 1 }], reject: { reasons: ["tone"], note: "" } },
    }),
  );
  // 時刻はつなぐ前でも保存できる（オフのまま。FR-032）
  await ok(
    await call(app, "PUT", `${base(accountId)}/posting-schedule`, {
      user: "u1",
      body: { enabled: false, slotTimes: ["09:00"], jitter: true, expectedVersion: 0 },
    }),
  );
}

describe("つないでもデータは残る（SC-003）", () => {
  it("このアプリの接続でつないだ前後で件数が同じで、自動投稿はオフのまま、時刻の効力は今から（FR-013・FR-014）", async () => {
    const { accountId } = await createAccountVia(app, "u1", "カフェの公式");
    await fill(accountId!);
    const before = await counts(accountId!);
    const logsBefore = await db().select({ n: count() }).from(activityLogs);
    const startedAt = new Date();
    const { callbackRes } = await connectExisting(app, "u1", accountId!, "1001");
    expect(redirectTarget(callbackRes!).searchParams.get("connected")).toBe("connect");
    expect(await counts(accountId!)).toEqual(before);
    expect(await db().select({ n: count() }).from(activityLogs)).toEqual(logsBefore);
    const [schedule] = await db().select().from(postingSchedules).where(eq(postingSchedules.accountId, accountId!));
    expect(schedule!.enabled).toBe(false);
    expect(schedule!.effectiveFrom!.getTime()).toBeGreaterThanOrEqual(startedAt.getTime() - 1000);
    const [acc] = await db().select().from(accounts);
    expect(acc!.name).toBe("カフェの公式");
    expect(acc!.connectionStatus).toBe("connected");
  });

  it("トークンでつないでも同じ", async () => {
    const { accountId } = await createAccountVia(app, "u1", "カフェの公式");
    await fill(accountId!);
    const before = await counts(accountId!);
    const token = await fake.issueToken({ user: "1001" });
    const res = await call(app, "POST", "/api/threads/token-connect", { user: "u1", body: { mode: "connect", accountId, token } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ accountId, kind: "connect", username: "cafe_b" });
    expect(await counts(accountId!)).toEqual(before);
    const [acc] = await db().select().from(accounts);
    expect(acc).toMatchObject({ connectionStatus: "connected", connectionMethod: "token", username: "cafe_b" });
    const [schedule] = await db().select().from(postingSchedules);
    expect(schedule!.enabled).toBe(false);
  });
});

describe("同時のつなぐ操作（FR-018）", () => {
  it("同じ未接続のアカウントへ2つの connect を並べて確定させても、つながるのは1つで、後の方は ACCOUNT_ALREADY_CONNECTED", async () => {
    const { accountId } = await createAccountVia(app, "u1");
    const urls: string[] = [];
    for (let i = 0; i < 2; i++) {
      const res = await call(app, "POST", "/api/threads/connect", { user: "u1", body: { mode: "connect", accountId } });
      urls.push(((await res.json()) as { authorizeUrl: string }).authorizeUrl);
    }
    const results = await Promise.all([
      authorizeAndCallback(app, urls[0]!, { fakeUser: "1001" }),
      authorizeAndCallback(app, urls[1]!, { fakeUser: "1002" }),
    ]);
    const outcomes = results.map((r) => {
      const t = redirectTarget(r);
      return t.searchParams.get("connected") ?? t.searchParams.get("error");
    });
    expect(outcomes.sort()).toEqual(["ACCOUNT_ALREADY_CONNECTED", "connect"]);
    const [acc] = await db().select().from(accounts);
    expect(["1001", "1002"]).toContain(acc!.threadsUserId);
    expect(await db().select().from(threadsConnections)).toHaveLength(1);
  });

  it("このアプリの接続とトークンを並べても同じ", async () => {
    const { accountId } = await createAccountVia(app, "u1");
    const res = await call(app, "POST", "/api/threads/connect", { user: "u1", body: { mode: "connect", accountId } });
    const { authorizeUrl } = (await res.json()) as { authorizeUrl: string };
    const token = await fake.issueToken({ user: "1002" });
    const [cb, tokenRes] = await Promise.all([
      authorizeAndCallback(app, authorizeUrl, { fakeUser: "1001" }),
      call(app, "POST", "/api/threads/token-connect", { user: "u1", body: { mode: "connect", accountId, token } }),
    ]);
    const viaApp = redirectTarget(cb).searchParams.get("connected") ?? redirectTarget(cb).searchParams.get("error");
    const viaToken = tokenRes.status === 200 ? "connect" : ((await tokenRes.json()) as { error: { code: string } }).error.code;
    expect([viaApp, viaToken].sort()).toEqual(["ACCOUNT_ALREADY_CONNECTED", "connect"]);
    expect(await db().select().from(threadsConnections)).toHaveLength(1);
  });
});
