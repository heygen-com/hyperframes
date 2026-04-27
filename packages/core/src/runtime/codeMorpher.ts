export interface DiffLine {
  text: string;
  type: "added" | "removed" | "unchanged";
}

export class CodeMorpher {
  /**
   * Compares two code strings line-by-line and produces a list of diff operations.
   *
   * **Semantics:** This is a greedy forward-scan heuristic, NOT a minimal LCS diff.
   * It prioritises preserving order for animation purposes (smooth slide-up/down
   * of consecutive lines) over producing the theoretically smallest edit set.
   *
   * For each position it checks:
   * 1. If both cursors point at identical lines → `unchanged`.
   * 2. If the new line doesn't appear anywhere ahead in the old text → `added`.
   * 3. If the old line doesn't appear anywhere ahead in the new text → `removed`.
   * 4. Otherwise both lines are present but reordered → emit `removed` + `added`.
   *
   * Trade-off: O(n·m) lookahead in the worst case (same as LCS), but with much
   * lower constant factor for the common case of small, localised edits. If a
   * minimal diff is required, replace this with a proper Myers/patience algorithm.
   */
  public static diff(oldCode: string, newCode: string): DiffLine[] {
    const oldLines = oldCode.split("\n");
    const newLines = newCode.split("\n");
    const result: DiffLine[] = [];

    let oldIdx = 0;
    let newIdx = 0;

    // Greedy forward-scan heuristic
    while (oldIdx < oldLines.length || newIdx < newLines.length) {
      const oldLine: string | undefined = oldLines[oldIdx];
      const newLine: string | undefined = newLines[newIdx];

      if (oldIdx < oldLines.length && newIdx < newLines.length && oldLine === newLine) {
        result.push({ text: oldLine!, type: "unchanged" });
        oldIdx++;
        newIdx++;
      } else if (newIdx < newLines.length && !oldLines.slice(oldIdx).includes(newLine!)) {
        // New line doesn't exist anywhere ahead in the old text
        result.push({ text: newLine!, type: "added" });
        newIdx++;
      } else if (oldIdx < oldLines.length && !newLines.slice(newIdx).includes(oldLine!)) {
        // Old line doesn't exist anywhere ahead in the new text
        result.push({ text: oldLine!, type: "removed" });
        oldIdx++;
      } else {
        // If both exist ahead but out of order, just remove old and add new
        if (oldIdx < oldLines.length) {
          result.push({ text: oldLines[oldIdx]!, type: "removed" });
          oldIdx++;
        }
        if (newIdx < newLines.length) {
          result.push({ text: newLines[newIdx]!, type: "added" });
          newIdx++;
        }
      }
    }

    return result;
  }
}
