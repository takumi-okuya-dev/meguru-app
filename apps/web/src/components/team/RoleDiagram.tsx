// チーム運用の3つの役割の図（specs/008-team-operations FR-048、contracts/ui-routes.md「役割の図」、docs/team-roles.md）。
// 誰が誰を招き、何ができるかを1枚で示す。判定の守りはAPIにあり、これは説明のためだけ。
import { ArrowDownIcon, ArrowRightIcon } from "lucide-react";
import { Fragment } from "react";
import { cn } from "@/lib/utils";

/** 図の中の役割。 */
export type DiagramRole = "owner" | "partner" | "editor";

const ROLES: { role: DiagramRole; name: string; who: string; can: string[] }[] = [
  {
    role: "owner",
    name: "オーナー",
    who: "Threadsアカウントの持ち主",
    can: ["投稿の承認・設定・接続・支払い", "パートナーを招き、任せる範囲を決める"],
  },
  {
    role: "partner",
    name: "パートナー",
    who: "運用代行・コンサル（会社）",
    can: ["投稿の案・戦略を作る、直す", "編集者を招き、担当を決める", "承認・設定は任されたときだけ"],
  },
  {
    role: "editor",
    name: "編集者",
    who: "パートナーの会社のスタッフ",
    can: ["担当のアカウントで、投稿の案・戦略を作る、直す", "承認・設定はできない"],
  },
];

const LINKS = [
  { label: "招く", note: "1アカウントに1人" },
  { label: "招く・担当を決める", note: "チームで10人まで・無料" },
];

/**
 * チーム運用の役割の図。
 * @param props - you：見ている人の役割（「あなた」の印を付ける）、vertical：常に縦に並べる（狭いカードの中で使う）、className：外側のクラス
 * @returns 図
 */
export function RoleDiagram({
  you,
  vertical = false,
  className,
}: {
  you?: DiagramRole;
  vertical?: boolean;
  className?: string;
}) {
  return (
    <figure aria-label="チーム運用の役割の図" className={cn("space-y-2", className)}>
      <ol className={cn("flex flex-col items-stretch gap-1.5", !vertical && "md:flex-row md:items-center")}>
        {ROLES.map((r, i) => (
          <Fragment key={r.role}>
            <li
              aria-current={you === r.role ? "true" : undefined}
              className={cn(
                "min-w-0 flex-1 space-y-1 rounded-xl border bg-card px-3.5 py-3 text-sm",
                you === r.role && "border-foreground",
              )}
            >
              <div className="flex items-center gap-2">
                <span className="font-semibold">{r.name}</span>
                {you === r.role && (
                  <span className="rounded-full bg-foreground px-2 py-0.5 text-[11px] font-medium text-background">あなた</span>
                )}
              </div>
              <div className="text-xs text-muted-foreground">{r.who}</div>
              <ul className="space-y-0.5 pt-1 text-[13px] text-foreground/80">
                {r.can.map((c) => (
                  <li key={c}>・{c}</li>
                ))}
              </ul>
            </li>
            {i < LINKS.length && (
              <li
                aria-label={`${r.name}が${ROLES[i + 1]!.name}を${LINKS[i]!.label}（${LINKS[i]!.note}）`}
                className={cn(
                  "flex items-center justify-center gap-2 py-0.5 text-xs text-muted-foreground",
                  !vertical && "md:w-24 md:shrink-0 md:flex-col md:gap-0.5 md:text-center",
                )}
              >
                <ArrowDownIcon aria-hidden="true" className={cn("size-4", !vertical && "md:hidden")} />
                <ArrowRightIcon aria-hidden="true" className={cn("hidden size-4", !vertical && "md:block")} />
                <span aria-hidden="true">
                  <span className="font-medium text-foreground/80">{LINKS[i]!.label}</span>
                  <span className="block">{LINKS[i]!.note}</span>
                </span>
              </li>
            )}
          </Fragment>
        ))}
      </ol>
      <figcaption className="text-xs text-muted-foreground">
        承認と設定は、オーナーがスイッチで任せるまで、オーナーだけが行います。誰が何をしたかは「操作の記録」に残ります。
      </figcaption>
    </figure>
  );
}
