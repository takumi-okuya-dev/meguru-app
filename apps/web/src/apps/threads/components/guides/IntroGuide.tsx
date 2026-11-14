// ホームの「はじめに読んでほしいこと」（specs/014-strategy-guidance FR-061・FR-062、research.md R15・R16）。
// 初めは開いた状態。「閉じる」で見出し1行にし、閉じたことは利用者ごとに端末に覚える。
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { readPreference, writePreference } from "@/apps/threads/lib/preferences";
import { queryKeys } from "@/lib/query";

const POINTS = [
  "SNSの運用は地道です。毎日少しずつでも続けることが、いちばんの力になります。",
  "始めのうちは反応が少ないのが当たり前です。数日・数週間の数字で落ち込まなくて大丈夫です。",
  "このアプリは投稿づくりを手伝いますが、フォロワーや問い合わせが増えることを約束するものではありません。",
  "SNSの時間を、先に予定に入れておきましょう（通勤中・寝る前の15分など）。",
  "完璧を目指さず、小さく試して、反応を見ながら直していきましょう。",
];

/**
 * はじめに読んでほしいこと。利用者が分かってから出す（覚えた値を利用者ごとに読むため）。
 * @returns 読み物。利用者が分かるまでは何も出さない
 */
export function IntroGuide() {
  const me = useQuery({ queryKey: queryKeys.me, queryFn: api.me });
  const userId = me.data?.user.id;
  if (!userId) return null;
  return <IntroGuideBody key={userId} userId={userId} />;
}

function IntroGuideBody({ userId }: { userId: string }) {
  const key = `threads-grower:intro-dismissed:${userId}` as const;
  const [closed, setClosed] = useState(() => readPreference(key, false));
  const headingId = useId();
  const toggle = () => {
    writePreference(key, !closed);
    setClosed(!closed);
  };
  return (
    <section aria-labelledby={headingId} className="w-full rounded-2xl border bg-card px-4 py-3 text-left md:px-5">
      <div className="flex items-center justify-between gap-2">
        <h2 id={headingId} className="text-sm font-semibold">
          はじめに読んでほしいこと
        </h2>
        <Button variant="ghost" size="sm" className="h-9 rounded-full" onClick={toggle}>
          {closed ? "開く" : "閉じる"}
        </Button>
      </div>
      {!closed && (
        <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[13px] leading-relaxed">
          {POINTS.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
