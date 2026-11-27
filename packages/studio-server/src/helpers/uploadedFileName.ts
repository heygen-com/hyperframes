/** The name an uploaded file is saved under: the last component of the name the browser sent (it may carry a
 * folder), or null when there is nothing safe to save it as. */
export function uploadedFileName(sent: string): string | null {
  const name = sent.split("/").pop()?.split("\\").pop() ?? "";
  if (!name || name.includes("\0") || name.includes("..")) return null;
  return name;
}
