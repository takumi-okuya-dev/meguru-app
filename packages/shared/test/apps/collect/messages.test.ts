// 振込待ちの人への連絡文（specs/collect/001-event-day-collection FR-052、tasks.md T061）。
import { describe, expect, it } from "vitest";
import { buildTransferMessage } from "../../../src/apps/collect/messages";

describe("buildTransferMessage", () => {
  it("名前・イベント名・金額・受付番号を名義の前に付ける案内・振込先を含む", () => {
    const text = buildTransferMessage({ name: "山田 太郎", eventName: "IT交流会", amount: 3000, number: 12, kana: "やまだ たろう", bankText: "めぐる銀行 渋谷支店 普通 1234567" });
    expect(text).toContain("山田 太郎さん");
    expect(text).toContain("「IT交流会」");
    expect(text).toContain("3,000円");
    expect(text).toContain("振込の名義の前に受付番号「12」を付けてください（例：12ヤマダタロウ）");
    expect(text).toContain("めぐる銀行 渋谷支店 普通 1234567");
  });

  it("ふりがながなければ名義の例は「ヤマダタロウ」。振込先がなければ主催者に問い合わせる案内", () => {
    const text = buildTransferMessage({ name: "Alex", eventName: "勉強会", amount: 500, number: 3, kana: null, bankText: null });
    expect(text).toContain("（例：3ヤマダタロウ）");
    expect(text).toContain("振込先は主催者にお問い合わせください");
  });
});
