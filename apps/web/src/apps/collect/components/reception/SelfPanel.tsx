// 受付の画面の上の「確かめ待ち」と「申し出」（specs/collect/002-self-check-in User Story 2・4、FR-030〜FR-033・FR-020〜FR-023、tasks.md T019）。
// 確かめ待ち：参加者が自分で選んだ現金・PayPay。受付をする人が受け取ったら「受け取った」（払い方を変えて受け取る・取り消すもできる）。
// 申し出：名簿にいない参加者が送った名前。名簿に入れる・名簿の人に当てる・断る。どちらもないときは何も出さない。
import { RECEPTION_METHOD_LABELS, type ReceptionSnapshot, type SelfRequest } from "@meguru/shared";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { yen } from "../../lib/reception-model";
import type { ReceptionState } from "../../lib/use-reception";
import { TierChoiceDialog } from "./TierChoiceDialog";

/**
 * 確かめ待ちと申し出。
 * @param props - state：受付の画面の状態、snap：スナップショット
 * @returns パネル（どちらもなければ null）
 */
export function SelfPanel({ state, snap }: { state: ReceptionState; snap: ReceptionSnapshot }) {
  const [undoing, setUndoing] = useState<{ id: string; label: string } | null>(null);
  const [matching, setMatching] = useState<SelfRequest | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // 区分を選んでから受け取る人（区分が未定で、区分が2つ以上。specs/collect/004 FR-021）
  const [choosingTier, setChoosingTier] = useState<{ id: string; label: string; method?: "cash" | "paypay" } | null>(null);
  const needsTier = (p: { tierUndecided: boolean }) => p.tierUndecided && snap.event.tiers.length > 1;
  const awaiting = snap.people.filter((p) => p.record?.paymentStatus === "awaiting_confirmation");
  const requests = snap.selfRequests;
  if (awaiting.length === 0 && requests.length === 0) return null;

  const run = async (key: string, task: () => Promise<boolean>) => {
    setBusy(key);
    try {
      await task();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      {awaiting.length > 0 && (
        <section aria-labelledby="awaiting-title" className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950/40">
          <h2 id="awaiting-title" className="text-sm font-medium">
            確かめ待ち（{awaiting.length}人）
          </h2>
          <p className="text-xs text-muted-foreground">参加者が自分で選んだ払い方です。お金を受け取ったら「受け取った」を押してください。</p>
          <ul className="space-y-2" aria-label="確かめ待ち">
            {awaiting.map(({ person, record }) => {
              const method = record!.method as "cash" | "paypay";
              const other = method === "cash" ? "paypay" : "cash";
              const canSwitch = snap.event.methods.includes(other);
              const key = `c:${person.id}`;
              return (
                <li key={person.id} className="flex flex-col gap-2 rounded-md border bg-card p-2 sm:flex-row sm:items-center" aria-label={`No.${person.number} ${person.name}（確かめ待ち）`}>
                  <div className="min-w-0 flex-1 text-sm">
                    <span className="text-muted-foreground tabular-nums">No.{person.number}</span> <span className="font-medium">{person.name}</span>
                    <span className="ml-2 text-muted-foreground">
                      {RECEPTION_METHOD_LABELS[method]} {needsTier(person) ? <span className="font-medium text-amber-700 dark:text-amber-400">区分を確かめる</span> : yen(record!.amount)}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      className="h-11"
                      disabled={busy === key}
                      onClick={() =>
                        needsTier(person)
                          ? setChoosingTier({ id: person.id, label: `No.${person.number} ${person.name}` })
                          : void run(key, () => state.confirm(person.id))
                      }
                    >
                      受け取った
                    </Button>
                    {canSwitch && (
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11"
                        disabled={busy === key}
                        onClick={() =>
                          needsTier(person)
                            ? setChoosingTier({ id: person.id, label: `No.${person.number} ${person.name}`, method: other })
                            : void run(key, () => state.confirm(person.id, { method: other }))
                        }
                      >
                        {RECEPTION_METHOD_LABELS[other]}で受け取った
                      </Button>
                    )}
                    <Button type="button" variant="ghost" className="h-11" onClick={() => setUndoing({ id: person.id, label: `No.${person.number} ${person.name}` })}>
                      取り消す
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {requests.length > 0 && (
        <section aria-labelledby="requests-title" className="space-y-2 rounded-lg border border-sky-300 bg-sky-50 p-3 dark:border-sky-700 dark:bg-sky-950/40">
          <h2 id="requests-title" className="text-sm font-medium">
            名簿にいない人の申し出（{requests.length}件）
          </h2>
          <ul className="space-y-2" aria-label="申し出">
            {requests.map((r) => {
              const key = `r:${r.id}`;
              return (
                <li key={r.id} className="flex flex-col gap-2 rounded-md border bg-card p-2 sm:flex-row sm:items-center" aria-label={`申し出 ${r.name}`}>
                  <div className="min-w-0 flex-1 text-sm">
                    <span className="font-medium">{r.name}</span>
                    {r.kana && <span className="ml-2 text-xs text-muted-foreground">{r.kana}</span>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" className="h-11" disabled={busy === key} onClick={() => void run(key, () => state.resolveRequest(r.id, "accept"))}>
                      名簿に入れる
                    </Button>
                    <Button type="button" variant="outline" className="h-11" disabled={busy === key} onClick={() => setMatching(r)}>
                      名簿の人に当てる
                    </Button>
                    <Button type="button" variant="ghost" className="h-11" disabled={busy === key} onClick={() => void run(key, () => state.resolveRequest(r.id, "reject"))}>
                      断る
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {choosingTier && (
        <TierChoiceDialog
          title={`${choosingTier.label}の区分`}
          tiers={snap.event.tiers}
          onChoose={(priceTierId) => {
            const { id, method } = choosingTier;
            setChoosingTier(null);
            void run(`c:${id}`, () => state.confirm(id, { priceTierId, ...(method ? { method } : {}) }));
          }}
          onClose={() => setChoosingTier(null)}
        />
      )}
      {undoing && (
        <ConfirmDialog
          title="本人の申告を取り消しますか？"
          confirmLabel="取り消す"
          destructive
          onConfirm={() => {
            void state.undo(undoing.id);
            setUndoing(null);
          }}
          onCancel={() => setUndoing(null)}
        >
          <p>{undoing.label}を未受付に戻します。参加者の画面には「受付に来てください」と出ます。</p>
        </ConfirmDialog>
      )}
      {matching && (
        <MatchDialog
          request={matching}
          snap={snap}
          onMatch={async (personId) => {
            const ok = await state.resolveRequest(matching.id, "match", personId);
            if (ok) setMatching(null);
          }}
          onClose={() => setMatching(null)}
        />
      )}
    </div>
  );
}

/**
 * 申し出を名簿の人に当てるダイアログ（まだ受付していない人から選ぶ）。
 * @param props - request：申し出、snap：スナップショット、onMatch：当てる、onClose：閉じる
 * @returns ダイアログ
 */
function MatchDialog({
  request,
  snap,
  onMatch,
  onClose,
}: {
  request: SelfRequest;
  snap: ReceptionSnapshot;
  onMatch: (personId: string) => Promise<void>;
  onClose: () => void;
}) {
  const candidates = snap.people.filter((p) => p.record === null).map((p) => p.person);
  const [personId, setPersonId] = useState(candidates[0]?.id ?? "");
  const [pending, setPending] = useState(false);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" aria-describedby="match-desc">
        <DialogTitle>「{request.name}」を名簿の人に当てる</DialogTitle>
        <DialogDescription id="match-desc">つづり違い・旧姓などで見つからなかった人を、名簿の人として扱います。参加者の画面は払い方を選ぶ段に進みます。</DialogDescription>
        {candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">まだ受付していない人がいません。</p>
        ) : (
          <label className="block space-y-1.5 text-sm">
            <span>名簿の人（まだ受付していない人）</span>
            <select className="h-11 w-full rounded-md border bg-background px-2" value={personId} onChange={(e) => setPersonId(e.target.value)}>
              {candidates.map((p) => (
                <option key={p.id} value={p.id}>
                  No.{p.number} {p.name}
                  {p.kana ? `（${p.kana}）` : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            やめる
          </Button>
          <Button
            type="button"
            disabled={!personId || pending}
            onClick={() => {
              setPending(true);
              void onMatch(personId).finally(() => setPending(false));
            }}
          >
            当てる
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
