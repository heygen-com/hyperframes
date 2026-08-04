import { describe, expect, it } from "vitest";
import {
  createMemoryExternalConflictStorage,
  type ExternalConflictSnapshot,
} from "./externalConflictStorage";

describe("external conflict snapshots", () => {
  it("durably records both complete file versions before resolution", async () => {
    const storage = createMemoryExternalConflictStorage();
    const snapshot: ExternalConflictSnapshot = {
      kind: "conflict",
      projectId: "project-a",
      filePath: "index.html",
      externalVersion: "v2",
      externalContent: "external full file",
      studioContent: "studio full file",
      createdAt: 100,
    };

    await storage.set(snapshot);
    expect(await storage.get("project-a", "index.html")).toEqual(snapshot);
    await storage.delete("project-a", "index.html");
    expect(await storage.get("project-a", "index.html")).toBeNull();
  });

  it("records a failed final Studio candidate for remount recovery", async () => {
    const storage = createMemoryExternalConflictStorage();
    const snapshot: ExternalConflictSnapshot = {
      kind: "failed",
      projectId: "project-a",
      filePath: "index.html",
      externalVersion: null,
      externalContent: null,
      studioContent: "recover me",
      failureMessage: "network unavailable",
      createdAt: 101,
    };

    await storage.set(snapshot);
    expect(await storage.get("project-a", "index.html")).toEqual(snapshot);
  });
});
