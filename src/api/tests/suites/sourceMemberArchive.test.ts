import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
    default: {
        workspace: {
            workspaceFolders: undefined,
        },
    },
    workspace: {
        workspaceFolders: undefined,
    },
}));

import { archiveSourceMemberSnapshot, listSourceMemberSnapshots, listSourceMemberSnapshotsMatching, readSourceMemberSnapshot } from "../../../filesystems/qsys/sourceMemberArchive";

type MockConnection = {
    currentConnectionName: string;
    currentHost: string;
    getConfig: () => {
        sourceMemberSaveArchiveEnabled?: boolean;
        sourceMemberSaveArchivePath?: string;
        sourceMemberSaveArchiveMaxFiles?: number;
    };
    parserMemberPath: (value: string) => {
        library: string;
        file: string;
        name: string;
        extension: string;
    };
};

type MockMemberPath = ReturnType<MockConnection["parserMemberPath"]>;

const createdDirs: string[] = [];

function createMockConnection(rootPath: string, overrides?: Partial<ReturnType<MockConnection["getConfig"]>>, parserOverrides?: Partial<MockMemberPath>): MockConnection {
    return {
        currentConnectionName: "TEST_CONN",
        currentHost: "test.host",
        getConfig: () => ({
            sourceMemberSaveArchiveEnabled: true,
            sourceMemberSaveArchivePath: rootPath,
            sourceMemberSaveArchiveMaxFiles: 25,
            ...overrides,
        }),
        parserMemberPath: () => ({
            library: "QGPL",
            file: "QRPGLESRC",
            name: "HELLO",
            extension: "RPGLE",
            ...parserOverrides,
        }),
    };
}

function createMemberUri() {
    return { path: "/QGPL/QRPGLESRC/HELLO.RPGLE" } as any;
}

async function newTempDir() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "c4i-archive-test-"));
    createdDirs.push(dir);
    return dir;
}

async function delay(ms: number) {
    await new Promise(resolve => setTimeout(resolve, ms));
}

afterEach(async () => {
    await Promise.all(createdDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

describe("sourceMemberArchive", () => {
    it("writes and reads a snapshot", async () => {
        const rootPath = await newTempDir();
        const connection = createMockConnection(rootPath);
        const uri = createMemberUri();

        const snapshotPath = await archiveSourceMemberSnapshot({
            connection: connection as any,
            uri,
            body: "line 1\nline 2",
            reason: "save-before-write",
            sourceDates: ["240101", "240102"],
            languageId: "cl",
        });

        expect(snapshotPath).toBeTruthy();

        const snapshot = await readSourceMemberSnapshot(snapshotPath!);
        expect(snapshot.library).toBe("QGPL");
        expect(snapshot.file).toBe("QRPGLESRC");
        expect(snapshot.member).toBe("HELLO");
        expect(snapshot.extension).toBe("RPGLE");
        expect(snapshot.languageId).toBe("cl");
        expect(snapshot.body).toBe("line 1\nline 2");
        expect(snapshot.reason).toBe("save-before-write");
        expect(snapshot.sourceDates).toEqual(["240101", "240102"]);
        expect(snapshot.rows).toEqual([
            { srcdat: "240101", srcdta: "line 1" },
            { srcdat: "240102", srcdta: "line 2" },
        ]);

        const raw = JSON.parse(await fs.readFile(snapshotPath!, "utf8")) as { rows?: unknown[]; body?: string };
        expect(Array.isArray(raw.rows)).toBe(true);
        expect(raw.body).toBeUndefined();
    });

    it("returns undefined when archive is disabled", async () => {
        const rootPath = await newTempDir();
        const connection = createMockConnection(rootPath, { sourceMemberSaveArchiveEnabled: false });

        const snapshotPath = await archiveSourceMemberSnapshot({
            connection: connection as any,
            uri: createMemberUri(),
            body: "line 1",
            reason: "save-before-write",
        });

        expect(snapshotPath).toBeUndefined();
    });

    it("lists snapshots in reverse chronological order", async () => {
        const rootPath = await newTempDir();
        const connection = createMockConnection(rootPath);
        const uri = createMemberUri();

        await archiveSourceMemberSnapshot({
            connection: connection as any,
            uri,
            body: "old",
            reason: "save-before-write",
        });

        await delay(5);

        await archiveSourceMemberSnapshot({
            connection: connection as any,
            uri,
            body: "new",
            reason: "save-before-write",
        });

        const snapshots = await listSourceMemberSnapshots(connection as any, uri);
        expect(snapshots.length).toBe(2);

        const newest = await readSourceMemberSnapshot(snapshots[0].filePath);
        const oldest = await readSourceMemberSnapshot(snapshots[1].filePath);
        expect(newest.body).toBe("new");
        expect(oldest.body).toBe("old");
    });

    it("finds snapshots across the archive tree by member metadata", async () => {
        const rootPath = await newTempDir();
        const connection = createMockConnection(rootPath);
        const otherConnection = createMockConnection(rootPath, undefined, {
            library: "QSYSINC",
            file: "QCMDSRC",
            name: "OTHER",
            extension: "CLLE",
        });

        await archiveSourceMemberSnapshot({
            connection: connection as any,
            uri: createMemberUri(),
            body: "hello",
            reason: "save-before-write",
        });

        await archiveSourceMemberSnapshot({
            connection: otherConnection as any,
            uri: createMemberUri(),
            body: "other",
            reason: "manual-restore",
        });

        const snapshots = await listSourceMemberSnapshotsMatching(connection as any, "QSYSINC OTHER manual-restore");
        expect(snapshots).toHaveLength(1);
        expect(snapshots[0].library).toBe("QSYSINC");
        expect(snapshots[0].member).toBe("OTHER");
        expect(snapshots[0].reason).toBe("manual-restore");
    });

    it("enforces retention limit per member", async () => {
        const rootPath = await newTempDir();
        const connection = createMockConnection(rootPath, { sourceMemberSaveArchiveMaxFiles: 2 });
        const uri = createMemberUri();

        await archiveSourceMemberSnapshot({ connection: connection as any, uri, body: "v1", reason: "save-before-write" });
        await delay(5);
        await archiveSourceMemberSnapshot({ connection: connection as any, uri, body: "v2", reason: "save-before-write" });
        await delay(5);
        await archiveSourceMemberSnapshot({ connection: connection as any, uri, body: "v3", reason: "save-before-write" });

        const snapshots = await listSourceMemberSnapshots(connection as any, uri);
        expect(snapshots.length).toBe(2);

        const bodies = await Promise.all(snapshots.map(async entry => (await readSourceMemberSnapshot(entry.filePath)).body));
        expect(bodies).toContain("v3");
        expect(bodies).toContain("v2");
        expect(bodies).not.toContain("v1");
    });

    it("round-trips very large member content", async () => {
        const rootPath = await newTempDir();
        const connection = createMockConnection(rootPath);
        const uri = createMemberUri();

        const lineCount = 100_000;
        const largeBody = Array.from({ length: lineCount }, (_, index) => `line ${index + 1}`).join("\n");

        const snapshotPath = await archiveSourceMemberSnapshot({
            connection: connection as any,
            uri,
            body: largeBody,
            reason: "save-before-write",
        });

        expect(snapshotPath).toBeTruthy();

        const snapshot = await readSourceMemberSnapshot(snapshotPath!);
        expect(snapshot.body.length).toBe(largeBody.length);
        expect(snapshot.body).toBe(largeBody);
        expect(snapshot.rows.length).toBe(lineCount);
    });
});
