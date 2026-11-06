/**
 * Whether another item on the list has this name, ignoring case and surrounding spaces. The server keeps one
 * ingredient, category, and exercise per name, so forms refuse a name already on the list.
 */
export const nameTaken = (
  name: string,
  existing: readonly { readonly id: string; readonly name: string }[],
  except?: string,
) =>
  existing.some(
    (item) => item.id !== except && item.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );
