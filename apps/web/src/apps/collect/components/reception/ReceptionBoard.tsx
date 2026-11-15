// 受付の画面の中身（specs/collect/001-event-day-collection User Story 2・3、FR-030〜FR-039、tasks.md T042）。
// 主催者の画面と手伝う人の画面で同じものを使う。上に数字の段と会場の共有の状態、検索、受付の行、飛び入り。
// 受付の1人は「探す → 払い方 →（PayPay・振込ならシートの1回）」で終わる（SC-001）。
import { sameNameIds, type ReceptionPerson, type ReceptionRecord, type ReceptionSnapshot } from "@meguru/shared";
import { SearchIcon, UserPlusIcon } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { LiveStatus } from "../../lib/live";
import { isMine, matchesQuery, yen } from "../../lib/reception-model";
import type { RecordChoice, ReceptionState } from "../../lib/use-reception";
import { AdjustDialog, type Adjustment } from "./AdjustDialog";
import { PaypaySheet, TransferSheet } from "./PaySheets";
import { ReceptionRow, type PayButton } from "./ReceptionRow";
import { SelfPanel } from "./SelfPanel";
import { StatsBar } from "./StatsBar";
import { TierChoiceDialog } from "./TierChoiceDialog";
import { WalkInDialog } from "./WalkInDialog";

const LIVE_TEXT: Record<LiveStatus, string> = {
  connecting: "会場の共有につないでいます…",
  live: "会場で共有中（ほかの人の受付がすぐに出ます）",
  offline: "会場の共有につなぎ直しています（その間は15秒ごとに読み直します）",
  stopped: "会場の共有は止まっています",
};

/**
 * 受け取った人の名前（本人の申告は、確かめたら確かめた人の前に「本人の申告→」。specs/collect/002）。
 * @param rec - 受付の記録
 * @param helperName - 手伝う人の名前
 * @returns 名前
 */
function receiverNameOf(rec: ReceptionRecord, helperName: Map<string, string>): string {
  if (rec.receiverKind === "self") return "本人の申告";
  const who = rec.receiverKind === "owner" ? "主催者" : (helperName.get(rec.receiverHelperId ?? "") ?? "手伝う人");
  return rec.selfReported ? `本人の申告→${who}` : who;
}

/**
 * 受付の画面の中身。
 * @param props - state：受付の画面の状態（useReception）、snap：読めたスナップショット、qrKey・loadQr：PayPayのQRの画像の読み方
 * @returns 受付の画面
 */
export function ReceptionBoard({
  state,
  snap,
  qrKey,
  loadQr,
}: {
  state: ReceptionState;
  snap: ReceptionSnapshot;
  qrKey: readonly unknown[];
  loadQr: () => Promise<Blob>;
}) {
  const viewer = state.viewer;
  const [query, setQuery] = useState("");
  const [adjustments, setAdjustments] = useState<Record<string, Adjustment>>({});
  const [adjusting, setAdjusting] = useState<ReceptionPerson | null>(null);
  const [paying, setPaying] = useState<{ person: ReceptionPerson; kind: "paypay" | "transfer" } | null>(null);
  const [undoing, setUndoing] = useState<ReceptionPerson | null>(null);
  const [walkIn, setWalkIn] = useState(false);
  // 区分を選んでから記録する人（名簿なしで区分が未定。specs/collect/004 FR-021）
  const [tierFirst, setTierFirst] = useState<{ person: ReceptionPerson; button: "cash" | "paypay" } | null>(null);
  const [removing, setRemoving] = useState<ReceptionPerson | null>(null);

  const tiers = snap.event.tiers;
  const tierById = new Map(tiers.map((t) => [t.id, t]));
  const helperName = new Map(snap.helpers.map((h) => [h.id, h.name]));
  const buttons: PayButton[] = [...(["cash", "paypay", "transfer"] as const).filter((m) => snap.event.methods.includes(m)), "none"];
  const shown = snap.people.filter((p) => matchesQuery(p.person, query));
  // 名簿なしでは、別の端末から同じ名前が入ったことを知らせる（会場の共有で人が増えても出し直せるよう、画面で数える。research R4）
  const sameName = snap.event.checkInMode === "rosterless" ? sameNameIds(snap.people.map((p) => p.person)) : new Set<string>();
  // 区分が未定で、まだ受付で区分を選んでいない（区分が2つ以上のときだけ）
  const needsTier = (person: ReceptionPerson) => person.tierUndecided && tiers.length > 1 && !adjustments[person.id];

  // 区分・金額（受付で変えたもの。なければ名簿の区分）。
  const adjustmentOf = (person: ReceptionPerson): Adjustment => adjustments[person.id] ?? { priceTierId: person.priceTierId };
  // その人の金額。
  const amountOf = (person: ReceptionPerson) => {
    const a = adjustmentOf(person);
    return a.amount ?? tierById.get(a.priceTierId)?.amount ?? 0;
  };
  // 記録の入力（変えていないときは区分も金額も送らず、APIが名簿の区分で決める）。
  const choiceOf = (person: ReceptionPerson, method: RecordChoice["method"]): RecordChoice => {
    const a = adjustments[person.id];
    return { method, ...(a ? { priceTierId: a.priceTierId, ...(a.amount === undefined ? {} : { amount: a.amount }) } : {}) };
  };
  const record = (person: ReceptionPerson, method: RecordChoice["method"]) => {
    void state.record(person.id, choiceOf(person, method));
    setAdjustments(({ [person.id]: _used, ...rest }) => rest);
    setQuery("");
  };

  return (
    <div className="space-y-4">
      <StatsBar stats={snap.stats} />
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {LIVE_TEXT[state.live]}
      </p>
      <SelfPanel state={state} snap={snap} />
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            aria-label="名前・ふりがな・受付番号で探す"
            placeholder="名前・ふりがな・受付番号で探す"
            className="h-11 pl-9"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Button type="button" variant="outline" className="h-11" onClick={() => setWalkIn(true)}>
          <UserPlusIcon className="size-4" /> 飛び入り
        </Button>
      </div>
      {shown.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {snap.people.length === 0 ? "名簿にまだ人がいません。" : "見つかりません。名簿にいない人は「飛び入り」で足せます。"}
        </p>
      ) : (
        <ul className="space-y-2" aria-label="受付の名簿">
          {shown.map(({ person, record: rec }) => {
            const a = adjustmentOf(person);
            const tier = tierById.get(a.priceTierId);
            return (
              <ReceptionRow
                key={person.id}
                person={person}
                record={rec}
                pending={state.pending[person.id]}
                buttons={buttons}
                tierLabel={needsTier(person) ? "区分を確かめる" : `${tier?.name ?? "区分なし"} ${yen(amountOf(person))}`}
                sameName={sameName.has(person.id)}
                canRemove={person.selfEntered && rec === null && !state.pending[person.id]}
                tierPending={rec !== null && rec.paymentStatus !== "paid" && person.tierUndecided && tiers.length > 1}
                onRemove={() => setRemoving(person)}
                adjusted={Boolean(adjustments[person.id])}
                receiverName={rec ? receiverNameOf(rec, helperName) : null}
                canUndo={rec !== null && (viewer.kind === "owner" || isMine(rec, viewer) || (rec.receiverKind === "self" && rec.transferConfirmedAt === null))}
                onPay={(b) => {
                  if ((b === "cash" || b === "paypay") && needsTier(person)) setTierFirst({ person, button: b });
                  else if (b === "paypay" || b === "transfer") setPaying({ person, kind: b });
                  else record(person, b);
                }}
                onAdjust={() => setAdjusting(person)}
                onRetry={() => state.retry(person.id)}
                onDiscard={() => state.discard(person.id)}
                onUndo={() => setUndoing(person)}
              />
            );
          })}
        </ul>
      )}

      {paying?.kind === "paypay" && (
        <PaypaySheet
          name={paying.person.name}
          number={paying.person.number}
          amount={amountOf(paying.person)}
          hasQr={snap.settings.hasPaypayQr}
          qrKey={qrKey}
          loadQr={loadQr}
          onReceived={() => {
            record(paying.person, "paypay");
            setPaying(null);
          }}
          onClose={() => setPaying(null)}
        />
      )}
      {paying?.kind === "transfer" && (
        <TransferSheet
          name={paying.person.name}
          number={paying.person.number}
          amount={amountOf(paying.person)}
          bankText={snap.settings.bankText}
          onChoose={(method) => {
            record(paying.person, method);
            setPaying(null);
          }}
          onClose={() => setPaying(null)}
        />
      )}
      {adjusting && (
        <AdjustDialog
          title={`No.${adjusting.number} ${adjusting.name}の区分・金額`}
          tiers={tiers}
          value={adjustmentOf(adjusting)}
          onSave={(value) => {
            // 区分が未定の人は、仮の区分と同じものを選んでも「決めた」として持つ
            const unchanged = value.priceTierId === adjusting.priceTierId && value.amount === undefined && !adjusting.tierUndecided;
            setAdjustments(({ [adjusting.id]: _old, ...rest }) => (unchanged ? rest : { ...rest, [adjusting.id]: value }));
            setAdjusting(null);
          }}
          onClose={() => setAdjusting(null)}
        />
      )}
      {tierFirst && (
        <TierChoiceDialog
          title={`No.${tierFirst.person.number} ${tierFirst.person.name}の区分`}
          tiers={tiers}
          onChoose={(priceTierId) => {
            const { person, button } = tierFirst;
            setTierFirst(null);
            setAdjustments((prev) => ({ ...prev, [person.id]: { priceTierId } }));
            if (button === "paypay") setPaying({ person, kind: "paypay" });
            else {
              void state.record(person.id, { method: "cash", priceTierId });
              setAdjustments(({ [person.id]: _used, ...rest }) => rest);
              setQuery("");
            }
          }}
          onClose={() => setTierFirst(null)}
        />
      )}
      {removing && (
        <ConfirmDialog
          title="名簿から外しますか？"
          confirmLabel="名簿から外す"
          destructive
          onConfirm={() => {
            void state.removeEntry(removing.id);
            setRemoving(null);
          }}
          onCancel={() => setRemoving(null)}
        >
          <p>
            No.{removing.number} {removing.name}を名簿から外します（同じ人が二重に入ったときなど）。受付番号は詰めません。
          </p>
        </ConfirmDialog>
      )}
      {undoing && (
        <ConfirmDialog
          title="受付を取り消しますか？"
          confirmLabel="取り消す"
          destructive
          onConfirm={() => {
            void state.undo(undoing.id);
            setUndoing(null);
          }}
          onCancel={() => setUndoing(null)}
        >
          <p>
            No.{undoing.number} {undoing.name}を未受付に戻します。
          </p>
        </ConfirmDialog>
      )}
      {walkIn && (
        <WalkInDialog
          initialName={/^\d+$/.test(query.trim()) ? "" : query.trim()}
          onAdd={async (name, clientRequestId) => {
            const ok = await state.walkIn(name, clientRequestId);
            if (ok) setQuery(name);
            return ok;
          }}
          onClose={() => setWalkIn(false)}
        />
      )}
    </div>
  );
}
