// 5分ごとの出来事の届けは、届ける用がない回はDBを起こさない（費用のため。docs/architecture.md「固定費0円から始める」）。
// 届けが終わるたびに「次に届ける用がある時刻」をKVに覚え、5分ごとの届けはその時刻まで飛ばす。書いたばかりの出来事を届けるときは、
// 先に「用がある」と印を付ける（途中で止まっても拾う）。日次の処理は印に関わらず届ける。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withTransaction } from "../../src/kernel/db/client";
import { deliverPendingEvents, emitEvent, eventsDue, registerConsumer, resetConsumers, retryDelayMs } from "../../src/platform/events/events";
import { resetDb, testEnv } from "../helpers/app";

const USER = "00000000-0000-4000-8000-000000000001";
const KEY = "platform-events:next-at";

beforeEach(async () => {
  await resetDb();
  resetConsumers();
  await testEnv.AUTOPOST_KV.delete(KEY);
});

afterEach(() => {
  resetConsumers();
});

const emitOne = () => withTransaction(testEnv.DATABASE_URL, (tx) => emitEvent(tx, "user.withdrawn", { userId: USER }));

describe("出来事の届けの印（KV）", () => {
  it("覚えていなければ、念のため届ける", async () => {
    expect(await eventsDue(testEnv.AUTOPOST_KV, new Date())).toBe(true);
  });

  it("届けるものがなければ none を覚え、5分ごとの届けは飛ばす", async () => {
    await deliverPendingEvents(testEnv, new Date());
    expect(await testEnv.AUTOPOST_KV.get(KEY)).toBe("none");
    expect(await eventsDue(testEnv.AUTOPOST_KV, new Date())).toBe(false);
  });

  it("書いたばかりの出来事を届けると、届いたあとは none", async () => {
    registerConsumer("threads", "user.withdrawn", async () => {});
    await deliverPendingEvents(testEnv, new Date());
    const id = await emitOne();
    await deliverPendingEvents(testEnv, new Date(), { eventIds: [id] });
    expect(await eventsDue(testEnv.AUTOPOST_KV, new Date())).toBe(false);
  });

  it("受け取りが失敗したら、やり直す時刻を覚え、その時刻から届ける", async () => {
    registerConsumer("threads", "user.withdrawn", async () => {
      throw new Error("失敗");
    });
    const id = await emitOne();
    // 出来事を書いた時刻より後で届ける（書いた時刻が「次に試す時刻」になるため）
    const now = new Date();
    await deliverPendingEvents(testEnv, now, { eventIds: [id] });
    const retryAt = now.getTime() + retryDelayMs(1);
    expect(await eventsDue(testEnv.AUTOPOST_KV, new Date(retryAt - 1000))).toBe(false);
    expect(await eventsDue(testEnv.AUTOPOST_KV, new Date(retryAt + 1000))).toBe(true);
  });

  it("書いたばかりの出来事の届けが途中で止まっても、印は「用がある」のまま（5分ごとの届けが拾う）", async () => {
    registerConsumer("threads", "user.withdrawn", async () => {});
    await deliverPendingEvents(testEnv, new Date());
    expect(await eventsDue(testEnv.AUTOPOST_KV, new Date())).toBe(false);
    const id = await emitOne();
    // DB につなげない設定で届けると、印を付けたあとで失敗する
    await expect(deliverPendingEvents({ ...testEnv, DATABASE_URL: "postgres://nobody@127.0.0.1:1/none" }, new Date(), { eventIds: [id] })).rejects.toThrow();
    expect(await eventsDue(testEnv.AUTOPOST_KV, new Date())).toBe(true);
  });
});
