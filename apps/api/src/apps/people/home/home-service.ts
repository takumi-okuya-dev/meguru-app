// ホーム：今日やること・過ぎたもの・近い誕生日（specs/people/002-sales-list plan.md 3、FR-104・FR-105）。
import { BIRTHDAY_WINDOW_DAYS, jstDate, type HomeItem, type PeopleHome } from "@meguru/shared/people";
import { sql } from "drizzle-orm";
import type { Db } from "../../../kernel/db/client";
import { NO_FILTER, queryPersons } from "../persons/person-list";

/** ホームに出す人数の上限（それぞれ）。 */
const HOME_LIMIT = 200;

/**
 * 今日から誕生日（MM-DD）まで、あと何日か（年をまたぐ。2月29日は、うるう年でない年は3月1日として数える）。
 * @param today - 今日（YYYY-MM-DD）
 * @param md - 誕生日の月日
 * @returns 日数
 */
export function daysUntilBirthday(today: string, md: string): number {
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const [bm, bd] = md.split("-").map(Number) as [number, number];
  const base = Date.UTC(y, m - 1, d);
  let next = Date.UTC(y, bm - 1, bd);
  if (next < base) next = Date.UTC(y + 1, bm - 1, bd);
  return Math.round((next - base) / 86_400_000);
}

/**
 * 今日から7日（今日を含む）の月日。うるう年でない年は、3月1日の日に2月29日の人も入れる（daysUntilBirthday と同じ数え方）。
 * @param today - 今日（YYYY-MM-DD）
 * @returns 月日（MM-DD）
 */
export function windowMonthDays(today: string): string[] {
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const out: string[] = [];
  for (let i = 0; i < BIRTHDAY_WINDOW_DAYS; i++) {
    const t = new Date(Date.UTC(y, m - 1, d + i));
    const md = `${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
    out.push(md);
    const year = t.getUTCFullYear();
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    if (md === "03-01" && !leap) out.push("02-29");
  }
  return out;
}

/**
 * ホームの3つの並び。
 * @param db - データベース
 * @param userId - 作り手
 * @param now - 今の時刻
 * @returns 今日やること・過ぎたもの（日付の順）・近い誕生日（近い順）
 */
export async function getHome(db: Db, userId: string, now = new Date()): Promise<PeopleHome> {
  const today = jstDate(now);
  const [todayRows, overdueRows, birthdayRows] = await Promise.all([
    queryPersons(db, userId, NO_FILTER, [sql`p.next_action_on = ${today}::date`], { limit: HOME_LIMIT, offset: 0, orderBy: sql`name_key, id` }),
    queryPersons(db, userId, NO_FILTER, [sql`p.next_action_on < ${today}::date`], { limit: HOME_LIMIT, offset: 0, orderBy: sql`next_action_on, name_key, id` }),
    // 誕生日は、今日から7日の月日だけを SQL で選ぶ（人の数によらず漏れない）
    queryPersons(db, userId, NO_FILTER, [sql`p.birthday_md IN (${sql.join(windowMonthDays(today).map((md) => sql`${md}`), sql`, `)})`], {
      limit: HOME_LIMIT,
      offset: 0,
      orderBy: sql`name_key, id`,
    }),
  ]);
  const birthdays: HomeItem[] = birthdayRows.persons
    .map((p) => ({ p, days: daysUntilBirthday(today, p.birthdayMd!) }))
    .filter((x) => x.days < BIRTHDAY_WINDOW_DAYS)
    .sort((a, b) => a.days - b.days)
    .map((x) => x.p);
  return { today: todayRows.persons, overdue: overdueRows.persons, birthdays };
}
