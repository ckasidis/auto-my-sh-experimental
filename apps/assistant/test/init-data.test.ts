import { createHmac } from "node:crypto";
import { describe, expect, it } from "vite-plus/test";
import { verifyInitData } from "../src/init-data.ts";

const BOT_TOKEN = "123456:test-token";
const NOW = Date.parse("2026-10-31T12:00:00Z");

/** `initData` signed the way Telegram signs it, for `botToken`. */
function signedInitData(fields: Record<string, string>, botToken = BOT_TOKEN): string {
  const dataCheckString = Object.entries(fields)
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secret).update(dataCheckString).digest("hex");

  return new URLSearchParams({ ...fields, hash }).toString();
}

const launch = (authDate = NOW / 1000) => ({
  auth_date: String(authDate),
  query_id: "AAH",
  user: JSON.stringify({ id: 42, first_name: "Owner" }),
  signature: "ed25519-signature",
});

describe("Mini App initData", () => {
  it("returns the user Telegram signed it for", async () => {
    expect(await verifyInitData(signedInitData(launch()), BOT_TOKEN, NOW)).toBe("42");
  });

  it("refuses data signed with another bot's token", async () => {
    expect(await verifyInitData(signedInitData(launch(), "999:other"), BOT_TOKEN, NOW)).toBeNull();
  });

  it("refuses data changed after signing", async () => {
    const tampered = new URLSearchParams(signedInitData(launch()));
    tampered.set("user", JSON.stringify({ id: 7 }));

    expect(await verifyInitData(tampered.toString(), BOT_TOKEN, NOW)).toBeNull();
  });

  it("refuses a launch older than a day", async () => {
    const old = signedInitData(launch(NOW / 1000 - 25 * 60 * 60));

    expect(await verifyInitData(old, BOT_TOKEN, NOW)).toBeNull();
  });

  it("refuses missing or malformed data", async () => {
    expect(await verifyInitData("", BOT_TOKEN, NOW)).toBeNull();
    expect(await verifyInitData("hash=zz", BOT_TOKEN, NOW)).toBeNull();

    const { user: _user, ...withoutUser } = launch();

    expect(await verifyInitData(signedInitData(withoutUser), BOT_TOKEN, NOW)).toBeNull();
  });
});
