import { describe, expect, it, vi } from "vitest";
import { fakeWorld } from "../test-support";
import { createApp } from "./app";
import { httpFreelancePorts } from "./remote-ports";

fakeWorld();
const token = "test-token";
const app = createApp({ serviceToken: token });
const user = "11111111-1111-4111-8111-111111111111";
const auth = { authorization: `Bearer ${token}` };
const call = (path: string, init: RequestInit = {}) => app(new Request(`http://freelance${path}`, init));

describe("freelance http", () => {
  it("serves health without a token and refuses a missing one", async () => {
    expect((await call("/health")).status).toBe(200);
    expect((await call("/v1/open-tasks")).status).toBe(401);
  });
  it("needs the person for personal routes", async () => {
    const res = await call("/v1/seller", { method: "POST", headers: auth, body: JSON.stringify({ accepting: true }) });
    expect(res.status).toBe(401);
  });
  it("rejects bad bodies before any write", async () => {
    const headers = { ...auth, "x-user-id": user };
    expect((await call("/v1/seller", { method: "POST", headers, body: "{bad" })).status).toBe(400);
    expect(
      (await call(`/v1/proposals/${user}`, { method: "POST", headers, body: JSON.stringify({ action: "steal" }) })).status,
    ).toBe(400);
  });
  it("answers 404 for a bad id and unknown routes", async () => {
    const headers = { ...auth, "x-user-id": user };
    expect((await call("/v1/orders/nope", { headers })).status).toBe(404);
    expect((await call("/v1/nothing", { headers: auth })).status).toBe(404);
  });
});

describe("remote ports", () => {
  it("maps storefronts, keeps an owner's 4xx and swallows notice failures", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const op = String(url).split("/").pop();
      if (op === "seller-storefronts")
        return Response.json({ result: [{ userId: user, displayName: "Ada L.", headline: null, timezone: null }] });
      if (op === "rate-limit") return Response.json({ error: { code: "RATE_LIMITED", message: "slow" } }, { status: 429 });
      return new Response("down", { status: 503 });
    });
    const ports = httpFreelancePorts({
      platform: { url: "http://p/", token: "t" },
      cryptoCheckout: false,
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect((await ports.sellerStorefronts([user])).get(user)?.displayName).toBe("Ada L.");
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe("http://p/api/internal/freelance/seller-storefronts");
    expect(await ports.sellerStorefronts([])).toEqual(new Map());
    await expect(ports.rateLimit("report", user)).rejects.toMatchObject({ status: 429, code: "RATE_LIMITED" });
    await expect(ports.audit({ actorId: user, action: "a", entityType: "x" })).rejects.toThrow("503");
    await expect(ports.notify("x", [user], {})).resolves.toBeUndefined();
    expect(ports.cryptoCheckoutOn()).toBe(false);
  });
});
