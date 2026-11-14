// 日本の祝日（specs/022-algorithm-analysis research.md R4）。祝日法の決まりで求める（2000〜2099年）。
// 解析は直近90日なので、一度だけの特別な休日（2019年の即位の日・2020・2021年の五輪の移動など）は扱わない。

const DAY_MS = 86_400_000;

/**
 * その月の第n月曜日（日）。
 * @param y - 年
 * @param m - 月（1〜12）
 * @param n - 第何週
 * @returns 日
 */
function nthMonday(y: number, m: number, n: number): number {
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  return 1 + ((8 - first) % 7) + (n - 1) * 7;
}

/**
 * 振替休日・国民の休日を除いた祝日か。
 * @param t - その日の0時（UTCの時刻として扱う）
 * @returns 祝日なら true
 */
function isBaseHoliday(t: number): boolean {
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const k = y - 1980;
  const spring = Math.floor(20.8431 + 0.242194 * k - Math.floor(k / 4));
  const autumn = Math.floor(23.2488 + 0.242194 * k - Math.floor(k / 4));
  switch (m) {
    case 1:
      return day === 1 || day === nthMonday(y, 1, 2);
    case 2:
      return day === 11 || (y >= 2020 && day === 23);
    case 3:
      return day === spring;
    case 4:
      return day === 29;
    case 5:
      return day === 3 || day === 4 || day === 5;
    case 7:
      return day === (y >= 2003 ? nthMonday(y, 7, 3) : 20);
    case 8:
      return y >= 2016 && day === 11;
    case 9:
      return day === autumn || day === (y >= 2003 ? nthMonday(y, 9, 3) : 15);
    case 10:
      return day === nthMonday(y, 10, 2);
    case 11:
      return day === 3 || day === 23;
    case 12:
      return y <= 2018 && day === 23;
    default:
      return false;
  }
}

/**
 * 祝日・振替休日・国民の休日か（2000〜2099年。外は false）。
 * @param ymd - 日付（YYYY-MM-DD）
 * @returns 休みの日なら true（土日だけの日は false）
 */
export function isJapaneseHoliday(ymd: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return false;
  const y = Number(m[1]);
  if (y < 2000 || y > 2099) return false;
  const t = Date.UTC(y, Number(m[2]) - 1, Number(m[3]));
  if (isBaseHoliday(t)) return true;
  // 国民の休日：前後が祝日の日（日曜を除く）
  if (new Date(t).getUTCDay() !== 0 && isBaseHoliday(t - DAY_MS) && isBaseHoliday(t + DAY_MS)) return true;
  // 振替休日：日曜の祝日から続く祝日の、次の日
  for (let p = t - DAY_MS; isBaseHoliday(p); p -= DAY_MS) {
    if (new Date(p).getUTCDay() === 0) return true;
  }
  return false;
}
