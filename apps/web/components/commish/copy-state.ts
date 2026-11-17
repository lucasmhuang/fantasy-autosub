// How long "Copied" (or "Can't copy") shows before the button reads "Copy" again (IF-DETAIL-10).
export const COPIED_FOR_MS = 1500;

// Copies a value and says so on the button, then puts "Copy" back. A browser that refuses the
// clipboard (no permission, an insecure page) says "Can't copy" instead.
export async function copyValue(
  text: string,
  { write, show }: { write: (text: string) => Promise<void>; show: (label: string) => void }
): Promise<void> {
  try {
    await write(text);
    show("Copied");
  } catch (error) {
    if (!(error instanceof DOMException)) throw error;
    show("Can't copy");
  }
  setTimeout(() => show("Copy"), COPIED_FOR_MS);
}
