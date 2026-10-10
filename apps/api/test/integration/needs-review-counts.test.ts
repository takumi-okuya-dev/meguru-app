import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { accounts, memberships } from "../../src/db/schema";
import { call, connectNew, createUserWithAccount, db, fake, makeApp, resetDb } from "../helpers/app";
import { ensureTeam, makeEditor, makePartner } from "../helpers/team";

const app = makeApp();
const endpoint = "/api/me/needs-review-counts";

beforeEach(async () => {
  await resetDb();
  await fake.reset();
  for (let i = 1; i <= 5; i++) await fake.addUser(`700${i}`, `review${i}`);
});

async function addAccount(owner: string, fakeId: string) {
  const { callbackRes } = await connectNew(app, owner, fakeId);
  expect(callbackRes?.status).toBe(302);
  const me = (await (await call(app, "GET", "/api/me", { user: owner })).json()) as {
    accounts: { id: string; username: string }[];
  };
  return me.accounts.find((account) => account.username === `review${fakeId.at(-1)}`)!.id;
}

async function addDrafts(accountId: string, count: number) {
  if (count === 0) return;
  const text = Array.from({ length: count }, (_, i) => `下書き ${i + 1}`).join("\n@@@\n");
  const res = await call(app, "POST", `/api/accounts/${accountId}/draft-batches`, {
    user: "u1",
    body: { clientRequestId: crypto.randomUUID(), text },
  });
  expect(res.status).toBe(201);
}

describe("GET /api/me/needs-review-counts", () => {
  it("未認証は401、Accountを持たないユーザーは空配列", async () => {
    expect((await call(app, "GET", endpoint)).status).toBe(401);
    const res = await call(app, "GET", endpoint, { user: "empty" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ counts: [] });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("ownerの3件を5・2・0件で返し、他人とowner以外を除き、要再接続も数える", async () => {
    const first = await addAccount("u1", "7001");
    await db().update(accounts).set({ plan: "multi-account" }).where(eq(accounts.id, first));
    const second = await addAccount("u1", "7002");
    const third = await addAccount("u1", "7003");
    const memberOnly = await addAccount("u1", "7004");
    const other = await addAccount("u2", "7005");
    await db()
      .update(accounts)
      .set({ connectionStatus: "needs_reconnect" })
      .where(eq(accounts.id, second));
    await addDrafts(first, 5);
    await addDrafts(second, 2);
    await addDrafts(memberOnly, 1);
    // 旧プラン4の member（使わない役割）は数えない。owner 以外の行にはチームが要る（specs/008 data-model.md）
    const { teamId: legacyTeam } = await ensureTeam("legacy");
    await db()
      .update(memberships)
      .set({ role: "member", teamId: legacyTeam })
      .where(and(eq(memberships.accountId, memberOnly), eq(memberships.role, "owner")));
    const otherRes = await call(app, "POST", `/api/accounts/${other}/draft-batches`, {
      user: "u2",
      body: { clientRequestId: crypto.randomUUID(), text: "他人の投稿" },
    });
    expect(otherRes.status).toBe(201);

    const res = await call(app, "GET", endpoint, { user: "u1" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { counts: { accountId: string; needsReview: number }[] };
    expect(body.counts).toHaveLength(3);
    expect(Object.fromEntries(body.counts.map((row) => [row.accountId, row.needsReview]))).toEqual({
      [first]: 5,
      [second]: 2,
      [third]: 0,
    });
    for (const row of body.counts) {
      const own = await call(app, "GET", `/api/accounts/${row.accountId}/post-drafts/counts`, {
        user: "u1",
      });
      expect((await own.json()) as { needsReview: number }).toMatchObject({
        needsReview: row.needsReview,
      });
    }

    const stock = (await (
      await call(app, "GET", `/api/accounts/${first}/post-drafts`, { user: "u1" })
    ).json()) as {
      needsReview: { id: string; version: number }[];
    };
    const [approve, reject] = stock.needsReview;
    for (const [action, draft] of [
      ["approve", approve],
      ["reject", reject],
    ] as const) {
      const reviewed = await call(app, "POST", `/api/accounts/${first}/post-drafts/review`, {
        user: "u1",
        body: {
          requestId: crypto.randomUUID(),
          action,
          items: [{ id: draft!.id, expectedVersion: draft!.version }],
          ...(action === "reject" ? { reject: { reasons: ["tone"], note: "表現を見直す" } } : {}),
        },
      });
      expect(reviewed.status).toBe(200);
    }
    const afterReview = (await (await call(app, "GET", endpoint, { user: "u1" })).json()) as {
      counts: { accountId: string; needsReview: number }[];
    };
    expect(afterReview.counts.find((row) => row.accountId === first)?.needsReview).toBe(3);

    await addDrafts(third, 1);
    const afterRegistration = (await (await call(app, "GET", endpoint, { user: "u1" })).json()) as {
      counts: { accountId: string; needsReview: number }[];
    };
    expect(afterRegistration.counts.find((row) => row.accountId === third)?.needsReview).toBe(1);
    await db().delete(accounts).where(eq(accounts.id, second));
    const afterDeletion = (await (await call(app, "GET", endpoint, { user: "u1" })).json()) as {
      counts: { accountId: string; needsReview: number }[];
    };
    expect(afterDeletion.counts.map((row) => row.accountId).sort()).toEqual([first, third].sort());
  });
});

// ---- チーム運用：手伝っているAccountも数える（specs/008 /speckit-analyze O1）----
describe("GET /api/me/needs-review-counts（チーム運用）", () => {
  it("パートナー・担当の編集者には手伝っているAccountの件数も返り、関係のないAccountは返らない", async () => {
    const { accountId: helped } = await createUserWithAccount("o1");
    const { accountId: unrelated } = await createUserWithAccount("o2");
    const { teamId } = await makePartner(helped, "p1");
    await makeEditor(teamId, "e1", [helped]);
    for (const accountId of [helped, unrelated]) {
      const owner = accountId === helped ? "o1" : "o2";
      const res = await call(app, "POST", `/api/accounts/${accountId}/draft-batches`, {
        user: owner,
        body: { clientRequestId: crypto.randomUUID(), text: "案1\n@@@\n案2" },
      });
      expect(res.status).toBe(201);
    }
    for (const user of ["p1", "e1"]) {
      const body = (await (await call(app, "GET", endpoint, { user })).json()) as {
        counts: { accountId: string; needsReview: number }[];
      };
      expect(body.counts).toEqual([{ accountId: helped, needsReview: 2 }]);
    }
  });
});
