// 人物メモの答えの読み方・初めから用意した質問文・同意の決め方（specs/people/001-people-memo tasks.md T010〜T013、research.md R7・R8・R11）。
import { describe, expect, it } from "vitest";
import {
  CONSENT_CHOICE_PRESETS,
  consentFromChoices,
  jstDate,
  parseSubmittedAt,
  QUESTION_PRESETS,
  questionKey,
  resolveConsent,
  splitChoices,
  type ConsentFact,
} from "../../../src/apps/people";

describe("splitChoices", () => {
  it("カンマと空白・読点・全角のカンマのどれでも同じに分かれる", () => {
    const want = ["交流会・勉強会の案内", "転職・求人情報"];
    expect(splitChoices("交流会・勉強会の案内, 転職・求人情報")).toEqual(want);
    expect(splitChoices("交流会・勉強会の案内、転職・求人情報")).toEqual(want);
    expect(splitChoices("交流会・勉強会の案内，転職・求人情報")).toEqual(want);
  });
  it("空を捨てる。空白のないカンマでは分けない（その他の自由記述は1つの値）", () => {
    expect(splitChoices("")).toEqual([]);
    expect(splitChoices(null)).toEqual([]);
    expect(splitChoices("転職, , 起業,資金調達")).toEqual(["転職", "起業,資金調達"]);
  });
});

describe("parseSubmittedAt", () => {
  it("スラッシュとハイフンの形を日本時間として読む", () => {
    expect(parseSubmittedAt("2026/10/11 21:03:12")?.toISOString()).toBe("2026-10-11T12:03:12.000Z");
    expect(parseSubmittedAt("2026-10-11 21:03:12")?.toISOString()).toBe("2026-10-11T12:03:12.000Z");
    expect(parseSubmittedAt("2026/1/2 9:05")?.toISOString()).toBe("2026-01-02T00:05:00.000Z");
  });
  it("読めなければ null", () => {
    expect(parseSubmittedAt("10/11/2026 21:03:12")).toBeNull();
    expect(parseSubmittedAt("2026/02/30 10:00:00")).toBeNull();
    expect(parseSubmittedAt("")).toBeNull();
  });
});

describe("consentFromChoices", () => {
  const purposes = CONSENT_CHOICE_PRESETS;
  it("希望しないが1つでもあれば両方なし", () => {
    expect(consentFromChoices(["交流会・勉強会の案内", "個別の案内は希望しない"], purposes)).toEqual({ invite: false, work: false });
  });
  it("目的ごとに真", () => {
    expect(consentFromChoices(["交流会・勉強会の案内"], purposes)).toEqual({ invite: true, work: false });
    expect(consentFromChoices(["副業・業務委託案件"], purposes)).toEqual({ invite: false, work: true });
    expect(consentFromChoices(["交流会・勉強会の案内", "転職・求人情報"], purposes)).toEqual({ invite: true, work: true });
  });
  it("空・知らない選択肢はなし", () => {
    expect(consentFromChoices([], purposes)).toEqual({ invite: false, work: false });
    expect(consentFromChoices(["メルマガ"], purposes)).toEqual({ invite: false, work: false });
  });
});

describe("初めから用意した質問文と選択肢", () => {
  it("フォームの質問文が当たる", () => {
    expect(QUESTION_PRESETS.get(questionKey("タイムスタンプ"))).toBe("submitted_at");
    expect(QUESTION_PRESETS.get(questionKey("あなたのLINE名を教えて下さい"))).toBe("line_name");
    expect(QUESTION_PRESETS.get(questionKey("お名前（フルネーム・任意）"))).toBe("real_name");
    expect(QUESTION_PRESETS.get(questionKey("今後、情報や機会があれば個別に案内してよいか"))).toBe("contact_consent");
  });
  it("似ているだけの質問文は当てない", () => {
    expect(QUESTION_PRESETS.get(questionKey("LINE名"))).toBeUndefined();
  });
  it("同意の選択肢", () => {
    expect(CONSENT_CHOICE_PRESETS.get(questionKey("個別の案内は希望しない"))).toBe("decline");
    expect(CONSENT_CHOICE_PRESETS.get(questionKey("転職・求人情報"))).toBe("work");
  });
});

describe("resolveConsent（日付のいちばん新しい事実）", () => {
  const res = (on: string, invite: boolean, extra: Partial<{ submittedAt: Date | null; createdAt: Date; id: string }> = {}): ConsentFact => ({
    kind: "response",
    on,
    submittedAt: extra.submittedAt ?? null,
    createdAt: extra.createdAt ?? new Date("2026-12-01T00:00:00Z"),
    invite,
    work: false,
    responseId: extra.id ?? on,
  });
  const manual = (on: string, invite: boolean, changedAt = new Date(`${on}T03:00:00Z`)): ConsentFact => ({ kind: "manual", on, changedAt, invite, work: false });

  it("事実がなければなし", () => {
    expect(resolveConsent([])).toEqual({ invite: false, work: false, source: "none", basisOn: null, fact: null });
  });
  it("①10/11の回答（あり）→ 11/1に手直しでなし → 11/25の回答（あり）なら、あり・response", () => {
    const r = resolveConsent([res("2026-10-11", true), manual("2026-11-01", false), res("2026-11-25", true)]);
    expect([r.invite, r.source, r.basisOn]).toEqual([true, "response", "2026-11-25"]);
  });
  it("②11/25の回答のあとに10/11の回答を足しても11/25のまま", () => {
    const r = resolveConsent([res("2026-11-25", false), res("2026-10-11", true)]);
    expect([r.invite, r.basisOn]).toEqual([false, "2026-11-25"]);
  });
  it("③手直しが11/30なら11/25の回答より手直し。同じ日なら手直し", () => {
    expect(resolveConsent([res("2026-11-25", true), manual("2026-11-30", false)]).source).toBe("manual");
    expect(resolveConsent([res("2026-11-25", true), manual("2026-11-25", false)]).invite).toBe(false);
  });
  it("同じ日の回答は回答の時刻、手直しは直した時刻の新しい方", () => {
    const a = res("2026-11-25", true, { submittedAt: new Date("2026-11-25T12:00:00Z"), id: "a" });
    const b = res("2026-11-25", false, { submittedAt: new Date("2026-11-25T13:00:00Z"), id: "b" });
    expect(resolveConsent([b, a]).fact).toBe(b);
    const m1 = manual("2026-11-30", true, new Date("2026-11-30T01:00:00Z"));
    const m2 = manual("2026-11-30", false, new Date("2026-11-30T02:00:00Z"));
    expect(resolveConsent([m2, m1]).invite).toBe(false);
  });
});

describe("jstDate", () => {
  it("日本時間の日付", () => {
    expect(jstDate(new Date("2026-11-30T15:30:00Z"))).toBe("2026-12-01");
  });
});
