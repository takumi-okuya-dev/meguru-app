// 受付用リンクのトークンの鍵の入れ替え（specs/collect/001-event-day-collection research.md R7。集金管理の入口の tokenKeys）。
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/app";
import { rotateTokenKeys } from "../../../src/jobs/key-rotation";
import { call, fakeVerifier, makeApp, resetDb, testEnv } from "../../helpers/app";
import { createCollectEvent, grantCollect } from "../../helpers/collect";

const app = makeApp();
const KEY2 = btoa(String.fromCharCode(...new Uint8Array(32).fill(42)));

beforeEach(async () => {
  await resetDb();
});

describe("受付用リンクの鍵の入れ替え", () => {
  it("使えるリンクの暗号化した写しを入れ替え、旧鍵を外しても同じリンクを表示できる。止めたリンクは入れ替えない", async () => {
    await grantCollect(app, "o1");
    const stoppedEvent = await createCollectEvent(app, "o1");
    await call(app, "POST", `/api/collect/events/${stoppedEvent.id}/link`, { user: "o1" });
    await call(app, "POST", `/api/collect/events/${stoppedEvent.id}/link/stop`, { user: "o1" });
    const event = await createCollectEvent(app, "o1");
    const before = ((await (await call(app, "POST", `/api/collect/events/${event.id}/link`, { user: "o1" })).json()) as { link: { url: string } }).link.url;
    const ring = { ...JSON.parse(testEnv.TOKEN_ENCRYPTION_KEYS), "2": KEY2 };
    const env = { ...testEnv, TOKEN_ENCRYPTION_KEYS: JSON.stringify(ring), TOKEN_ENCRYPTION_KEY_VERSION: "2" };
    expect(await rotateTokenKeys(env)).toEqual({ rotated: 1, skipped: 0, remainingOldVersionRows: 0 });
    const onlyNew = createApp({ verifyAuth: () => fakeVerifier });
    const newEnv = { ...testEnv, TOKEN_ENCRYPTION_KEYS: JSON.stringify({ "2": KEY2 }), TOKEN_ENCRYPTION_KEY_VERSION: "2" };
    const res = await onlyNew.request(`/api/collect/events/${event.id}/link`, { headers: { Authorization: "Bearer test:o1" } }, newEnv);
    expect(((await res.json()) as { link: { url: string } }).link.url).toBe(before);
  });
});
