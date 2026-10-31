// US4：アンインストール通知（research.md R7）
import { beforeEach, describe, expect, it } from "vitest";
import { accounts, threadsConnections, threadsRevocations } from "../../src/db/schema";
import { TEST_APP_SECRET } from "../env";
import { call, connectNew, db, fake, makeApp, resetDb, testEnv } from "../helpers/app";
import { makeSignedRequest } from "../helpers/signed-request";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
  await fake.reset();
  await fake.addUser("1001", "takumi");
});

async function postUninstall(payload: Record<string, unknown>, secret = TEST_APP_SECRET) {
  const sr = await makeSignedRequest(secret, payload);
  return call(app, "POST", "/api/threads/webhooks/uninstall", {
    body: new URLSearchParams({ signed_request: sr }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
}

describe("POST /api/threads/webhooks/uninstall", () => {
  it("Accountを needs_reconnect にし、接続行を消し、取り消しを記録する", async () => {
    await connectNew(app, "u1", "1001");
    const res = await postUninstall({ user_id: "1001", issued_at: Math.floor(Date.now() / 1000) + 1 });
    expect(res.status).toBe(200);
    const [a] = await db().select().from(accounts);
    expect(a!.connectionStatus).toBe("needs_reconnect");
    expect(await db().select().from(threadsConnections)).toHaveLength(0);
    expect(await db().select().from(threadsRevocations)).toHaveLength(1);
  });

  it("再接続より前の issued_at の通知は適用しない（遅れて届いた通知）", async () => {
    const issuedBefore = Math.floor(Date.now() / 1000) - 60;
    await connectNew(app, "u1", "1001");
    await postUninstall({ user_id: "1001", issued_at: issuedBefore });
    const [a] = await db().select().from(accounts);
    expect(a!.connectionStatus).toBe("connected");
    expect(await db().select().from(threadsConnections)).toHaveLength(1);
  });

  it("Accountがなくても取り消しを記録し、平文のIDは持たない", async () => {
    await postUninstall({ user_id: "5555", issued_at: Math.floor(Date.now() / 1000) });
    const rows = await db().select().from(threadsRevocations);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain("5555");
  });

  it("issued_at がなければトークンで確かめ、生きていれば接続を変えない", async () => {
    await connectNew(app, "u1", "1001");
    await postUninstall({ user_id: "1001" });
    expect((await db().select().from(accounts))[0]!.connectionStatus).toBe("connected");
  });

  it("issued_at がなく、トークンが無効なら needs_reconnect", async () => {
    await connectNew(app, "u1", "1001");
    await fake.invalidate("1001");
    await postUninstall({ user_id: "1001" });
    expect((await db().select().from(accounts))[0]!.connectionStatus).toBe("needs_reconnect");
  });

  it("署名が違えば 400", async () => {
    const res = await postUninstall({ user_id: "1001" }, "wrong-secret");
    expect(res.status).toBe(400);
  });

  it("トークンを貼る方法だけでシークレットがなければ、見本の鍵の署名でも 400 で、接続を変えない", async () => {
    await connectNew(app, "u1", "1001");
    const sr = await makeSignedRequest("xxxxxxxx", { user_id: "1001", issued_at: Math.floor(Date.now() / 1000) + 1 });
    for (const secret of [undefined, "xxxxxxxx"]) {
      const res = await call(app, "POST", "/api/threads/webhooks/uninstall", {
        body: new URLSearchParams({ signed_request: sr }),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        env: { ...testEnv, THREADS_CONNECT_METHODS: "token", THREADS_APP_SECRET: secret } as typeof testEnv,
      });
      expect(res.status).toBe(400);
    }
    expect((await db().select().from(accounts))[0]!.connectionStatus).toBe("connected");
    expect(await db().select().from(threadsRevocations)).toHaveLength(0);
  });
});
