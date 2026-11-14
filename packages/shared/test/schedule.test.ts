import { describe, expect, it } from "vitest";
import {
  addDays,
  findDueSlot,
  isLateNightSlot,
  jstDateOf,
  jstMidnight,
  minutesToTime,
  plannedSlotTime,
  projectSchedule,
  timeToMinutes,
  validatePostingSchedule,
} from "../src/schedule";

/** 日本時間の日時（"2026-10-06 12:00"）を Date にする。 */
const jst = (s: string) => new Date(`${s.replace(" ", "T")}:00+09:00`);
const ACCOUNT = "11111111-1111-4111-8111-111111111111";

describe("時刻の変換（specs/005-auto-post research.md R1）", () => {
  it("HH:MM と分を相互に変換する", () => {
    expect(timeToMinutes("07:30")).toBe(450);
    expect(timeToMinutes("00:00")).toBe(0);
    expect(timeToMinutes("23:59")).toBe(1439);
    expect(minutesToTime(450)).toBe("07:30");
    expect(minutesToTime(0)).toBe("00:00");
  });

  it("形の誤った時刻は null", () => {
    for (const t of ["24:00", "7:30", "07:60", "", "07:30:00", "ab:cd"]) expect(timeToMinutes(t)).toBeNull();
  });
});

describe("投稿の設定の検証（FR-001・FR-001a・FR-002）", () => {
  const base = { enabled: true, jitter: true };

  it("正しい設定なら、分の昇順を返す", () => {
    expect(validatePostingSchedule({ ...base, slotTimes: ["21:00", "07:30", "12:00"] })).toEqual({
      ok: true,
      slotMinutes: [450, 720, 1260],
    });
  });

  it("11件は too_many", () => {
    const slotTimes = Array.from({ length: 11 }, (_, i) => minutesToTime(i * 60));
    expect(validatePostingSchedule({ ...base, slotTimes })).toMatchObject({ ok: false, reason: "too_many" });
  });

  it("上限は maxSlots で決める（オーナーの1日の投稿数の上限。specs/024 FR-019）", () => {
    const slotTimes = Array.from({ length: 5 }, (_, i) => minutesToTime(i * 60));
    expect(validatePostingSchedule({ ...base, slotTimes }, { maxSlots: 4 })).toMatchObject({ ok: false, reason: "too_many" });
    expect(validatePostingSchedule({ ...base, slotTimes }, { maxSlots: 5 })).toMatchObject({ ok: true });
    const many = Array.from({ length: 12 }, (_, i) => minutesToTime(i * 60));
    expect(validatePostingSchedule({ ...base, slotTimes: many }, { maxSlots: 250 })).toMatchObject({ ok: true });
  });

  it("同じ時刻は duplicate", () => {
    expect(validatePostingSchedule({ ...base, slotTimes: ["07:30", "07:30"] })).toMatchObject({
      ok: false,
      reason: "duplicate",
      times: ["07:30"],
    });
  });

  it("オンで時刻が0件なら required。オフなら0件でよい", () => {
    expect(validatePostingSchedule({ ...base, slotTimes: [] })).toMatchObject({ ok: false, reason: "required" });
    expect(validatePostingSchedule({ enabled: false, jitter: true, slotTimes: [] })).toEqual({ ok: true, slotMinutes: [] });
  });

  it("ずらすときは、隣り合う時刻の間が30分未満なら too_close。ずらさなければ通る", () => {
    expect(validatePostingSchedule({ ...base, slotTimes: ["07:00", "07:29"] })).toMatchObject({
      ok: false,
      reason: "too_close",
      times: ["07:00", "07:29"],
    });
    expect(validatePostingSchedule({ ...base, slotTimes: ["07:00", "07:30"] }).ok).toBe(true);
    expect(validatePostingSchedule({ ...base, jitter: false, slotTimes: ["07:00", "07:29"] }).ok).toBe(true);
  });

  it("日付をまたぐ間（23:50 と 0:10）は数えない", () => {
    expect(validatePostingSchedule({ ...base, slotTimes: ["23:50", "00:10"] }).ok).toBe(true);
  });

  it("形の誤った時刻は invalid_time", () => {
    expect(validatePostingSchedule({ ...base, slotTimes: ["25:00"] })).toMatchObject({ ok: false, reason: "invalid_time" });
  });
});

describe("日本時間の日付", () => {
  it("UTC 15:00 は日本時間の翌日", () => {
    expect(jstDateOf(new Date("2026-10-05T15:00:00Z"))).toBe("2026-10-06");
    expect(jstDateOf(new Date("2026-10-05T14:59:59Z"))).toBe("2026-10-05");
  });

  it("日本時間の0時と、日付の足し算", () => {
    expect(jstMidnight("2026-10-06").toISOString()).toBe("2026-10-05T15:00:00.000Z");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-10-06", -1)).toBe("2026-10-05");
  });
});

describe("ずらした時刻（FR-001a、research.md R2）", () => {
  it("ずらさなければ、ちょうどその時刻", () => {
    expect(plannedSlotTime(ACCOUNT, "2026-10-06", 720, false).toISOString()).toBe(jst("2026-10-06 12:00").toISOString());
  });

  it("同じ入力なら毎回同じ値で、±10分の中", () => {
    const a = plannedSlotTime(ACCOUNT, "2026-10-06", 720, true);
    const b = plannedSlotTime(ACCOUNT, "2026-10-06", 720, true);
    expect(a.getTime()).toBe(b.getTime());
    const diff = a.getTime() - jst("2026-10-06 12:00").getTime();
    expect(Math.abs(diff)).toBeLessThanOrEqual(600_000);
  });

  it("Account・日付が違えば、ふつうは違う値になる", () => {
    const values = new Set<number>();
    for (let i = 0; i < 20; i++) {
      values.add(plannedSlotTime(`acc-${i}`, "2026-10-06", 720, true).getTime());
      values.add(plannedSlotTime(ACCOUNT, addDays("2026-10-06", i), 720, true).getTime() - i * 86_400_000);
    }
    expect(values.size).toBeGreaterThan(30);
  });

  it("0:05 と 23:55 でも日付をまたがない", () => {
    for (let i = 0; i < 500; i++) {
      const id = `acc-${i}`;
      const early = plannedSlotTime(id, "2026-10-06", 5, true);
      const late = plannedSlotTime(id, "2026-10-06", 1435, true);
      expect(jstDateOf(early)).toBe("2026-10-06");
      expect(jstDateOf(late)).toBe("2026-10-06");
    }
  });

  it("30分あけた2つの時刻は、ずらしても順番が入れ替わらない", () => {
    for (let i = 0; i < 1000; i++) {
      const id = `acc-${i}`;
      expect(plannedSlotTime(id, "2026-10-06", 720, true).getTime()).toBeLessThan(
        plannedSlotTime(id, "2026-10-06", 750, true).getTime(),
      );
    }
  });
});

describe("予定の計算（FR-021、US4 シナリオ1、research.md R9）", () => {
  const base = {
    accountId: ACCOUNT,
    enabled: true,
    slotMinutes: [450, 720, 1260],
    jitter: false,
    effectiveFrom: jst("2026-10-01 00:00"),
    pausedUntil: null,
    now: jst("2026-10-06 10:00"),
    usedSlotTimes: [],
    publishedToday: 0,
    count: 5,
  };
  const fmt = (dates: Date[]) => dates.map((d) => d.toISOString());

  it("7:30・12:00・21:00、今10:00、5件なら、今日12:00・今日21:00・明日7:30・明日12:00・明日21:00", () => {
    expect(fmt(projectSchedule(base))).toEqual(
      fmt([
        jst("2026-10-06 12:00"),
        jst("2026-10-06 21:00"),
        jst("2026-10-07 07:30"),
        jst("2026-10-07 12:00"),
        jst("2026-10-07 21:00"),
      ]),
    );
  });

  it("effective_from より前の予定は飛ばす", () => {
    const r = projectSchedule({ ...base, effectiveFrom: jst("2026-10-06 13:00"), count: 2 });
    expect(fmt(r)).toEqual(fmt([jst("2026-10-06 21:00"), jst("2026-10-07 07:30")]));
  });

  it("paused_until より前の予定は飛ばす", () => {
    const r = projectSchedule({ ...base, pausedUntil: jst("2026-10-07 00:00"), count: 2 });
    expect(fmt(r)).toEqual(fmt([jst("2026-10-07 07:30"), jst("2026-10-07 12:00")]));
  });

  it("何日も前に過ぎた paused_until でも、先の予定を返す（PR #6 のCodexレビュー）", () => {
    const r = projectSchedule({ ...base, pausedUntil: jst("2026-09-20 00:00"), count: 2 });
    expect(fmt(r)).toEqual(fmt([jst("2026-10-06 12:00"), jst("2026-10-06 21:00")]));
  });

  it("今日の投稿済みが時刻の数に達していれば、今日の残りは飛ばす", () => {
    const r = projectSchedule({ ...base, slotMinutes: [450, 720, 1260], publishedToday: 3, count: 1 });
    expect(fmt(r)).toEqual(fmt([jst("2026-10-07 07:30")]));
    const r2 = projectSchedule({ ...base, publishedToday: 2, count: 2 });
    expect(fmt(r2)).toEqual(fmt([jst("2026-10-06 12:00"), jst("2026-10-07 07:30")]));
  });

  it("予定を過ぎて60分以内で、まだ使っていない時刻は、先頭に入る（これから処理される）", () => {
    const now = jst("2026-10-06 12:20");
    expect(fmt(projectSchedule({ ...base, now, count: 1 }))).toEqual(fmt([jst("2026-10-06 12:00")]));
    expect(fmt(projectSchedule({ ...base, now, usedSlotTimes: [jst("2026-10-06 12:00")], count: 1 }))).toEqual(
      fmt([jst("2026-10-06 21:00")]),
    );
  });

  it("オフ・時刻0件なら空", () => {
    expect(projectSchedule({ ...base, enabled: false })).toEqual([]);
    expect(projectSchedule({ ...base, slotMinutes: [] })).toEqual([]);
  });
});

describe("来ている時刻（FR-011、contracts/auto-post-job.md 手順2）", () => {
  const base = { accountId: ACCOUNT, slotMinutes: [450, 720, 1260], jitter: false, effectiveFrom: jst("2026-10-01 00:00") };

  it("予定から59分後なら、その時刻。61分後なら null", () => {
    expect(findDueSlot({ ...base, now: jst("2026-10-06 12:59") })?.slotAt.toISOString()).toBe(
      jst("2026-10-06 12:00").toISOString(),
    );
    expect(findDueSlot({ ...base, now: jst("2026-10-06 13:01") })).toBeNull();
  });

  it("2つの時刻が過ぎていても、新しい1つだけを返す", () => {
    const r = findDueSlot({ ...base, slotMinutes: [720, 750], now: jst("2026-10-06 12:55") });
    expect(r?.slotAt.toISOString()).toBe(jst("2026-10-06 12:30").toISOString());
    expect(r).toMatchObject({ slotDate: "2026-10-06", slotMinute: 750 });
  });

  it("前の日の時刻も扱う（0時をまたぐ）", () => {
    const r = findDueSlot({ ...base, slotMinutes: [1430], now: jst("2026-10-07 00:20") });
    expect(r).toMatchObject({ slotDate: "2026-10-06", slotMinute: 1430 });
  });

  it("effective_from より前の時刻は返さない", () => {
    expect(findDueSlot({ ...base, effectiveFrom: jst("2026-10-06 12:10"), now: jst("2026-10-06 12:30") })).toBeNull();
  });
});

describe("深夜の案内（FR-001b）", () => {
  it("2:00〜4:59 だけ true", () => {
    expect(isLateNightSlot(119)).toBe(false);
    expect(isLateNightSlot(120)).toBe(true);
    expect(isLateNightSlot(299)).toBe(true);
    expect(isLateNightSlot(300)).toBe(false);
  });
});
