// 誘いの文（specs/people/001-people-memo tasks.md T069、research.md R17）。
import { describe, expect, it } from "vitest";
import { buildInviteMessage, DEFAULT_INVITE_TEMPLATE, formatInviteDate } from "../../../src/apps/people";

describe("誘いの文", () => {
  it("初めの型は「{名前}さん、{日にち}の{会の名前}、もしご興味あれば一緒にいかがですか？」", () => {
    expect(DEFAULT_INVITE_TEMPLATE).toBe("{名前}さん、{日にち}の{会の名前}、もしご興味あれば一緒にいかがですか？");
  });

  it("名前・会の名前・日にちを差し込む。日にちは「12月13日（土）」の形", () => {
    expect(buildInviteMessage(DEFAULT_INVITE_TEMPLATE, { name: "たろう", eventName: "IT交流会 12月", heldOn: "2026-12-13" })).toBe(
      "たろうさん、12月13日（日）のIT交流会 12月、もしご興味あれば一緒にいかがですか？",
    );
    expect(formatInviteDate("2026-12-12")).toBe("12月12日（土）");
    expect(formatInviteDate("2027-01-01")).toBe("1月1日（金）");
  });

  it("同じ差し込みが2回あっても両方を差し込み、差し込みのない型はそのまま返す", () => {
    expect(buildInviteMessage("{名前}さん、{名前}さん", { name: "はなこ", eventName: "会", heldOn: "2026-12-13" })).toBe("はなこさん、はなこさん");
    expect(buildInviteMessage("参加リンク https://example.com", { name: "はなこ", eventName: "会", heldOn: "2026-12-13" })).toBe("参加リンク https://example.com");
  });

  it("空の型・null は初めの型を使う", () => {
    expect(buildInviteMessage(null, { name: "a", eventName: "b", heldOn: "2026-12-13" })).toBe(buildInviteMessage(DEFAULT_INVITE_TEMPLATE, { name: "a", eventName: "b", heldOn: "2026-12-13" }));
  });
});
