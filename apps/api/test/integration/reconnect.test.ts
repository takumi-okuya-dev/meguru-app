// US4：再接続（FR-013・FR-020）
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { accounts, threadsConnections } from "../../src/db/schema";
import { authorizeAndCallback, call, connectNew, db, fake, makeApp, redirectTarget, resetDb } from "../helpers/app";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
  await fake.reset();
  await fake.addUser("1001", "takumi");
  await fake.addUser("1002", "other");
});

async function startReconnect(user: string, accountId: string) {
  const res = await call(app, "POST", "/api/threads/connect", { user, body: { mode: "reconnect", accountId } });
  return res;
}

describe("mode = reconnect", () => {
  it("connected のAccountでも、上限に達していても認可し直せ、Accountは増えない", async () => {
    await connectNew(app, "u1", "1001");
    const [a] = await db().select().from(accounts);
    const res = await startReconnect("u1", a!.id);
    expect(res.status).toBe(200);
    const { authorizeUrl } = (await res.json()) as { authorizeUrl: string };
    const cb = await authorizeAndCallback(app, authorizeUrl, { fakeUser: "1001" });
    const target = redirectTarget(cb);
    expect(target.pathname).toBe(`/accounts/${a!.id}/settings`);
    expect(target.searchParams.get("connected")).toBe("reconnect");
    const all = await db().select().from(accounts);
    expect(all).toHaveLength(1);
    expect(all[0]!.connectionGeneration).toBe(a!.connectionGeneration + 1);
  });

  it("needs_reconnect のAccountは、同じThreadsアカウントで認可し直すと connected に戻る", async () => {
    await connectNew(app, "u1", "1001");
    const [a] = await db().select().from(accounts);
    await db().update(accounts).set({ connectionStatus: "needs_reconnect" }).where(eq(accounts.id, a!.id));
    const { authorizeUrl } = (await (await startReconnect("u1", a!.id)).json()) as { authorizeUrl: string };
    await authorizeAndCallback(app, authorizeUrl, { fakeUser: "1001" });
    const [after] = await db().select().from(accounts);
    expect(after!.connectionStatus).toBe("connected");
  });

  it("別のThreadsアカウントで認可すると RECONNECT_ACCOUNT_MISMATCH で、接続は変わらない", async () => {
    await connectNew(app, "u1", "1001");
    const [a] = await db().select().from(accounts);
    const [connBefore] = await db().select().from(threadsConnections);
    const { authorizeUrl } = (await (await startReconnect("u1", a!.id)).json()) as { authorizeUrl: string };
    const cb = await authorizeAndCallback(app, authorizeUrl, { fakeUser: "1002" });
    const target = redirectTarget(cb);
    expect(target.pathname).toBe(`/accounts/${a!.id}/settings`);
    expect(target.searchParams.get("error")).toBe("RECONNECT_ACCOUNT_MISMATCH");
    const [connAfter] = await db().select().from(threadsConnections);
    expect(Buffer.from(connAfter!.accessTokenCiphertext).equals(Buffer.from(connBefore!.accessTokenCiphertext))).toBe(true);
    expect(await db().select().from(accounts)).toHaveLength(1);
  });

  it("他人のAccountは 404", async () => {
    await connectNew(app, "u1", "1001");
    const [a] = await db().select().from(accounts);
    expect((await startReconnect("intruder", a!.id)).status).toBe(404);
  });
});
