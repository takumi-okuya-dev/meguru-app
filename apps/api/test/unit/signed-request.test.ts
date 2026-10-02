import { describe, expect, it } from "vitest";
import { SignedRequestError, verifySignedRequest } from "../../src/lib/signed-request";
import { makeSignedRequest } from "../helpers/signed-request";

const SECRET = "app-secret";

describe("signed_request の検証（research.md R7）", () => {
  it("正しい署名なら user_id と issued_at を返す", async () => {
    const sr = await makeSignedRequest(SECRET, { user_id: "123", issued_at: 1_790_000_000 });
    const payload = await verifySignedRequest(sr, SECRET);
    expect(payload.userId).toBe("123");
    expect(payload.issuedAt?.getTime()).toBe(1_790_000_000 * 1000);
  });

  it("issued_at がなければ undefined", async () => {
    const sr = await makeSignedRequest(SECRET, { user_id: "123" });
    expect((await verifySignedRequest(sr, SECRET)).issuedAt).toBeUndefined();
  });

  it("署名が違えば例外", async () => {
    const sr = await makeSignedRequest("other-secret", { user_id: "123" });
    await expect(verifySignedRequest(sr, SECRET)).rejects.toBeInstanceOf(SignedRequestError);
  });

  it("形式が壊れていれば例外", async () => {
    await expect(verifySignedRequest("garbage", SECRET)).rejects.toBeInstanceOf(SignedRequestError);
  });
});
