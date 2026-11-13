// 取り込みのプレビューと書く処理（specs/people/001-people-memo contracts/api.md 3-1・3-2、research.md R5〜R11）。
// 状態を持たない2段階：プレビューは何も書かない。書く方は、作り手のロックの中で判定をやり直し、決めていない行があれば 409。
import {
  checkCsvLimits,
  nameKey,
  questionKey,
  type ConsentPurpose,
  type ImportColumn,
  type ImportField,
  type ImportPreview,
  type ImportResult,
} from "@meguru/shared/people";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../../../kernel/db/client";
import { withTransaction } from "../../../kernel/db/client";
import type { Env } from "../../../kernel/env";
import { AppError, itemNotFound } from "../../../kernel/errors";
import { logger } from "../../../kernel/logger";
import { loadOwnedEvent, lockOwner, type PeopleDb } from "../access";
import { derivePersons } from "../persons/person-derive";
import { peopleImports, peoplePersons, peopleResponses } from "../schema";
import { reportPeopleUsage } from "../usage";
import { classifyRows, toPreviewRow, type ParsedRow } from "./classify";
import { consentChoicesIn, mappingErrorsOf, rememberMappings, resolveChoicePurposes, resolveColumns } from "./mapping";

/** 取り込みの入力（プレビューと書く方で同じ）。 */
type ImportInput = {
  eventId: string;
  headers: string[];
  rows: string[][];
  columns?: (ImportField | null)[];
  consentChoices?: Record<string, ConsentPurpose>;
};

/**
 * 行・列・文字の上限を確かめる（data-model.md 5）。超えたら 400 IMPORT_TOO_LARGE（details にどの上限か）。
 * 列の対応の長さが見出しと違えば 400 VALIDATION_FAILED。
 * @param input - 取り込みの入力
 */
function checkInput(input: ImportInput): void {
  const limits = checkCsvLimits(input);
  if (!limits.ok) throw new AppError("IMPORT_TOO_LARGE", 400, "import too large", undefined, [limits.reason]);
  if (input.columns && input.columns.length !== input.headers.length) {
    throw new AppError("VALIDATION_FAILED", 400, "invalid request", undefined, ["columns"]);
  }
}

/** 判定に使う、列の対応・同意の選択肢・知らない選択肢。 */
type Prepared = { columns: ImportColumn[]; purposes: Map<string, ConsentPurpose>; choices: string[]; unknownChoices: string[] };

/**
 * 列の対応と同意の選択肢の対応を決め、知らない選択肢を出す。
 * @param db - データベース
 * @param userId - 作り手
 * @param input - 取り込みの入力
 * @returns 判定に使うもの
 */
async function prepare(db: PeopleDb, userId: string, input: ImportInput): Promise<Prepared> {
  const [columns, purposes] = await Promise.all([resolveColumns(db, userId, input.headers, input.columns), resolveChoicePurposes(db, userId, input.consentChoices)]);
  const choices = consentChoicesIn(columns, input.rows);
  const unknownChoices = choices.filter((c) => !purposes.has(questionKey(c)));
  return { columns, purposes, choices, unknownChoices };
}

/**
 * プレビュー（何も書かない）。
 * @param db - データベース
 * @param userId - 作り手
 * @param input - 取り込みの入力
 * @returns 列の対応・誤り・知らない選択肢・行ごとの判定・数
 */
export async function previewImport(db: Db, userId: string, input: ImportInput): Promise<ImportPreview> {
  checkInput(input);
  await loadOwnedEvent(db, userId, input.eventId);
  const prep = await prepare(db, userId, input);
  const mappingErrors = mappingErrorsOf(prep.columns);
  const base = { columns: prep.columns, mappingErrors, unknownConsentChoices: prep.unknownChoices };
  if (mappingErrors.length > 0) {
    return { ...base, summary: { newCount: 0, candidateCount: 0, duplicateInFileCount: 0, skippedCount: 0 }, rows: [] };
  }
  const classified = await classifyRows(db, userId, input.eventId, prep.columns, input.rows, prep.purposes);
  return { ...base, summary: classified.summary, rows: classified.rows.map(toPreviewRow) };
}

/** 取り込める（判定が取り込みの対象の）行の状態。 */
const IMPORTABLE = new Set(["new", "candidate", "duplicate_in_file"]);

/**
 * 取り込む（書く）。
 * @param env - Workers のバインディング
 * @param db - データベース（利用の数を伝える）
 * @param userId - 作り手
 * @param input - 取り込みの入力と行ごとの決め
 * @returns 取り込みの数
 */
export async function commitImport(
  env: Env,
  db: Db,
  userId: string,
  input: ImportInput & { columns: (ImportField | null)[]; decisions: { row: number; action: "new" | "link" | "skip"; personId?: string }[] },
): Promise<ImportResult> {
  checkInput(input);
  const decisions = new Map<number, { action: "new" | "link" | "skip"; personId?: string }>();
  for (const d of input.decisions) {
    if (d.row >= input.rows.length || decisions.has(d.row)) throw new AppError("VALIDATION_FAILED", 400, "invalid request", undefined, ["decisions"]);
    decisions.set(d.row, d);
  }
  // 1つの取り込みで、2つの行を同じ人につながない（R9）
  const linked = input.decisions.filter((d) => d.action === "link").map((d) => d.personId!);
  if (new Set(linked).size !== linked.length) throw new AppError("VALIDATION_FAILED", 400, "invalid request", undefined, ["decisions"]);

  const result = await withTransaction(env.DATABASE_URL, async (tx) => {
    await lockOwner(tx, userId);
    await loadOwnedEvent(tx, userId, input.eventId);
    const prep = await prepare(tx, userId, input);
    // LINE名の列がない → ["line_name"]、同じ項目に2列 → その項目、項目のない列がある → ["columns"]
    const details: string[] = mappingErrorsOf(prep.columns).map((e) => e.field ?? "line_name");
    if (prep.columns.some((c) => c.field === null)) details.push("columns");
    if (details.length > 0) throw new AppError("IMPORT_MAPPING_INVALID", 400, "import mapping invalid", undefined, [...new Set(details)]);
    const classified = await classifyRows(tx, userId, input.eventId, prep.columns, input.rows, prep.purposes);
    // 決めていない候補・重なりの行、対応のない同意の選択肢があれば、何も書かない（R5）
    const undecided = classified.rows.filter((p) => (p.status === "candidate" || p.status === "duplicate_in_file") && !decisions.has(p.row)).map((p) => p.row);
    if (undecided.length > 0 || prep.unknownChoices.length > 0) {
      throw new AppError("IMPORT_DECISIONS_REQUIRED", 409, "import decisions required", undefined, undefined, {
        rows: undecided,
        consentChoices: prep.unknownChoices,
      });
    }
    // つなぐ先は、その作り手の人だけ
    if (linked.length > 0) {
      const owned = await tx
        .select({ id: peoplePersons.id })
        .from(peoplePersons)
        .where(and(eq(peoplePersons.userId, userId), inArray(peoplePersons.id, linked)));
      if (owned.length !== new Set(linked).size) throw itemNotFound();
    }

    const targets = classified.rows.filter((p) => IMPORTABLE.has(p.status) && decisions.get(p.row)?.action !== "skip");
    const [imp] = await tx.insert(peopleImports).values({ userId, eventId: input.eventId, rowCount: input.rows.length }).returning({ id: peopleImports.id });
    const importId = imp!.id;
    await rememberMappings(tx, userId, prep.columns, prep.choices, prep.purposes);

    // 新しい人をまとめて作る
    const fresh = targets.filter((p) => decisions.get(p.row)?.action !== "link");
    const created = fresh.length
      ? await tx
          .insert(peoplePersons)
          .values(
            fresh.map((p) => ({
              userId,
              realName: p.realName,
              realNameKey: p.realName ? nameKey(p.realName) : null,
              lineName: p.lineName,
              lineNameKey: p.lineNameKey,
              createdByImportId: importId,
            })),
          )
          .returning({ id: peoplePersons.id })
      : [];
    const personOf = new Map<number, string>();
    fresh.forEach((p, i) => personOf.set(p.row, created[i]!.id));
    for (const p of targets) {
      const d = decisions.get(p.row);
      if (d?.action === "link") personOf.set(p.row, d.personId!);
    }

    const inserted = targets.length
      ? await tx
          .insert(peopleResponses)
          .values(targets.map((p) => responseValues(p, userId, input.eventId, importId, personOf.get(p.row)!)))
          .onConflictDoNothing({ target: [peopleResponses.eventId, peopleResponses.dedupeHash] })
          .returning({ personId: peopleResponses.personId })
      : [];
    // 同じ行が2つあって片方しか入らなかったときは、回答のない新しい人を残さない
    const withResponse = new Set(inserted.map((r) => r.personId));
    const orphans = created.map((c) => c.id).filter((id) => !withResponse.has(id));
    if (orphans.length > 0) await tx.delete(peoplePersons).where(inArray(peoplePersons.id, orphans));
    const createdPeopleCount = created.length - orphans.length;
    const counts = {
      rowCount: input.rows.length,
      importedCount: inserted.length,
      createdPeopleCount,
      linkedCount: inserted.length - createdPeopleCount,
      skippedCount: input.rows.length - inserted.length,
    };
    await tx
      .update(peopleImports)
      .set({ importedCount: counts.importedCount, createdPeopleCount: counts.createdPeopleCount, linkedCount: counts.linkedCount, skippedCount: counts.skippedCount })
      .where(eq(peopleImports.id, importId));
    await derivePersons(tx, userId, [...withResponse]);
    return { import: { id: importId, ...counts } };
  });
  // ログには番号と数だけ（名前・答えを出さない。R18）
  logger.info("people import committed", { importId: result.import.id, rows: result.import.rowCount, imported: result.import.importedCount });
  await reportPeopleUsage(db, userId);
  return result;
}

/**
 * 回答の行の値。
 * @param p - 判定した行
 * @param userId - 作り手
 * @param eventId - イベント
 * @param importId - 取り込み
 * @param personId - 人
 * @returns 回答の行
 */
function responseValues(p: ParsedRow, userId: string, eventId: string, importId: string, personId: string): typeof peopleResponses.$inferInsert {
  return {
    userId,
    eventId,
    importId,
    personId,
    dedupeHash: p.dedupeHash,
    submittedAt: p.submittedAt,
    lineName: p.lineName,
    lineNameKey: p.lineNameKey,
    realName: p.realName,
    realNameKey: p.realName ? nameKey(p.realName) : null,
    nextAttendance: p.nextAttendance,
    bringFriends: p.bringFriends,
    wantedConnections: p.wantedConnections,
    careerInterests: p.careerInterests,
    consentChoices: p.consentChoices,
    consentInvite: p.consent.invite,
    consentWork: p.consent.work,
    answers: p.answers,
  };
}
