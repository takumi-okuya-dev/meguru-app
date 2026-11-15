// 主催者の既定値（specs/collect/001-event-day-collection contracts/api.md 7、FR-013、research.md R10、tasks.md T027）。
import { beforeEach, describe, expect, it } from "vitest";
import { call, makeApp, resetDb, testEnv } from "../../helpers/app";
import { errorOf, grantCollect } from "../../helpers/collect";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
  await grantCollect(app, "o1");
  await grantCollect(app, "o2");
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9]);

const putQr = (user: string, body: Uint8Array, type: string) =>
  app.request("/api/collect/settings/paypay-qr", { method: "PUT", headers: { Authorization: `Bearer test:${user}`, "Content-Type": type }, body }, testEnv);

describe("振込先の案内", () => {
  it("保存・読む・空で消す。300文字を超えたら 400", async () => {
    expect(await (await call(app, "GET", "/api/collect/settings", { user: "o1" })).json()).toEqual({ bankText: null, hasPaypayQr: false });
    const saved = await call(app, "PUT", "/api/collect/settings", { user: "o1", body: { bankText: "めぐる銀行 渋谷支店 普通 1234567 ヤマダタロウ" } });
    expect(await saved.json()).toEqual({ bankText: "めぐる銀行 渋谷支店 普通 1234567 ヤマダタロウ", hasPaypayQr: false });
    expect(await (await call(app, "GET", "/api/collect/me", { user: "o1" })).json()).toMatchObject({ hasBankText: true });
    expect(await (await call(app, "PUT", "/api/collect/settings", { user: "o1", body: { bankText: "" } })).json()).toEqual({ bankText: null, hasPaypayQr: false });
    expect(await errorOf(await call(app, "PUT", "/api/collect/settings", { user: "o1", body: { bankText: "あ".repeat(301) } }))).toEqual([400, "VALIDATION_FAILED"]);
  });
});

describe("PayPayのQRの画像", () => {
  it("PNG・JPEGを保存して、そのまま返す。消せる。ほかの主催者には見えない", async () => {
    expect((await putQr("o1", PNG, "image/png")).status).toBe(200);
    const got = await call(app, "GET", "/api/collect/settings/paypay-qr", { user: "o1" });
    expect(got.status).toBe(200);
    expect(got.headers.get("Content-Type")).toBe("image/png");
    expect(got.headers.get("Cache-Control")).toContain("private");
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(PNG);
    expect(await errorOf(await call(app, "GET", "/api/collect/settings/paypay-qr", { user: "o2" }))).toEqual([404, "ITEM_NOT_FOUND"]);

    expect((await putQr("o1", JPEG, "image/jpeg")).status).toBe(200);
    expect((await call(app, "GET", "/api/collect/settings/paypay-qr", { user: "o1" })).headers.get("Content-Type")).toBe("image/jpeg");
    expect(await (await call(app, "GET", "/api/collect/me", { user: "o1" })).json()).toMatchObject({ hasPaypayQr: true });

    expect(await (await call(app, "DELETE", "/api/collect/settings/paypay-qr", { user: "o1" })).json()).toEqual({ bankText: null, hasPaypayQr: false });
    expect((await call(app, "GET", "/api/collect/settings/paypay-qr", { user: "o1" })).status).toBe(404);
  });

  it("300KBを超えたら 413 IMAGE_TOO_LARGE、形式が違えば 400", async () => {
    const big = new Uint8Array(300 * 1024 + 1);
    big.set(PNG);
    expect(await errorOf(await putQr("o1", big, "image/png"))).toEqual([413, "IMAGE_TOO_LARGE"]);
    expect(await errorOf(await putQr("o1", PNG, "image/gif"))).toEqual([400, "VALIDATION_FAILED"]);
    expect(await errorOf(await putQr("o1", JPEG, "image/png"))).toEqual([400, "VALIDATION_FAILED"]);
    expect(await errorOf(await putQr("o1", new Uint8Array(), "image/png"))).toEqual([400, "VALIDATION_FAILED"]);
  });

  it("大きさを言わない本文（chunked）でも、300KBを超えたところで 413 にする", async () => {
    const chunk = new Uint8Array(64 * 1024);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 10) return controller.close();
        sent += 1;
        controller.enqueue(chunk);
      },
    });
    const res = await app.request(
      "/api/collect/settings/paypay-qr",
      { method: "PUT", headers: { Authorization: "Bearer test:o1", "Content-Type": "image/png" }, body, duplex: "half" } as RequestInit,
      testEnv,
    );
    expect(await errorOf(res)).toEqual([413, "IMAGE_TOO_LARGE"]);
    // 上限を超えたところでやめるので、全部は読まない
    expect(sent).toBeLessThan(10);
  });
});
