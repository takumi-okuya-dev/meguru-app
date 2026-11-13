// ホームの「今日やること・過ぎたもの・近い誕生日」（specs/people/002-sales-list spec US2、FR-104）。誘う候補の画面の上に出す。
// 行を押すと人のページへ。過ぎたものは目立たせる。知らせ（メール・通知）は作らない。
import type { HomeItem, PeopleHome } from "@meguru/shared/people";
import { useQuery } from "@tanstack/react-query";
import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { describeError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { peopleApi } from "../../lib/api";
import { personPath } from "../../lib/paths";
import { peopleQueryKeys } from "../../lib/query-keys";
import { formatMonthDay } from "../format";
import { nextActionText } from "../person/PersonBadges";

/** はじめに出す行の数（それより多いときは「すべて出す」）。 */
const FIRST_ROWS = 5;

/**
 * ホームの1つのまとまり（見出し・人数・行）。
 * @param props - title：見出し、items：人、kind：まとまりの種類（過ぎたものは目立たせる）、empty：いないときの文
 * @returns まとまり
 */
function HomeGroup({ title, items, kind, empty }: { title: string; items: HomeItem[]; kind: "today" | "overdue" | "birthday"; empty: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, FIRST_ROWS);
  const overdue = kind === "overdue";
  return (
    <section aria-label={title} className={cn("space-y-1.5", overdue && items.length > 0 && "rounded-2xl border border-destructive/40 bg-destructive/5 p-2")}>
      <h3 className={cn("flex items-baseline gap-2 px-1 text-sm font-medium", overdue && items.length > 0 && "text-destructive")}>
        {title}
        <span className="tabular-nums">{items.length}人</span>
      </h3>
      {items.length === 0 ? (
        <p className="px-1 text-[13px] text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {shown.map((p) => (
            <li key={p.id}>
              <Link to={personPath(p.id)} className="flex min-h-11 items-center gap-2 px-3 py-2 text-sm hover:bg-accent">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{p.displayName}</div>
                  <div className={cn("break-words text-[13px]", overdue ? "text-destructive" : "text-muted-foreground")}>
                    {kind === "birthday" ? `誕生日 ${p.birthdayMd ? formatMonthDay(p.birthdayMd) : ""}` : p.nextAction ? nextActionText(p.nextAction) : ""}
                  </div>
                </div>
                <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {items.length > FIRST_ROWS && (
        <Button type="button" variant="ghost" className="h-11 rounded-full md:h-9" onClick={() => setAll((v) => !v)}>
          {all ? "少なく出す" : `すべて出す（${items.length}人）`}
        </Button>
      )}
    </section>
  );
}

/**
 * 今日やること・過ぎたもの・近い誕生日。
 * @param props - data：ホームの中身
 * @returns まとまりの並び
 */
export function HomeTodayList({ data }: { data: PeopleHome }) {
  return (
    <div className="space-y-3">
      {data.overdue.length > 0 && <HomeGroup title="過ぎたもの" items={data.overdue} kind="overdue" empty="" />}
      <HomeGroup title="今日やること" items={data.today} kind="today" empty="今日やることはありません。人のページで「次にやること」を決めると、ここに出ます。" />
      {data.birthdays.length > 0 && <HomeGroup title="近い誕生日" items={data.birthdays} kind="birthday" empty="" />}
    </div>
  );
}

/**
 * ホームの段（読み込み・失敗も出す）。
 * @returns 段
 */
export function HomeTodaySection() {
  const home = useQuery({ queryKey: peopleQueryKeys.home, queryFn: peopleApi.home });
  return (
    <section aria-labelledby="people-home-heading" className="space-y-2">
      <h2 id="people-home-heading" className="text-base font-semibold">
        今日の声かけ
      </h2>
      {home.isPending ? (
        <p className="text-sm text-muted-foreground">読み込んでいます…</p>
      ) : home.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {describeError(home.error)}
        </p>
      ) : (
        <HomeTodayList data={home.data} />
      )}
    </section>
  );
}
