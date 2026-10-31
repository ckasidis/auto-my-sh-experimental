import type { Transaction } from "@tanstack/react-db";
import { useSyncExternalStore } from "react";
import { webApp } from "./telegram";

let failure: string | null = null;
const listeners = new Set<() => void>();

const publish = (message: string | null) => {
  failure = message;

  for (const listener of listeners) listener();
};

/**
 * Follows a write: the collection shows it at once, and when the server refuses it, it rolls back, the phone buzzes
 * and the message is shown until dismissed.
 */
export function follow(transaction: Transaction): void {
  transaction.when("settled").then(
    () => webApp()?.HapticFeedback?.notificationOccurred("success"),
    (error: Error) => {
      webApp()?.HapticFeedback?.notificationOccurred("error");
      publish(error.message);
    },
  );
}

/** The last write the server refused, and a way to dismiss it. */
export function useFailure(): readonly [string | null, () => void] {
  const message = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    () => failure,
    () => null,
  );

  return [message, () => publish(null)];
}
