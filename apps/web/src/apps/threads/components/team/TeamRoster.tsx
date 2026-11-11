// カード「このアカウントの担当」（specs/011-team-revision FR-055。009のカードを改めた）。
// チーム名・管理者と、このアカウントの担当の人を出す。見ている人の名前に「あなた」の印を付ける。
import type { AccountTeam } from "@meguru/shared";
import { cn } from "@/lib/utils";

type Person = { userId: string; name: string; note: string };

/**
 * カードの行（オーナー・管理者・担当の人）。チームに入っていなければ空。
 * @param team - GET /api/accounts/:id/team の応答
 * @returns 行
 */
export function rosterPeople(team: AccountTeam): { label: string; people: Person[] }[] {
  if (!team.team) return [];
  return [
    { label: "オーナー", people: [{ userId: team.owner.userId, name: team.owner.name, note: "このアカウントの持ち主" }] },
    { label: "管理者", people: [{ userId: team.team.admin.userId, name: team.team.admin.name, note: team.team.name }] },
    {
      label: "担当",
      people: team.assignees.map((a) => ({ userId: a.userId, name: a.name, note: a.role === "admin" ? "管理者" : "編集者" })),
    },
  ];
}

/**
 * このアカウントの担当のカード。
 * @param props - team：このAccountのチーム
 * @returns カード。チームに入っていなければ何も出さない
 */
export function TeamRoster({ team }: { team: AccountTeam }) {
  const rows = rosterPeople(team);
  if (rows.length === 0) return null;
  return (
    <dl aria-label="このアカウントの担当" className="divide-y rounded-2xl border bg-card text-sm">
      {rows.map((r) => (
        <div key={r.label} className="flex gap-3 px-4 py-3">
          <dt className="w-16 shrink-0 text-muted-foreground">{r.label}</dt>
          <dd className="min-w-0 flex-1">
            {r.people.length === 0 ? (
              <span className="text-muted-foreground">まだいません（管理者が担当を決めます）</span>
            ) : (
              <ul className="flex flex-wrap gap-x-4 gap-y-1">
                {r.people.map((p) => (
                  <li key={p.userId} className={cn("flex min-w-0 items-center gap-2")}>
                    <span className="truncate">{p.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{p.note}</span>
                    {p.userId === team.viewerUserId && (
                      <span className="shrink-0 rounded-full bg-foreground px-2 py-0.5 text-[11px] font-medium text-background">
                        あなた
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
