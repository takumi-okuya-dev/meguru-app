// US1：名前だけでアカウントを作る（specs/012 FR-002〜FR-004、research.md R3、contracts/api.md「アカウント」）
import { and, eq } from "drizzle-orm";
import { PROMOTION_RATIO_DEFAULT, PROMPT_COUNT_DEFAULT } from "@threads-grower/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { accounts, memberships, threadsConnections, users } from "../../src/db/schema";
import { call, db, makeApp, resetDb } from "../helpers/app";
import { callBilling } from "../helpers/billing";
import { ensureUser } from "../helpers/team";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
});

const create = (user: string, name: unknown) => call(app, "POST", "/api/accounts", { user, body: { name } });
// 決済ONの環境（無料体験中は1件まで。specs/013 research.md R9）
const createOn = (user: string, name: unknown) => callBilling(app, "POST", "/api/accounts", { user, body: { name } });

async function errorCode(res: Response) {
  return ((await res.json()) as { error: { code: string; details?: string[] } }).error;
}

describe("POST /api/accounts", () => {
  it("名前だけで未接続のアカウントを作り、作った人がオーナーになる", async () => {
    const res = await create("u1", "  カフェの公式  ");
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      name: "カフェの公式",
      username: null,
      displayName: null,
      profilePictureUrl: null,
      connectionStatus: "not_connected",
      connectionMethod: null,
      role: "owner",
      ownerName: null,
    });
    const [row] = await db().select().from(accounts);
    expect(row).toMatchObject({
      name: "カフェの公式",
      threadsUserId: null,
      username: null,
      connectionMethod: null,
      connectionStatus: "not_connected",
      promotionRatioPercent: PROMOTION_RATIO_DEFAULT,
      promptPostCount: PROMPT_COUNT_DEFAULT,
    });
    const [u] = await db().select().from(users).where(eq(users.clerkUserId, "u1"));
    const owners = await db()
      .select()
      .from(memberships)
      .where(and(eq(memberships.accountId, row!.id), eq(memberships.role, "owner")));
    expect(owners.map((m) => m.userId)).toEqual([u!.id]);
    // Threads の接続は作らない
    expect(await db().select().from(threadsConnections)).toHaveLength(0);
  });

  it.each([[""], ["   "], ["あ".repeat(51)], [123], [null]])("名前 %j は VALIDATION_FAILED（details: name）で、作らない", async (name) => {
    const res = await create("u1", name);
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(await db().select().from(accounts)).toHaveLength(0);
  });

  it("全角スペース・タブなどで囲まれた名前も、前後を除いて保存する（DBの制約と同じ空白の規則。PR #15 のCodexレビュー）", async () => {
    const res = await create("u1", "\u3000\tカフェの公式\u00a0");
    expect(res.status).toBe(201);
    expect(((await res.json()) as { name: string }).name).toBe("カフェの公式");
  });

  it("50文字ちょうどは作れる（絵文字も1文字）", async () => {
    const res = await create("u1", "😀".repeat(50));
    expect(res.status).toBe(201);
  });

  it("未接続のアカウントも上限に数える。上限なら ACCOUNT_LIMIT_REACHED（決済ONの無料体験中は1件。specs/013 FR-010）", async () => {
    await ensureUser("u1"); // 024の前からいた人（無料体験中）
    expect((await createOn("u1", "1つ目")).status).toBe(201);
    const res = await createOn("u1", "2つ目");
    expect(res.status).toBe(409);
    expect((await errorCode(res)).code).toBe("ACCOUNT_LIMIT_REACHED");
    expect(await db().select().from(accounts)).toHaveLength(1);
  });

  it("同じ人が並べて送っても、上限を超えない（FR-004）", async () => {
    await ensureUser("u1"); // 024の前からいた人（無料体験中）
    const results = await Promise.all([createOn("u1", "A"), createOn("u1", "B"), createOn("u1", "C")]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(await db().select().from(accounts)).toHaveLength(1);
  });

  it("作ったアカウントは /api/me に出て、最後に使ったアカウントがなければ着地先になる", async () => {
    const created = (await (await create("u1", "カフェの公式")).json()) as { id: string };
    const me = (await (await call(app, "GET", "/api/me", { user: "u1" })).json()) as {
      accounts: { id: string; name: string; connectionStatus: string }[];
      landingAccountId: string | null;
      accountLimit: { used: number };
    };
    expect(me.accounts).toEqual([expect.objectContaining({ id: created.id, name: "カフェの公式", connectionStatus: "not_connected" })]);
    expect(me.landingAccountId).toBe(created.id);
    expect(me.accountLimit.used).toBe(1);
  });

  it("ログインしていなければ 401", async () => {
    const res = await call(app, "POST", "/api/accounts", { body: { name: "x" } });
    expect(res.status).toBe(401);
  });
});
