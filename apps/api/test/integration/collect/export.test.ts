// 書き出し（specs/collect/001-event-day-collection FR-046、research.md R13、tasks.md T055）。
import { beforeEach, describe, expect, it } from "vitest";
import { call, makeApp, resetDb } from "../../helpers/app";
import { createCollectEvent, grantCollect, type EventBody } from "../../helpers/collect";

const app = makeApp();
let event: EventBody;

beforeEach(async () => {
  await resetDb();
  await grantCollect(app, "o1");
  // 日本時間 2026-11-20 19:00 開始
  event = await createCollectEvent(app, "o1", { name: "IT交流会/渋谷", startsAt: "2026-11-20T10:00:00.000Z", endsAt: null });
});

describe("export.csv", () => {
  it("UTF-8（BOMつき）・CRLF・受付番号の順・列。ファイル名は集金_<開催日>_<イベント名>.csv", async () => {
    const add = async (body: object) =>
      ((await (await call(app, "POST", `/api/collect/events/${event.id}/roster`, { user: "o1", body: { media: "peatix", priceTierId: event.tiers[0]!.id, ...body } })).json()) as { person: { id: string } }).person.id;
    const a = await add({ name: "松本 れい", kana: "まつもと れい", memo: '紹介,"井上"さん' });
    await add({ name: "=来ない人", media: "minato" });
    const c = await add({ name: "木村" });
    await call(app, "PUT", `/api/collect/events/${event.id}/reception/${a}`, { user: "o1", body: { method: "cash", priceTierId: event.tiers[1]!.id, clientRequestId: crypto.randomUUID() } });
    await call(app, "PUT", `/api/collect/events/${event.id}/reception/${c}`, { user: "o1", body: { method: "transfer_later", clientRequestId: crypto.randomUUID() } });
    await call(app, "POST", `/api/collect/transfers/${c}/confirm`, { user: "o1" });

    const res = await call(app, "GET", `/api/collect/events/${event.id}/export.csv`, { user: "o1" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toBe(
      `attachment; filename="collect.csv"; filename*=UTF-8''${encodeURIComponent("集金_2026-11-20_IT交流会_渋谷.csv")}`,
    );
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes);
    const lines = text.split("\r\n");
    expect(lines[0]).toBe("受付番号,名前,ふりがな,媒体,料金の区分,来場,払い方,金額,受け取った人,記録した時刻,入金を確かめた日,メモ");
    expect(lines[1]).toMatch(/^1,松本 れい,まつもと れい,Peatix,早割,来場,現金,2500,主催者,\d{4}-\d{2}-\d{2} \d{2}:\d{2},,"紹介,""井上""さん"$/);
    // 式として読まれる頭の文字は ' を付ける
    expect(lines[2]).toBe("2,'=来ない人,,港,通常,,,,,,,");
    expect(lines[3]).toMatch(/^3,木村,,Peatix,通常,来場,振込（後日）,3000,主催者,[\d: -]+,\d{4}-\d{2}-\d{2},$/);
    expect(lines[4]).toBe("");
  });

  it("ほかの主催者・手伝う人は呼べない", async () => {
    await grantCollect(app, "o2");
    expect((await call(app, "GET", `/api/collect/events/${event.id}/export.csv`, { user: "o2" })).status).toBe(404);
    expect((await call(app, "GET", `/api/collect/events/${event.id}/export.csv`, { headers: { "X-Collect-Device": "cd_x" } })).status).toBe(401);
  });
});
