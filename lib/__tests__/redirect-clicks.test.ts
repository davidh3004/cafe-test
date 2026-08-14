import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { reportSeoDegradeMock } = vi.hoisted(() => ({
  reportSeoDegradeMock: vi.fn(),
}));

vi.mock("../seo-report", () => ({
  reportSeoDegrade: reportSeoDegradeMock,
}));

import {
  isBotUserAgent,
  shouldCountClick,
  reportRedirectClick,
} from "../redirect-clicks";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  reportSeoDegradeMock.mockClear();
  vi.restoreAllMocks();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("isBotUserAgent", () => {
  it.each([
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0",
  ])("counts a real browser UA as human: %s", (ua) => {
    expect(isBotUserAgent(ua)).toBe(false);
  });

  it.each([
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
    "facebookexternalhit/1.1",
    "WhatsApp/2.23",
    "Slackbot-LinkExpanding 1.0",
    "Twitterbot/1.0",
    "curl/8.4.0",
    "python-requests/2.31.0",
    "axios/1.6.0",
    "HeadlessChrome/120.0.0.0",
    "Mozilla/5.0 (compatible; YandexBot/3.0)",
  ])("counts a crawler/agent UA as a bot: %s", (ua) => {
    expect(isBotUserAgent(ua)).toBe(true);
  });

  it("treats a missing or empty UA as a bot", () => {
    // Every real browser sends one; the things that don't are scripted.
    expect(isBotUserAgent(null)).toBe(true);
    expect(isBotUserAgent(undefined)).toBe(true);
    expect(isBotUserAgent("")).toBe(true);
    expect(isBotUserAgent("   ")).toBe(true);
  });

  it("does not misclassify Chrome as Googlebot on the bare word 'google'", () => {
    // The Chrome UA contains no "google" token, but a naive /google/ pattern
    // would still catch anything mentioning it — pin the real strings.
    expect(
      isBotUserAgent(
        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
      )
    ).toBe(false);
  });
});

describe("shouldCountClick", () => {
  const human = "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36";

  it("is false whenever tracking is off, whatever the UA", () => {
    expect(shouldCountClick(false, human)).toBe(false);
    expect(shouldCountClick(false, "Googlebot")).toBe(false);
  });

  it("is true only for a tracked rule hit by a non-bot", () => {
    expect(shouldCountClick(true, human)).toBe(true);
    expect(shouldCountClick(true, "Googlebot/2.1")).toBe(false);
    expect(shouldCountClick(true, null)).toBe(false);
  });
});

describe("reportRedirectClick", () => {
  function configure() {
    process.env.CLICK_TRACKING_URL = "https://platform.example.com/api/redirect-clicks";
    process.env.REVALIDATE_SECRET = "s3cret";
    process.env.CLICK_TRACKING_TEAM_ID = "team_1";
  }

  it("POSTs the team id, the source and the shared secret", async () => {
    configure();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    await reportRedirectClick("/u/mab-radio");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://platform.example.com/api/redirect-clicks");
    expect((init?.headers as Record<string, string>)["x-revalidate-secret"]).toBe("s3cret");
    expect(JSON.parse(init?.body as string)).toEqual({
      teamId: "team_1",
      source: "/u/mab-radio",
    });
  });

  it("sends nothing the visitor could be identified by", async () => {
    configure();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    await reportRedirectClick("/u/mab-radio");

    // Counts only — the body's key set is the whole privacy contract.
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(Object.keys(body).sort()).toEqual(["source", "teamId"]);
  });

  it.each([
    ["no endpoint", "CLICK_TRACKING_URL"],
    ["no secret", "REVALIDATE_SECRET"],
    ["no team id", "CLICK_TRACKING_TEAM_ID"],
  ])("silently no-ops with %s, without reporting a degrade", async (_label, key) => {
    configure();
    delete process.env[key];
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await reportRedirectClick("/u/mab-radio");

    // An unprovisioned tenant is an expected state, not a failure — the same
    // posture redirect-resolve takes for an absent Strapi URL.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(reportSeoDegradeMock).not.toHaveBeenCalled();
  });

  it("never rejects when the beacon fetch throws, and reports the degrade", async () => {
    configure();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));

    await expect(reportRedirectClick("/u/mab-radio")).resolves.toBeUndefined();
    expect(reportSeoDegradeMock).toHaveBeenCalledWith(
      "redirect-click-report-failed",
      "middleware",
      expect.objectContaining({ source: "/u/mab-radio" })
    );
  });

  it("never rejects on a non-ok response, and reports the degrade", async () => {
    configure();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    await expect(reportRedirectClick("/u/mab-radio")).resolves.toBeUndefined();
    expect(reportSeoDegradeMock).toHaveBeenCalledWith(
      "redirect-click-report-failed",
      "middleware",
      expect.objectContaining({ status: 500 })
    );
  });
});
