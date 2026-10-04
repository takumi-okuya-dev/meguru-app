import { describe, expect, it } from "vitest";
import { computeSimilarities } from "../src/similarity";

/** a と b の類似度（a を対象、b を相手にしたときの値。相手がいなければ undefined）。 */
function score(a: string, b: string): number | undefined {
  return computeSimilarities([{ id: "a", body: a }], [{ id: "b", body: b }]).get("a")?.score;
}

/** 決まった並びの日本語の本文を作る（乱数を使わず、テストを安定させる）。 */
function text(n: number, seed = 1): string {
  const chars = "朝の光が窓から差し込んで今日も一日が始まるあなたの小さな努力はきっと誰かに届いている焦らず自分のペースで進もう";
  let out = "";
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) % 2147483648;
    out += chars[x % chars.length];
  }
  return out;
}

/** 位置 i の文字を、元と違う文字に置き換える（記号は比べるときに除かれるので、ふつうの文字にする）。 */
function replaceAt(s: string, i: number): string {
  const c = s[i] === "猫" ? "犬" : "猫";
  return s.slice(0, i) + c + s.slice(i + 1);
}

describe("類似度（specs/004-review-approval FR-026、research.md R8、SC-003）", () => {
  it("同じ本文は100", () => {
    expect(score("今日は朝から雨が降っていて気分が沈む", "今日は朝から雨が降っていて気分が沈む")).toBe(100);
  });

  it.each([10, 20, 150])("%i文字の本文の1文字違い・2文字違い（離れた位置）は80以上", (n) => {
    const base = text(n);
    expect(score(replaceAt(base, Math.floor(n / 2)), base)).toBeGreaterThanOrEqual(80);
    expect(score(replaceAt(replaceAt(base, 1), n - 2), base)).toBeGreaterThanOrEqual(80);
  });

  it("2文の順番を入れ替えた本文は80以上", () => {
    const a = "朝の散歩を続けて三か月がたった。体より先に気持ちが軽くなった気がする。";
    const b = "体より先に気持ちが軽くなった気がする。朝の散歩を続けて三か月がたった。";
    expect(score(a, b)).toBeGreaterThanOrEqual(80);
  });

  it("空白・改行・句読点・絵文字だけが違う本文は100", () => {
    expect(score("今日は、朝から 雨が降っている😀", "今日は朝から\n雨が降っている！")).toBe(100);
  });

  it("正規化した後の長さが10文字未満の本文は比べない", () => {
    expect(score("短い投稿です", "短い投稿です")).toBeUndefined();
    expect(score("今日は朝から雨が降っていて", "短い投稿です")).toBe(0);
  });

  it("内容の違う2つの投稿は80未満", () => {
    const a = "朝の散歩を続けて三か月がたった。体より先に気持ちが軽くなった気がする。";
    const b = "仕事の段取りを前日の夜に決めておくと、次の朝の迷いがぐっと減る。";
    expect(score(a, b)).toBeLessThan(80);
  });

  it("自分自身とは比べない", () => {
    const body = "今日は朝から雨が降っていて気分が沈む";
    const r = computeSimilarities([{ id: "a", body }], [{ id: "a", body }]);
    expect(r.get("a")).toEqual({ score: 0, matches: [] });
  });

  it("似ている相手は高い順に最大3件", () => {
    const base = text(40);
    const others = [
      { id: "far", body: text(40, 99) },
      { id: "s1", body: replaceAt(base, 5) },
      { id: "s2", body: replaceAt(replaceAt(base, 5), 20) },
      { id: "s3", body: replaceAt(replaceAt(replaceAt(base, 5), 20), 30) },
      { id: "same", body: base },
    ];
    const r = computeSimilarities([{ id: "a", body: base }], others).get("a")!;
    expect(r.score).toBe(100);
    expect(r.matches.map((m) => m.id)).toEqual(["same", "s1", "s2"]);
  });

  it("長い本文（1,000文字）の1文字違いも80以上（編集距離を省き、Dice係数だけで判定する）", () => {
    const base = text(1000);
    expect(score(replaceAt(base, 500), base)).toBeGreaterThanOrEqual(80);
  });
});
