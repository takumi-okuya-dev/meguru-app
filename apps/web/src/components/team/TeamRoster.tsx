// カード「このアカウントのチーム」（specs/008-team-operations FR-042、contracts/ui-routes.md「このアカウントの設定」）。
// オーナー → パートナー → 担当の編集者を、名前で上から順につなぐ。出すのはこのAccountの人だけ。
import type { AccountTeam } from "@threads-grower/shared";
import { ArrowDownIcon } from "lucide-react";
import { Fragment } from "react";
import { cn } from "@/lib/utils";

type Person = { userId: string; name: string; note?: string | null };
type Tier = { key: string; role: string; who: string; people: Person[] };

/**
 * カードの段（オーナー・パートナー・編集者）。パートナーも編集者もいなければ空。
 * @param team - GET /api/accounts/:id/team の応答
 * @returns 上から順の段
 */
export function rosterTiers(team: AccountTeam): Tier[] {
  if (!team.partner && team.editors.length === 0) return [];
  return [
    { key: "owner", role: "オーナー", who: "Threadsアカウントの持ち主", people: [team.owner] },
    ...(team.partner
      ? [
          {
            key: "partner",
            role: "パートナー",
            who: "運用を手伝うコンサル・代理店",
            people: [{ userId: team.partner.userId, name: team.partner.name, note: team.partner.teamName }],
          },
        ]
      : []),
    ...(team.editors.length > 0
      ? [{ key: "editor", role: "編集者", who: "投稿の案を作る人（パートナーの会社のスタッフ）", people: team.editors }]
      : []),
  ];
}

/**
 * このアカウントのチームのカード。見ている人の名前に「あなた」の印を付ける。
 * @param props - team：このAccountのチーム
 * @returns カード。手伝う人が誰もいなければ何も出さない
 */
export function TeamRoster({ team }: { team: AccountTeam }) {
  const tiers = rosterTiers(team);
  if (tiers.length === 0) return null;
  return (
    <ol aria-label="このアカウントのチーム" className="flex flex-col items-stretch gap-1.5">
      {tiers.map((t, i) => {
        const mine = t.people.some((p) => p.userId === team.viewerUserId);
        return (
          <Fragment key={t.key}>
            {i > 0 && (
              <li aria-hidden="true" className="flex justify-center text-muted-foreground">
                <ArrowDownIcon className="size-4" />
              </li>
            )}
            <li
              aria-label={t.role}
              className={cn("space-y-1.5 rounded-xl border bg-card px-3.5 py-3 text-sm", mine && "border-foreground")}
            >
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-semibold">{t.role}</span>
                <span className="text-xs text-muted-foreground">{t.who}</span>
              </div>
              <ul className="flex flex-wrap gap-x-4 gap-y-1">
                {t.people.map((p) => (
                  <li key={p.userId} className="flex min-w-0 items-center gap-2">
                    <span className="truncate">{p.note ? `${p.name} · ${p.note}` : p.name}</span>
                    {p.userId === team.viewerUserId && (
                      <span className="shrink-0 rounded-full bg-foreground px-2 py-0.5 text-[11px] font-medium text-background">
                        あなた
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}
