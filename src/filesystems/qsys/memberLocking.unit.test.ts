import { beforeEach, describe, expect, it, vi } from "vitest";

const { onDidChangeTabs, onDidCloseTextDocument } = vi.hoisted(() => ({
  onDidChangeTabs: vi.fn(),
  onDidCloseTextDocument: vi.fn(),
}));

vi.mock("vscode", () => ({
  default: {
    window: {
      tabGroups: { all: [], onDidChangeTabs },
    },
    workspace: { onDidCloseTextDocument },
    Uri: { parse: (value: string) => ({ toString: () => value }) },
    TabInputText: class TabInputText {},
  },
  window: {
    tabGroups: { all: [], onDidChangeTabs },
  },
  workspace: { onDidCloseTextDocument },
  Uri: { parse: (value: string) => ({ toString: () => value }) },
  TabInputText: class TabInputText {},
}));

import { MemberLockManager } from "./memberLocking";

const uri = {
  scheme: "member",
  path: "/CBALLEST1/QRPGLESRC/COMPSTRG.RPGLE",
  toString: () => "member:/CBALLEST1/QRPGLESRC/COMPSTRG.RPGLE",
} as any;

function createConnection() {
  return {
    appendOutput: vi.fn(),
    parserMemberPath: vi.fn(() => ({ library: "CBALLEST1", file: "QRPGLESRC", name: "COMPSTRG" })),
    runSQL: vi.fn().mockResolvedValue([]),
  } as any;
}

function createContext() {
  return { subscriptions: { push: vi.fn() } } as any;
}

describe("MemberLockManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shares an in-flight acquisition for the same member", async () => {
    const connection = createConnection();
    let resolveCommand: () => void = () => undefined;
    connection.runSQL.mockImplementation(() => new Promise<void>(resolve => { resolveCommand = resolve; }));
    const locks = new MemberLockManager(createContext());

    const first = locks.acquire(uri, connection);
    const second = locks.acquire(uri, connection);
    expect(connection.runSQL).toHaveBeenCalledTimes(1);

    resolveCommand();
    await Promise.all([first, second]);

    expect(connection.runSQL).toHaveBeenCalledWith("@ALCOBJ OBJ((CBALLEST1/QRPGLESRC *FILE *EXCLRD COMPSTRG)) WAIT(0)");
    expect(locks.isLocked(uri, connection)).toBe(true);
  });

  it("releases the same member allocation once", async () => {
    const connection = createConnection();
    const locks = new MemberLockManager(createContext());

    await locks.acquire(uri, connection);
    await locks.release(uri);

    expect(connection.runSQL).toHaveBeenNthCalledWith(2, "@DLCOBJ OBJ((CBALLEST1/QRPGLESRC *FILE *EXCLRD COMPSTRG))");
    expect(locks.isLocked(uri, connection)).toBe(false);
  });
});