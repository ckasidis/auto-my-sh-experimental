import { Type } from "typebox";
import { Value } from "typebox/value";

/** How long a Mini App launch stays valid; Telegram signs `initData` once, when the app opens. */
const MAX_AGE_SECONDS = 24 * 60 * 60;

/** The part of `initData.user` the app reads. */
const LaunchUser = Type.Object({ id: Type.Integer() });

const encoder = new TextEncoder();

const hmacKey = (secret: BufferSource) =>
  crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);

const hexBytes = (hex: string): Uint8Array<ArrayBuffer> | null => {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) return null;

  return new Uint8Array(hex.match(/../g)!.map((pair) => Number.parseInt(pair, 16)));
};

/**
 * The Telegram user id `initData` was signed for, or null when it is not Telegram's, is older than a day, or names no
 * user. Telegram signs every field but `hash` with a key derived from the bot token
 * (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app); `crypto.subtle.verify` compares
 * the signatures in constant time.
 */
export async function verifyInitData(
  initData: string,
  botToken: string,
  now: number,
): Promise<string | null> {
  const params = new URLSearchParams(initData);
  const hash = hexBytes(params.get("hash") ?? "");

  if (hash === null) return null;
  params.delete("hash");

  const dataCheckString = [...params]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secret = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(encoder.encode("WebAppData")),
    encoder.encode(botToken),
  );

  const signed = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    hash,
    encoder.encode(dataCheckString),
  );

  if (!signed) return null;

  const authDate = Number(params.get("auth_date"));

  if (!Number.isSafeInteger(authDate) || now / 1000 - authDate > MAX_AGE_SECONDS) return null;

  let user: ReturnType<typeof JSON.parse>;

  try {
    user = JSON.parse(params.get("user") ?? "null");
  } catch {
    return null;
  }

  return Value.Check(LaunchUser, user) ? String(user.id) : null;
}
