import { describe, expect, it, vi } from "vitest";
import IBMi from "./IBMi";

describe("IBMi.runSQL", () => {
  it("serializes concurrent requests for the same SQL job", async () => {
    const connection = new IBMi();
    const executionOrder: string[] = [];
    let releaseFirst!: () => void;
    let firstStarted!: () => void;
    const firstComplete = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    const firstStartedPromise = new Promise<void>(resolve => {
      firstStarted = resolve;
    });

    (connection as any).sqlJob = {
      query: vi.fn((statement: string) => ({
        close: vi.fn(),
        execute: async () => {
          executionOrder.push(`${statement}:start`);
          if (statement === "SELECT FIRST") {
            firstStarted();
            await firstComplete;
          }
          executionOrder.push(`${statement}:end`);
          return { has_results: true, data: [], update_count: 0 };
        },
      })),
    };

    const first = connection.runSQL("SELECT FIRST");
    const second = connection.runSQL("SELECT SECOND");
    await firstStartedPromise;

    expect(executionOrder).toEqual(["SELECT FIRST:start"]);

    releaseFirst();
    await Promise.all([first, second]);

    expect(executionOrder).toEqual([
      "SELECT FIRST:start",
      "SELECT FIRST:end",
      "SELECT SECOND:start",
      "SELECT SECOND:end",
    ]);
  });
});