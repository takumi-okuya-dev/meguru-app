// 誘いの文（specs/people/001-people-memo research.md R17、FR-020）。APIを呼ばずに画面が作る（モバイルでも同じ文）。

/** 初めの型（spec Assumptions）。 */
export const DEFAULT_INVITE_TEMPLATE = "{名前}さん、{日にち}の{会の名前}、もしご興味あれば一緒にいかがですか？";

/** 誘いの文の型の文字の上限（data-model.md 2-12）。 */
export const INVITE_TEMPLATE_MAX = 500;

/** 曜日。 */
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

/**
 * 開催日を「12月13日（土）」の形にする（日付は日本時間の日付として持っているので、その日付の曜日）。
 * @param heldOn - 開催日（YYYY-MM-DD）
 * @returns 日にち
 */
export function formatInviteDate(heldOn: string): string {
  const [y, m, d] = heldOn.split("-").map(Number) as [number, number, number];
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
  return `${m}月${d}日（${weekday}）`;
}

/**
 * 誘いの文を作る。差し込みは {名前}・{会の名前}・{日にち}。型が空なら初めの型を使う。
 * @param template - 作り手の型（null・空なら初めの型）
 * @param values - name：本名、なければ今のLINE名、eventName：誘う会の名前、heldOn：誘う会の開催日
 * @returns 文
 */
export function buildInviteMessage(template: string | null | undefined, values: { name: string; eventName: string; heldOn: string }): string {
  const t = template && template.trim() !== "" ? template : DEFAULT_INVITE_TEMPLATE;
  const fill: Record<string, string> = { 名前: values.name, 会の名前: values.eventName, 日にち: formatInviteDate(values.heldOn) };
  // 1回で差し込む（差し込んだ名前の中の「{日にち}」や「$'」を、もう一度読み替えない）
  return t.replace(/\{(名前|会の名前|日にち)\}/g, (_, key: string) => fill[key]!);
}
