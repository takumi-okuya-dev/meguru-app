// 退会の確かめの人物メモの分（specs/people/001-people-memo research.md R19、tasks.md T046）。
// 外枠の退会のダイアログに、AppModule の withdrawalPreview として渡す。
import type { PeopleMe } from "@meguru/shared/people";

/**
 * 退会で消える人物メモの中身（人とイベントの数）。
 * @param props - data：GET /api/people/me の中身（人物メモを開いていない人は null）
 * @returns 退会のダイアログに出す部分（null なら何も出さない）
 */
export function PeopleWithdrawalPreviewSection({ data }: { data: PeopleMe | null }) {
  if (!data) return null;
  return (
    <section className="space-y-1">
      <h3 className="font-medium">人物メモ</h3>
      <p>
        人物メモ：人 {data.personCount}人・イベント {data.eventCount}件が消えます
      </p>
    </section>
  );
}
