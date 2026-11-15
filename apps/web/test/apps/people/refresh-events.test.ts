// イベントを作ったあとの読み直し（lib/refresh.ts の refreshEvents）。誘う候補は捨てる（誘う会の初めの値を API が選び直すため）。
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { refreshEvents } from "@/apps/people/lib/refresh";
import { peopleQueryKeys } from "@/apps/people/lib/query-keys";

describe("refreshEvents", () => {
  it("誘う候補のキャッシュを捨て、人の一覧は残す", async () => {
    const client = new QueryClient();
    client.setQueryData(peopleQueryKeys.candidates({ purpose: "invite", eventId: "next" }), { persons: [], total: 0, inviteEvent: null });
    client.setQueryData(peopleQueryKeys.events, []);
    client.setQueryData(["people", "persons", "list"], { persons: [], total: 0 });
    await refreshEvents(client);
    expect(client.getQueryData(peopleQueryKeys.candidates({ purpose: "invite", eventId: "next" }))).toBeUndefined();
    expect(client.getQueryData(["people", "persons", "list"])).toBeDefined();
  });
});
