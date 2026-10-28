import { describe, expect, it } from "vitest";
import {
  POST_EXPORT_HEADER,
  SNAPSHOT_EXPORT_HEADER,
  csvFileName,
  formatJstIso,
  hourJst,
  postExportCells,
  snapshotExportCells,
  toCsv,
  weekdayJst,
} from "../src/csv";
import type { PostExportRow, SnapshotExportRow } from "../src/schemas";

const row: PostExportRow = {
  id: "d1",
  publishedAt: "2026-09-25T10:01:00.000Z",
  body: "1行目, \"引用\"\n2行目🙌",
  metrics: { views: 167, likes: 5, replies: 0, reposts: 0, quotes: 0, shares: null },
  ratio: 167 / 49.5,
  state: "confirmed",
  judgment: "good",
  permalink: "https://www.threads.com/@x/post/1",
  lastFetchedAt: "2026-10-02T10:01:00.000Z",
  lastElapsedMinutes: 10_079,
  followersAtPost: 321,
  h24: { views: 120, likes: 3, replies: 0, reposts: 0, quotes: 0, shares: 0 },
  batchId: "b1",
  batchPosition: 0,
  batchCreatedAt: "2026-09-20T00:00:00.000Z",
  approvedAt: "2026-09-21T00:00:00.000Z",
  prioritized: false,
  carryover: true,
  bodyEdited: null,
  slotMinute: 19 * 60,
  strategyUpdatedAt: "2026-09-01T00:00:00.000Z",
  promotionsChangedAt: null,
  researchChangedAt: null,
  coreRulesChangedAt: null,
};

describe("CSVの整形（specs/006 contracts/csv.md、FR-029・FR-030）", () => {
  it("先頭にBOM、改行はCRLF、すべての値を引用し、引用符は2つにする", () => {
    const csv = toCsv(["a", "b"], [["x,y", 'say "hi"'], [null, 3]]);
    expect(csv).toBe('﻿"a","b"\r\n"x,y","say ""hi"""\r\n"","3"\r\n');
  });

  it("本文の改行・カンマ・引用符は1つのセルに入る", () => {
    const csv = toCsv(["本文"], [[row.body]]);
    expect(csv).toBe('﻿"本文"\r\n"1行目, ""引用""\n2行目🙌"\r\n');
  });

  // 表計算ソフトは、囲みの引用符を外した後の先頭文字で数式かどうかを決める。
  // 引用は「セルの区切り」を伝える制御で、「評価するな」を伝える制御ではない（セキュリティ監査 run-1）。
  // 本文は content の権限だけで書けるので、オーナーが開くファイルの中身を他人が決められる
  it.each(["=", "+", "-", "@", "\t", "\r"])("先頭が %j のセルは、数式として評価されない形にする", (lead) => {
    const csv = toCsv(["本文"], [[`${lead}HYPERLINK("https://example.invalid")`]]);
    // 先頭にシングルクォートを足す。引用符の二重化はそのまま
    expect(csv).toContain(`"'${lead}HYPERLINK(""https://example.invalid"")"`);
  });

  it("先頭が数式の記号でなければ、何も足さない", () => {
    expect(toCsv(["本文"], [["ふつうの本文"]])).toBe('\uFEFF"本文"\r\n"ふつうの本文"\r\n');
    // 途中の = は数式にならないので触らない
    expect(toCsv(["本文"], [["a=b"]])).toContain('"a=b"');
    // 数値も触らない（-3 は数式ではなく負の数として読まれる…が、先頭が - なので安全側に倒す）
    expect(toCsv(["n"], [[3]])).toContain('"3"');
  });

  it("日時は日本時間でタイムゾーン付き、曜日と時も日本時間", () => {
    expect(formatJstIso("2026-09-25T10:01:00.000Z")).toBe("2026-09-25T19:01:00+09:00");
    expect(formatJstIso(null)).toBe("");
    expect(weekdayJst("2026-09-25T10:01:00.000Z")).toBe("金");
    expect(hourJst("2026-09-25T16:30:00.000Z")).toBe(1);
  });

  it("投稿ごとは37列、取り込みごとは13列", () => {
    expect(POST_EXPORT_HEADER).toHaveLength(37);
    expect(SNAPSHOT_EXPORT_HEADER).toHaveLength(13);
    expect(POST_EXPORT_HEADER.slice(0, 6)).toEqual(["投稿ID", "投稿した日時", "曜日", "時", "本文", "文字数"]);
  });

  it("投稿ごとの1行", () => {
    const cells = postExportCells(row);
    expect(cells).toHaveLength(37);
    expect(cells.slice(0, 18)).toEqual([
      "d1",
      "2026-09-25T19:01:00+09:00",
      "金",
      19,
      row.body,
      [...row.body].length,
      167,
      5,
      0,
      0,
      0,
      null,
      "3.374",
      "好調",
      "https://www.threads.com/@x/post/1",
      "2026-10-02T19:01:00+09:00",
      167,
      "確定",
    ]);
    expect(cells.slice(18)).toEqual([
      321,
      120,
      3,
      0,
      0,
      0,
      0,
      "b1",
      1,
      "2026-09-20T09:00:00+09:00",
      "2026-09-21T09:00:00+09:00",
      "いいえ",
      "はい",
      "不明",
      "19:00",
      "2026-09-01T09:00:00+09:00",
      "",
      "",
      "",
    ]);
  });

  it("確定待ち・計測できません・判定なしの判定の列と、空欄", () => {
    const pending = postExportCells({ ...row, state: "pending", metrics: null, ratio: null, judgment: null, lastElapsedMinutes: null, lastFetchedAt: null, h24: null });
    expect(pending[13]).toBe("確定待ち");
    expect(pending.slice(6, 13)).toEqual([null, null, null, null, null, null, null]);
    expect(pending[17]).toBe("");
    expect(postExportCells({ ...row, state: "unmeasurable", metrics: null, ratio: null, judgment: null })[13]).toBe("計測できません");
    expect(postExportCells({ ...row, judgment: null, ratio: null })[13]).toBe("判定なし");
    expect(postExportCells({ ...row, state: "updating", judgment: null, ratio: null })[17]).toBe("更新中");
    expect(postExportCells({ ...row, state: "late_confirmed" })[17]).toBe("遅れて確定");
  });

  it("取り込みごとの1行", () => {
    const s: SnapshotExportRow = {
      id: "d1",
      publishedAt: "2026-09-25T10:01:00.000Z",
      fetchedAt: "2026-09-26T10:05:00.000Z",
      elapsedMinutes: 1444,
      kind: "h24",
      method: "slot",
      metrics: { views: 120, likes: 3, replies: 0, reposts: 0, quotes: 0, shares: null },
      followersOnDay: 300,
    };
    expect(snapshotExportCells(s)).toEqual([
      "d1",
      "2026-09-25T19:01:00+09:00",
      "2026-09-26T19:05:00+09:00",
      24,
      "24時間時点",
      "時刻の処理",
      120,
      3,
      0,
      0,
      0,
      null,
      300,
    ]);
  });

  it("ファイル名にユーザー名と書き出した日（日本時間）", () => {
    expect(csvFileName("takumi", "posts", new Date("2026-10-08T16:00:00Z"))).toBe("threads-takumi-posts-20261009.csv");
    expect(csvFileName("takumi", "snapshots", new Date("2026-10-08T14:00:00Z"))).toBe("threads-takumi-snapshots-20261008.csv");
  });
});
