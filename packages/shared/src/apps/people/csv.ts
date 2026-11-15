// アンケートのCSVの読み方（specs/people/001-people-memo research.md R4、data-model.md 5）。
// ファイルはブラウザで読み、APIには見出しと行（文字列の表）だけを送る。上限の確かめは画面とAPIの両方で、この同じ関数を使う。
// 新しいnpmの依存は足さない（RFC 4180 の読み方を、ここに小さく書く）。

// 共通のパッケージは DOM の型を読まないので、ブラウザ・Node・Workers にある TextDecoder の形だけを書く
declare const TextDecoder: new (label: string, options?: { fatal?: boolean }) => { decode(input: Uint8Array): string };

/** ファイルの大きさの上限（画面で、読む前に確かめる）。 */
export const CSV_MAX_BYTES = 1_000_000;
/** 行の上限（見出しを除く）。 */
export const CSV_MAX_ROWS = 500;
/** 列の上限。 */
export const CSV_MAX_COLUMNS = 60;
/** 見出し（質問文）1列の文字の上限。 */
export const CSV_MAX_HEADER = 500;
/** 値1つの文字の上限。 */
export const CSV_MAX_CELL = 5000;

/** 文字にできなかった理由。zip：ZIPのまま上げた。unreadable：UTF-8でもShift_JISでも読めない。 */
export type CsvDecodeFailure = "zip" | "unreadable";

/**
 * ファイルのバイト列を文字にする。まず UTF-8 で読み（Googleのスプレッドシートの書き出し）、だめなら Shift_JIS（Excelで保存し直したもの）。
 * 先頭の印（U+FEFF）は外す。先頭が ZIP の印（PK\x03\x04）なら読まない（Googleフォームの「回答をダウンロード」はZIPになる）。
 * @param bytes - ファイルの中身
 * @returns 読めたら文字、読めなければ理由
 */
export function decodeCsvBytes(bytes: Uint8Array): { ok: true; text: string } | { ok: false; reason: CsvDecodeFailure } {
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return { ok: false, reason: "zip" };
  }
  for (const label of ["utf-8", "shift_jis"]) {
    try {
      const text = new TextDecoder(label, { fatal: true }).decode(bytes);
      return { ok: true, text: text.startsWith("﻿") ? text.slice(1) : text };
    } catch {
      // 次の文字コードを試す
    }
  }
  return { ok: false, reason: "unreadable" };
}

/** 読んだCSV。 */
export type ParsedCsv = {
  /** 1行目（質問文） */
  headers: string[];
  /** 2行目から（見出しの列の数にそろえたもの） */
  rows: string[][];
};

/**
 * CSVの文字を表にする（RFC 4180）。`"` で囲んだ値の中のカンマ・改行・`""` を扱う（自由記述の答えに改行が入るため）。
 * 改行は CRLF でも LF でもよい。値の前後の空白を外し、空の行は捨てる。最初の空でない行を見出しとし、
 * ほかの行は見出しの列の数にそろえる（足りない列は空、余る列は捨てる）。
 * @param text - CSVの文字
 * @returns 見出しと行（中身がなければ見出しも行も空）
 */
export function parseCsv(text: string): ParsedCsv {
  const records: string[][] = [];
  let record: string[] = [];
  let value = "";
  let quoted = false;
  let i = 0;
  const endValue = () => {
    record.push(value.trim());
    value = "";
  };
  const endRecord = () => {
    endValue();
    if (record.some((v) => v !== "")) records.push(record);
    record = [];
  };
  while (i < text.length) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          value += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        value += ch;
      }
      i++;
      continue;
    }
    if (ch === '"' && value.trim() === "") {
      // 囲みの前の空白は値に入れない
      value = "";
      quoted = true;
    } else if (ch === ",") {
      endValue();
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRecord();
    } else {
      value += ch;
    }
    i++;
  }
  if (value !== "" || record.length > 0) endRecord();
  const [headers = [], ...body] = records;
  return { headers, rows: body.map((r) => (r.length >= headers.length ? r.slice(0, headers.length) : [...r, ...Array<string>(headers.length - r.length).fill("")])) };
}

/** 上限を超えた理由（画面の文言とAPIの details に使う）。 */
export type CsvLimitViolation = "no_header" | "too_many_rows" | "too_many_columns" | "header_too_long" | "cell_too_long";

/**
 * 見出しと行が上限の中かを確かめる（data-model.md 5）。画面とAPIの両方で使う。
 * @param csv - 見出しと行
 * @returns 中なら ok、超えていれば最初に見つかった理由
 */
export function checkCsvLimits(csv: { headers: readonly string[]; rows: readonly (readonly string[])[] }): { ok: true } | { ok: false; reason: CsvLimitViolation } {
  if (csv.headers.length === 0 || csv.headers.every((h) => h.trim() === "")) return { ok: false, reason: "no_header" };
  if (csv.headers.length > CSV_MAX_COLUMNS) return { ok: false, reason: "too_many_columns" };
  if (csv.rows.length > CSV_MAX_ROWS) return { ok: false, reason: "too_many_rows" };
  if (csv.headers.some((h) => h.length > CSV_MAX_HEADER)) return { ok: false, reason: "header_too_long" };
  if (csv.rows.some((r) => r.length > CSV_MAX_COLUMNS)) return { ok: false, reason: "too_many_columns" };
  if (csv.rows.some((r) => r.some((v) => v.length > CSV_MAX_CELL))) return { ok: false, reason: "cell_too_long" };
  return { ok: true };
}
