// 運営メンバーと傾斜（specs/collect/003-revenue-sharing User Story 2、FR-010・FR-011、research.md R1・R2）。
// 倍率は 1.0〜上限・0.1 きざみ。入れながら、共通の計算（computeDistribution）で分配額を出し直して見せる。
import {
  computeDistribution,
  maxRatioTenths,
  RATIO_TENTHS,
  ratioLabel,
  SHARING_LIMITS,
  SHARING_ROLE_LABELS,
  SHARING_ROLES,
  type SharingMember,
  type SharingRole,
  type SharingSnapshot,
} from "@meguru/shared";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { yen } from "../../lib/reception-model";
import { ChoiceButtons } from "../roster/ChoiceButtons";

/** 運営メンバーの入力（画面の値）。 */
export type MemberInput = { name: string; role: SharingRole; ratioTenths: number | null };

/**
 * 運営メンバーの一覧。
 * @param props - snap：分配の数字、onAdd・onUpdate・onDelete：保存する（成功したら true）、extra：行ごとに足す操作（招待など）
 * @returns 段
 */
export function MemberList({
  snap,
  onAdd,
  onUpdate,
  onDelete,
  extra,
}: {
  snap: SharingSnapshot;
  onAdd: (input: MemberInput) => Promise<boolean>;
  onUpdate: (id: string, input: MemberInput) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  extra?: (member: SharingMember) => ReactNode;
}) {
  const [editing, setEditing] = useState<SharingMember | "new" | null>(null);
  const [deleting, setDeleting] = useState<SharingMember | null>(null);
  return (
    <div className="space-y-2">
      <ul className="divide-y rounded-lg border" aria-label="運営メンバー">
        {snap.members.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm" aria-label={`運営メンバー ${m.name}`}>
            <div className="min-w-0 flex-1">
              <span className="font-medium">{m.name}</span>
              <span className="ml-1.5 text-xs text-muted-foreground">
                {SHARING_ROLE_LABELS[m.role]}
                {m.role === "leader" && m.ratioTenths ? `・${ratioLabel(m.ratioTenths)}` : ""}
                {m.isOwner && "・主催者"}
              </span>
              {!m.isOwner && m.linked && <span className="ml-1.5 rounded bg-emerald-600/10 px-1.5 text-xs text-emerald-700 dark:text-emerald-400">つながった</span>}
            </div>
            {extra?.(m)}
            <Button type="button" variant="ghost" size="icon" aria-label={`${m.name}を直す`} onClick={() => setEditing(m)}>
              <PencilIcon className="size-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon" aria-label={`${m.name}を消す`} onClick={() => setDeleting(m)}>
              <Trash2Icon className="size-4" />
            </Button>
          </li>
        ))}
      </ul>
      <Button type="button" variant="outline" size="sm" disabled={snap.members.length >= SHARING_LIMITS.membersPerEvent} onClick={() => setEditing("new")}>
        <PlusIcon className="size-4" /> 運営メンバーを足す
      </Button>
      {editing && (
        <MemberDialog
          member={editing === "new" ? null : editing}
          snap={snap}
          onSave={(input) => (editing === "new" ? onAdd(input) : onUpdate(editing.id, input))}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="運営メンバーを消しますか？"
          confirmLabel="消す"
          destructive
          onConfirm={() => {
            void onDelete(deleting.id).then((ok) => ok && setDeleting(null));
          }}
          onCancel={() => setDeleting(null)}
        >
          <p>
            {deleting.name}を運営メンバーから外します。立て替えた経費は、名前で残ります。{deleting.linked && !deleting.isOwner && "つながりも外れ、この人は分配を見られなくなります。"}
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}

/**
 * 運営メンバーを足す・直すダイアログ。倍率を変えると、分配額の見込みをその場で出す。
 * @param props - member：直す人（足すときは null）、snap：分配の数字、onSave：保存する、onClose：閉じる
 * @returns ダイアログ
 */
function MemberDialog({
  member,
  snap,
  onSave,
  onClose,
}: {
  member: SharingMember | null;
  snap: SharingSnapshot;
  onSave: (input: MemberInput) => Promise<boolean>;
  onClose: () => void;
}) {
  const [name, setName] = useState(member?.name ?? "");
  const [role, setRole] = useState<SharingRole>(member?.role ?? "member");
  const [ratio, setRatio] = useState(((member?.ratioTenths ?? RATIO_TENTHS.default) / 10).toFixed(1));
  const [pending, setPending] = useState(false);
  const tenths = Math.round(Number(ratio) * 10);
  // 変えたあとの全員で、上限と分配額を出し直す
  const after = [
    ...snap.members.map((m) => (m.id === member?.id ? { ...m, role, ratioTenths: role === "leader" ? tenths : null } : m)),
    ...(member ? [] : [{ id: "new", name: name || "新しい人", role, ratioTenths: role === "leader" ? tenths : null, isOwner: false }]),
  ];
  const max = maxRatioTenths(after);
  const leaderSum = after.reduce((s, m) => s + (m.role === "leader" ? (m.ratioTenths ?? RATIO_TENTHS.default) : 0), 0);
  const tooHigh = max !== null && leaderSum > max;
  const ratioValid = role === "member" || (Number.isFinite(tenths) && tenths >= RATIO_TENTHS.min && tenths <= RATIO_TENTHS.max);
  const preview = ratioValid && !tooHigh ? computeDistribution(snap.current.amount, after) : null;
  const mine = preview?.shares.find((s) => s.memberId === (member?.id ?? "new"));
  // この人の倍率で入れられる上限（ほかのリーダーの分を引く）
  const ownMax = max === null ? RATIO_TENTHS.max : Math.min(RATIO_TENTHS.max, max - (leaderSum - (role === "leader" ? tenths : 0)));
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md" aria-describedby="member-desc">
        <DialogTitle>{member ? "運営メンバーを直す" : "運営メンバーを足す"}</DialogTitle>
        <DialogDescription id="member-desc">リーダーは「残る額 ÷ 人数」の倍率の分を、メンバーは残りを等しく受け取ります。</DialogDescription>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim() || !ratioValid || tooHigh) return;
            setPending(true);
            const ok = await onSave({ name: name.trim(), role, ratioTenths: role === "leader" ? tenths : null });
            setPending(false);
            if (ok) onClose();
          }}
        >
          <Input aria-label="運営メンバーの名前" placeholder="名前" value={name} maxLength={SHARING_LIMITS.memberName} onChange={(e) => setName(e.target.value)} />
          <ChoiceButtons label="役割" options={SHARING_ROLES.map((r) => ({ value: r, label: SHARING_ROLE_LABELS[r] }))} value={role} onChange={setRole} />
          {role === "leader" && (
            <label className="block space-y-1 text-sm">
              <span className="text-xs text-muted-foreground">倍率（1.0〜{(Math.max(ownMax, RATIO_TENTHS.min) / 10).toFixed(1)}倍）</span>
              <Input aria-label="倍率" type="number" inputMode="decimal" step="0.1" min="1.0" max={(ownMax / 10).toFixed(1)} value={ratio} onChange={(e) => setRatio(e.target.value)} />
            </label>
          )}
          {tooHigh && (
            <p role="alert" className="text-sm text-destructive">
              リーダーの倍率の合計が大きすぎて、メンバーの分がなくなります。合計を{ratioLabel(max)}以下にしてください。
            </p>
          )}
          {mine && !preview!.deficit && (
            <p className="text-sm text-muted-foreground" aria-live="polite">
              今の残る額なら、この人の分配額は {yen(mine.total)} です。
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              キャンセル
            </Button>
            <Button type="submit" disabled={!name.trim() || !ratioValid || tooHigh || pending}>
              保存する
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
