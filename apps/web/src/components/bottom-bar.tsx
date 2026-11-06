import { createContext, type ReactNode, useContext } from "react";
import { createPortal } from "react-dom";

/** Where the open tab's action goes: the top of the bar pinned to the bottom of the screen, above the tabs. */
export const BottomSlot = createContext<HTMLElement | null>(null);

/**
 * Pins its children (a tab's main input or button) to the bottom of the screen, within thumb's reach, above the tab
 * bar. Only the open tab's is shown: an inactive tab's content is not mounted.
 */
export function BottomAction({ children }: { readonly children: ReactNode }) {
  const slot = useContext(BottomSlot);

  return slot === null ? null : createPortal(children, slot);
}
