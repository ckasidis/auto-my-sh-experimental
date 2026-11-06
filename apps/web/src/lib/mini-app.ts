import { launchData } from "@/lib/telegram";

/**
 * A Mini App's route loader: whether it runs in Telegram, after loading the collections it shows. Telegram's `initData`,
 * which every call is authorized with, exists only in the client, and so do collections, so the routes skip SSR.
 */
export async function loadMiniApp(
  collections: readonly { preload(): Promise<void> }[],
): Promise<{ readonly inTelegram: boolean }> {
  const inTelegram = launchData() !== "";

  if (inTelegram) await Promise.all(collections.map((collection) => collection.preload()));

  return { inTelegram };
}
