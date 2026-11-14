// 経費の一覧と、足す・直す・消す（specs/collect/003-revenue-sharing User Story 1、FR-001）。立て替えた人は運営メンバーか名前。
import { SHARING_LIMITS, type Expense, type SharingSnapshot } from "@meguru/shared";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { yen } from "../../lib/reception-model";

/** 経費の入力（画面の値）。 */
export type ExpenseInput = { name: string; amount: number; payerMemberId: string | null; payerName: string | null };

/** 立て替えた人の選び方の値：なし・運営メンバーの番号・その他（名前）。 */
const NONE = "";
const OTHER = "__other__";

/**
 * 経費の一覧。
 * @param props - snap：分配の数字、onAdd・onUpdate・onDelete：保存する（成功したら true）
 * @returns 段
 */
export function ExpenseList({
  snap,
  onAdd,
  onUpdate,
  onDelete,
}: {
  snap: SharingSnapshot;
  onAdd: (input: ExpenseInput) => Promise<boolean>;
  onUpdate: (id: string, input: ExpenseInput) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState<Expense | "new" | null>(null);
  const [deleting, setDeleting] = useState<Expense | null>(null);
  return (
    <div className="space-y-2">
      {snap.expenses.length === 0 ? (
        <p className="text-sm text-muted-foreground">まだ経費がありません。会場費・飲食・備品などを入れてください。</p>
      ) : (
        <ul className="divide-y rounded-lg border" aria-label="経費">
          {snap.expenses.map((e) => (
            <li key={e.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{e.name}</div>
                {e.payer && <div className="truncate text-xs text-muted-foreground">立て替え：{e.payer.name}</div>}
              </div>
              <div className="tabular-nums">{yen(e.amount)}</div>
              <Button type="button" variant="ghost" size="icon" aria-label={`${e.name}を直す`} onClick={() => setEditing(e)}>
                <PencilIcon className="size-4" />
              </Button>
              <Button type="button" variant="ghost" size="icon" aria-label={`${e.name}を消す`} onClick={() => setDeleting(e)}>
                <Trash2Icon className="size-4" />
              </Button>
            </li>
          ))}
          <li className="flex justify-between px-3 py-2 text-sm font-medium">
            <span>合計</span>
            <span className="tabular-nums">{yen(snap.expenseTotal)}</span>
          </li>
        </ul>
      )}
      <Button type="button" variant="outline" size="sm" disabled={snap.expenses.length >= SHARING_LIMITS.expensesPerEvent} onClick={() => setEditing("new")}>
        <PlusIcon className="size-4" /> 経費を足す
      </Button>
      {editing && (
        <ExpenseDialog
          expense={editing === "new" ? null : editing}
          members={snap.members}
          onSave={(input) => (editing === "new" ? onAdd(input) : onUpdate(editing.id, input))}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="経費を消しますか？"
          confirmLabel="消す"
          destructive
          onConfirm={() => {
            void onDelete(deleting.id).then((ok) => ok && setDeleting(null));
          }}
          onCancel={() => setDeleting(null)}
        >
          <p>
            {deleting.name}（{yen(deleting.amount)}）を消します。残る額と分配額が変わります。
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}

/**
 * 経費を足す・直すダイアログ。
 * @param props - expense：直す経費（足すときは null）、members：運営メンバー、onSave：保存する、onClose：閉じる
 * @returns ダイアログ
 */
function ExpenseDialog({
  expense,
  members,
  onSave,
  onClose,
}: {
  expense: Expense | null;
  members: SharingSnapshot["members"];
  onSave: (input: ExpenseInput) => Promise<boolean>;
  onClose: () => void;
}) {
  const [name, setName] = useState(expense?.name ?? "");
  const [amount, setAmount] = useState(expense ? String(expense.amount) : "");
  const [payer, setPayer] = useState(expense?.payer ? (expense.payer.memberId ?? OTHER) : NONE);
  const [payerName, setPayerName] = useState(expense?.payer?.memberId === null ? expense.payer.name : "");
  const [pending, setPending] = useState(false);
  const value = Number(amount.normalize("NFKC").replace(/[,円\s]/g, ""));
  const valid = name.trim() !== "" && Number.isInteger(value) && value >= 1 && value <= SHARING_LIMITS.expenseAmountMax && (payer !== OTHER || payerName.trim() !== "");
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md" aria-describedby="expense-desc">
        <DialogTitle>{expense ? "経費を直す" : "経費を足す"}</DialogTitle>
        <DialogDescription id="expense-desc">名前・金額と、立て替えた人（いれば）を入れます。立て替えた分は、分配額とは別に戻す額として出ます。</DialogDescription>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!valid) return;
            setPending(true);
            const ok = await onSave({
              name: name.trim(),
              amount: value,
              payerMemberId: payer !== NONE && payer !== OTHER ? payer : null,
              payerName: payer === OTHER ? payerName.trim() : null,
            });
            setPending(false);
            if (ok) onClose();
          }}
        >
          <Input aria-label="経費の名前" placeholder="会場費・飲食など" value={name} maxLength={SHARING_LIMITS.expenseName} onChange={(e) => setName(e.target.value)} />
          <Input aria-label="金額" inputMode="numeric" placeholder="20000" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <label className="block space-y-1 text-sm">
            <span className="text-xs text-muted-foreground">立て替えた人</span>
            <select aria-label="立て替えた人" className="h-10 w-full rounded-md border bg-background px-2" value={payer} onChange={(e) => setPayer(e.target.value)}>
              <option value={NONE}>なし</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
              <option value={OTHER}>運営メンバーでない人</option>
            </select>
          </label>
          {payer === OTHER && (
            <Input aria-label="立て替えた人の名前" placeholder="名前" value={payerName} maxLength={SHARING_LIMITS.memberName} onChange={(e) => setPayerName(e.target.value)} />
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              キャンセル
            </Button>
            <Button type="submit" disabled={!valid || pending}>
              保存する
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
