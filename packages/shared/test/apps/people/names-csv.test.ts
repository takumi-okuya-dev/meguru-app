// 人物メモの名前の比べ方とCSVの読み方（specs/people/001-people-memo tasks.md T006・T008、research.md R4・R6・R9）。
import { describe, expect, it } from "vitest";
import {
  checkCsvLimits,
  CSV_MAX_CELL,
  CSV_MAX_COLUMNS,
  CSV_MAX_HEADER,
  CSV_MAX_ROWS,
  decodeCsvBytes,
  looseKey,
  nameKey,
  parseCsv,
  questionKey,
} from "../../../src/apps/people";

// 共通のパッケージは DOM の型を読まないので、TextEncoder の形だけを書く
declare const TextEncoder: new () => { encode(input: string): Uint8Array };

describe("nameKey", () => {
  it("全角と半角・カタカナとひらがな・空白・大文字をそろえる", () => {
    expect(nameKey("ﾀﾛｳ　ﾔﾏﾀﾞ")).toBe(nameKey("たろうやまだ"));
    expect(nameKey("Taro YAMADA")).toBe("taroyamada");
  });
  it("見えない文字と異体字セレクタを除く", () => {
    expect(nameKey("た​ろう")).toBe("たろう");
    expect(nameKey("葛\u{E0100}飾")).toBe("葛飾");
  });
  it("絵文字は残す", () => {
    expect(nameKey("たろう🌸")).not.toBe(nameKey("たろう🌻"));
  });
});

describe("looseKey", () => {
  it("絵文字・記号・句読点を除く", () => {
    expect(looseKey("たろう🌸")).toBe(looseKey("たろう🌻"));
    expect(looseKey("Taro.Y!")).toBe("taroy");
  });
  it("2文字未満は null", () => {
    expect(looseKey("🌸た🌸")).toBeNull();
    expect(looseKey("★★")).toBeNull();
  });
});

describe("questionKey", () => {
  it("前後の空白を外し、続く空白（全角を含む）を1つの半角空白に", () => {
    expect(questionKey("あなたのLINE名を教えて下さい ")).toBe(questionKey("あなたのLINE名を教えて下さい"));
    expect(questionKey("次回の　 交流会")).toBe("次回の 交流会");
  });
  it("似ている文でも別の鍵", () => {
    expect(questionKey("あなたのLINE名を教えて下さい")).not.toBe(questionKey("LINE名を教えてください"));
  });
  it("全角の英数字をそろえる", () => {
    expect(questionKey("ＬＩＮＥ名")).toBe("LINE名");
  });
});

describe("decodeCsvBytes", () => {
  const utf8 = (s: string) => new TextEncoder().encode(s);
  it("UTF-8 を読む", () => {
    expect(decodeCsvBytes(utf8("タイムスタンプ,LINE名\n"))).toEqual({ ok: true, text: "タイムスタンプ,LINE名\n" });
  });
  it("先頭の印を外す", () => {
    expect(decodeCsvBytes(utf8("﻿タイムスタンプ"))).toEqual({ ok: true, text: "タイムスタンプ" });
  });
  it("Shift_JIS で書いた見出しを読める", () => {
    // 「タイムスタンプ」の Shift_JIS
    const sjis = new Uint8Array([0x83, 0x5e, 0x83, 0x43, 0x83, 0x80, 0x83, 0x58, 0x83, 0x5e, 0x83, 0x93, 0x83, 0x76]);
    expect(decodeCsvBytes(sjis)).toEqual({ ok: true, text: "タイムスタンプ" });
  });
  it("ZIP は読まない", () => {
    expect(decodeCsvBytes(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]))).toEqual({ ok: false, reason: "zip" });
  });
  it("どちらでも読めなければ unreadable", () => {
    expect(decodeCsvBytes(new Uint8Array([0xff, 0xfe, 0xfd, 0x80, 0xa0, 0xff]))).toEqual({ ok: false, reason: "unreadable" });
  });
});

describe("parseCsv", () => {
  it("囲みの中のカンマ・改行・二重の引用符", () => {
    const csv = 'a,b,c\n"1,2","line1\nline2","say ""hi"""\n';
    expect(parseCsv(csv)).toEqual({ headers: ["a", "b", "c"], rows: [["1,2", "line1\nline2", 'say "hi"']] });
  });
  it("CRLF と LF・空の行を捨てる・前後の空白を外す", () => {
    expect(parseCsv("a,b\r\n 1 , 2 \r\n\r\n,\n3,4")).toEqual({ headers: ["a", "b"], rows: [["1", "2"], ["3", "4"]] });
  });
  it("足りない列は空、余る列は捨てる", () => {
    expect(parseCsv("a,b,c\n1\n1,2,3,4")).toEqual({ headers: ["a", "b", "c"], rows: [["1", "", ""], ["1", "2", "3"]] });
  });
  it("最後に改行がなくても読む", () => {
    expect(parseCsv("a\n1")).toEqual({ headers: ["a"], rows: [["1"]] });
  });
  it("空の文字は見出しも行も空", () => {
    expect(parseCsv("")).toEqual({ headers: [], rows: [] });
  });
});

describe("checkCsvLimits", () => {
  const headers = ["a", "b"];
  it("中なら ok", () => {
    expect(checkCsvLimits({ headers, rows: [["1", "2"]] })).toEqual({ ok: true });
  });
  it("見出しがない", () => {
    expect(checkCsvLimits({ headers: [], rows: [] })).toEqual({ ok: false, reason: "no_header" });
  });
  it("行・列・見出し・値の上限", () => {
    expect(checkCsvLimits({ headers, rows: Array.from({ length: CSV_MAX_ROWS + 1 }, () => ["1", "2"]) })).toEqual({ ok: false, reason: "too_many_rows" });
    expect(checkCsvLimits({ headers, rows: Array.from({ length: CSV_MAX_ROWS }, () => ["1", "2"]) })).toEqual({ ok: true });
    expect(checkCsvLimits({ headers: Array.from({ length: CSV_MAX_COLUMNS + 1 }, (_, i) => `q${i}`), rows: [] })).toEqual({ ok: false, reason: "too_many_columns" });
    expect(checkCsvLimits({ headers: ["x".repeat(CSV_MAX_HEADER + 1)], rows: [] })).toEqual({ ok: false, reason: "header_too_long" });
    expect(checkCsvLimits({ headers, rows: [["x".repeat(CSV_MAX_CELL + 1), ""]] })).toEqual({ ok: false, reason: "cell_too_long" });
  });
});
