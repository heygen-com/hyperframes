import { describe, expect, it, vi } from "vitest";
import { getHeapStatistics } from "v8";
import { computeWorkerSizing } from "./parallelCoordinator.js";

vi.mock("os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("os")>()),
  cpus: () =>
    Array.from({ length: 18 }, () => ({
      model: "test",
      speed: 3000,
      times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
    })),
}));
vi.mock("./systemMemory.js", () => ({ getSystemTotalMb: () => 24576 }));
vi.mock("v8", async (importOriginal) => {
  const original = await importOriginal<typeof import("v8")>();
  return { ...original, getHeapStatistics: vi.fn(original.getHeapStatistics) };
});

function withHeapLimit(mb: number): void {
  vi.mocked(getHeapStatistics).mockReturnValueOnce({
    ...getHeapStatistics(),
    heap_size_limit: mb * 1024 * 1024,
  });
}

describe("parent heap worker cap", () => {
  it("caps the reported 18-core/24GB host at four workers with a 4GB heap", () => {
    withHeapLimit(4096);
    const result = computeWorkerSizing(1800);
    expect(result).toMatchObject({
      workers: 4,
      heapBasedWorkers: 4,
      boundBy: "heap",
      exceedsHeapAdvisory: false,
    });
  });

  it("allows one worker below the heap reserve despite the parallel floor", () => {
    withHeapLimit(512);
    expect(computeWorkerSizing(1800)).toMatchObject({ workers: 1, boundBy: "heap" });
  });

  it("keeps the CPU contention cap when the heap has sufficient room", () => {
    withHeapLimit(16384);
    expect(computeWorkerSizing(1800)).toMatchObject({ workers: 6 });
  });

  it("honors explicit workers and retains the exceeded-budget diagnostic", () => {
    withHeapLimit(1024);
    expect(computeWorkerSizing(1800, 6)).toMatchObject({
      workers: 6,
      boundBy: "explicit",
      exceedsHeapAdvisory: true,
    });
  });

  it("does not let configured concurrency bypass the heap budget", () => {
    withHeapLimit(1024);
    expect(computeWorkerSizing(1800, undefined, { concurrency: 12 })).toMatchObject({
      workers: 1,
      boundBy: "heap",
    });
  });
});
