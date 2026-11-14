// 手伝う人の受付（/collect/r/:token。ログインなし。specs/collect/001-event-day-collection User Story 3、FR-071・FR-073・FR-075、tasks.md T052）。
// 名前を入れる → 受付だけの画面（サイドバーなし。名簿の編集・締めの入口は出さない）。端末の印はリンクごとにブラウザへ保存し、
// 同じ端末で開き直したら続きから。同じ名前の人がいたら「同じ人ですか？」と聞く。リンクが止められたら画面を止める。
import { RECEPTION_LIMITS, type ReceptionSnapshot } from "@meguru/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatJstShort, formatJstWithWeekday } from "@/lib/format";
import { CenteredLayout } from "@/shell";
import { ReceptionBoard } from "../components/reception/ReceptionBoard";
import { forgetDevice, loadDevice, saveDevice, type StoredDevice } from "../lib/device-store";
import { collectErrorText } from "../lib/errors";
import { HelperApiError, helperApi } from "../lib/helper-api";
import { collectQueryKeys } from "../lib/query-keys";
import { useReception, type ReceptionSource } from "../lib/use-reception";

/**
 * 案内だけの画面（止められた・使えないリンク）。
 * @param props - title：見出し、children：本文
 * @returns 画面
 */
function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <CenteredLayout>
      <div className="max-w-sm space-y-2 text-center">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{children}</p>
      </div>
    </CenteredLayout>
  );
}

/**
 * 名前を入れて受付を始める。
 * @param props - token：受付用リンク、eventName：イベントの名前、onJoined：始められた
 * @returns 画面
 */
function JoinForm({ token, eventName, onJoined }: { token: string; eventName: string; onJoined: (device: StoredDevice) => void }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taken, setTaken] = useState<{ helperId: string; joinedAt: string } | null>(null);

  const join = async (extra: { sameAsHelperId?: string; asNew?: boolean } = {}) => {
    setSaving(true);
    setError(null);
    try {
      const res = await helperApi.join(token, { name: name.trim(), ...extra });
      onJoined({ helperId: res.helperId, deviceSecret: res.deviceSecret, name: name.trim() });
    } catch (err) {
      if (err instanceof HelperApiError && err.code === "HELPER_NAME_TAKEN") {
        setTaken({ helperId: String(err.extra.helperId ?? ""), joinedAt: String(err.extra.joinedAt ?? "") });
      } else {
        setError(collectErrorText(err));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <CenteredLayout>
      <form
        className="w-full max-w-sm space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() && !saving) void join();
        }}
      >
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">{eventName}の受付</h1>
          <p className="text-sm text-muted-foreground">あなたの名前を入れてください。主催者の画面に、だれが受け取ったかが出ます。</p>
        </div>
        <Input aria-label="あなたの名前" placeholder="例：井上" value={name} maxLength={RECEPTION_LIMITS.helperName} autoFocus onChange={(e) => setName(e.target.value)} />
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" className="h-11 w-full" disabled={!name.trim() || saving}>
          受付を始める
        </Button>
      </form>
      {taken && (
        <Dialog open onOpenChange={(v) => !v && setTaken(null)}>
          <DialogContent className="sm:max-w-sm" aria-describedby="taken-desc">
            <DialogTitle>すでに{name.trim()}さんがいます。同じ人ですか？</DialogTitle>
            <DialogDescription id="taken-desc">
              {taken.joinedAt ? `${formatJstShort(taken.joinedAt)}に入った${name.trim()}さんがいます。` : ""}
              別の端末から続けるなら「同じ人」、別の人なら「別の人」を選んでください。
            </DialogDescription>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                className="h-11"
                disabled={saving}
                onClick={() => {
                  const id = taken.helperId;
                  setTaken(null);
                  void join({ sameAsHelperId: id });
                }}
              >
                同じ人
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11"
                disabled={saving}
                onClick={() => {
                  setTaken(null);
                  void join({ asNew: true });
                }}
              >
                別の人
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </CenteredLayout>
  );
}

/**
 * 手伝う人の受付の画面。
 * @returns 画面
 */
export function HelperReceptionPage() {
  const { token = "" } = useParams<{ token: string }>();
  const info = useQuery({ queryKey: collectQueryKeys.helperInfo(token), queryFn: () => helperApi.info(token), retry: false });
  const [device, setDevice] = useState<StoredDevice | null>(() => loadDevice(token));
  const [stopped, setStopped] = useState(false);
  const secret = device?.deviceSecret ?? "";
  const source = useMemo<ReceptionSource>(
    () => ({
      queryKey: collectQueryKeys.helperReception(token),
      viewer: { kind: "helper", helperId: device?.helperId ?? "" },
      snapshot: () => helperApi.reception(token, secret),
      record: (personId, input) => helperApi.record(token, secret, personId, input),
      undo: (personId) => helperApi.undo(token, secret, personId),
      walkIn: (input) => helperApi.walkIn(token, secret, input),
      confirm: (personId, input) => helperApi.confirm(token, secret, personId, input),
      resolveRequest: (requestId, action, personId) => helperApi.resolveRequest(token, secret, requestId, action, personId),
      removeEntry: (personId) => helperApi.removeEntry(token, secret, personId),
      liveTicket: () => helperApi.liveTicket(token, secret),
      onLinkStopped: () => setStopped(true),
    }),
    [token, secret, device?.helperId],
  );
  const active = info.data?.status === "active" && !stopped;
  const state = useReception(source, Boolean(device) && active);
  const failure = state.snapshot.error;

  // 端末の印が合わない（消された・ほかのリンクの印）なら、名前を入れ直す。リンクが止められたら画面を止める
  useEffect(() => {
    if (!(failure instanceof HelperApiError)) return;
    if (failure.code === "DEVICE_REQUIRED") {
      forgetDevice(token);
      setDevice(null);
    }
    if (failure.code === "LINK_INACTIVE") setStopped(true);
  }, [failure, token]);

  if (info.isPending) return <LoadingSkeleton />;
  if (info.isError) return <Notice title="このリンクは使えません">リンクが正しいか、主催者に確かめてください。</Notice>;
  if (stopped || info.data.status === "stopped") return <Notice title="このリンクは止められました">受付を続けるときは、主催者に新しいリンクをもらってください。</Notice>;
  if (info.data.status === "expired") return <Notice title="このリンクは期限が過ぎました">受付を続けるときは、主催者に新しいリンクをもらってください。</Notice>;
  if (!device) {
    return (
      <JoinForm
        token={token}
        eventName={info.data.event.name}
        onJoined={(d) => {
          saveDevice(token, d);
          setDevice(d);
        }}
      />
    );
  }
  if (state.snapshot.isPending) return <LoadingSkeleton />;
  if (state.snapshot.isLoadingError) {
    return (
      <Notice title="受付の名簿を読めませんでした">
        {collectErrorText(failure)}{" "}
        <Button type="button" variant="link" className="h-auto p-0" onClick={() => void state.snapshot.refetch()}>
          もう一度読む
        </Button>
      </Notice>
    );
  }
  const snap: ReceptionSnapshot = state.snapshot.data;
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-4">
      <header className="min-w-0">
        <h1 className="truncate text-lg font-semibold">{snap.event.name}の受付</h1>
        <p className="text-sm text-muted-foreground">
          {formatJstWithWeekday(snap.event.startsAt)}
          {snap.event.venue ? `・${snap.event.venue}` : ""}・{device.name}さん
        </p>
      </header>
      <ReceptionBoard state={state} snap={snap} qrKey={collectQueryKeys.helperPaypayQr(token)} loadQr={() => helperApi.paypayQr(token, secret)} />
    </div>
  );
}
