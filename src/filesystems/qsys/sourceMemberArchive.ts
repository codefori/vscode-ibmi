import fs from "fs/promises";
import os from "os";
import path from "path";
import vscode from "vscode";
import IBMi from "../../api/IBMi";

const ARCHIVE_VERSION = 1;
const DEFAULT_ARCHIVE_ROOT = "~/.code-for-ibmi/source-archive";
const DEFAULT_MAX_SNAPSHOTS = 25;

type SourceArchiveSnapshotRow = {
    srcdat: string;
    srcdta: string;
};

type SourceArchiveSnapshotFile = {
    version: number;
    createdAt: string;
    connectionName: string;
    memberPath: string;
    library: string;
    file: string;
    member: string;
    extension: string;
    languageId?: string;
    reason: string;
    rows: SourceArchiveSnapshotRow[];
};

export type SourceArchiveSnapshot = SourceArchiveSnapshotFile & {
    body: string;
    sourceDates: string[];
};

export type SourceArchiveSnapshotInfo = {
    filePath: string;
    createdAt: string;
    reason: string;
    memberLabel: string;
    library: string;
    file: string;
    member: string;
    extension: string;
    memberPath: string;
};

interface ArchiveSettings {
    enabled: boolean;
    rootPath: string;
    maxSnapshots: number;
}

interface ArchiveSourceMemberOptions {
    connection: IBMi;
    uri: vscode.Uri;
    body: string;
    reason: string;
    sourceDates?: string[];
    languageId?: string;
}

function toRows(body: string, sourceDates?: string[]): SourceArchiveSnapshotRow[] {
    const lines = body.split(`\n`);
    return lines.map((line, index) => ({
        srcdat: String(sourceDates?.[index] || `0`),
        srcdta: line,
    }));
}

function fromRows(rows: SourceArchiveSnapshotRow[]) {
    return {
        body: rows.map(row => row.srcdta).join(`\n`),
        sourceDates: rows.map(row => String(row.srcdat || `0`)),
    };
}

function sanitizePathSegment(value: string): string {
    return value.replace(/[^A-Za-z0-9_.-]/g, "_");
}

function resolveArchiveRoot(rawPath: string): string {
    const trimmedPath = (rawPath || "").trim();
    const configuredPath = trimmedPath || DEFAULT_ARCHIVE_ROOT;

    if (configuredPath.startsWith("~/")) {
        return path.join(os.homedir(), configuredPath.substring(2));
    }

    if (path.isAbsolute(configuredPath)) {
        return configuredPath;
    }

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return path.resolve(workspaceRoot || os.homedir(), configuredPath);
}

function getArchiveSettings(connection: IBMi): ArchiveSettings {
    const config = connection.getConfig();
    const enabled = config.sourceMemberSaveArchiveEnabled !== false;

    const configuredPath = typeof config.sourceMemberSaveArchivePath === "string"
        ? config.sourceMemberSaveArchivePath
        : DEFAULT_ARCHIVE_ROOT;

    const configuredMax = Number(config.sourceMemberSaveArchiveMaxFiles);
    const maxSnapshots = Number.isFinite(configuredMax) && configuredMax > 0
        ? Math.floor(configuredMax)
        : DEFAULT_MAX_SNAPSHOTS;

    return {
        enabled,
        rootPath: resolveArchiveRoot(configuredPath),
        maxSnapshots,
    };
}

function getMemberArchiveDirectory(connection: IBMi, uri: vscode.Uri, rootPath: string): string {
    const memberParts = connection.parserMemberPath(uri.path);
    const connectionFolder = sanitizePathSegment(connection.currentConnectionName || connection.currentHost || "connection");
    const memberFolder = `${sanitizePathSegment(memberParts.name)}.${sanitizePathSegment(memberParts.extension || "NONE")}`;

    return path.join(
        rootPath,
        connectionFolder,
        sanitizePathSegment(memberParts.library),
        sanitizePathSegment(memberParts.file),
        memberFolder
    );
}

function getMemberPath(connection: IBMi, uri: vscode.Uri): string {
    const memberParts = connection.parserMemberPath(uri.path);
    return `${memberParts.library}/${memberParts.file}/${memberParts.name}.${memberParts.extension || ""}`;
}

function getArchiveConnectionDirectory(connection: IBMi, rootPath: string): string {
    const connectionFolder = sanitizePathSegment(connection.currentConnectionName || connection.currentHost || "connection");
    return path.join(rootPath, connectionFolder);
}

async function collectSnapshotFiles(directory: string): Promise<string[]> {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => [] as any[]);
    const filePaths: string[] = [];

    for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            filePaths.push(...await collectSnapshotFiles(entryPath));
            continue;
        }

        if (entry.isFile() && entry.name.endsWith(".json")) {
            filePaths.push(entryPath);
        }
    }

    return filePaths;
}

function matchesSearchTerms(values: string[], query: string) {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
        return true;
    }

    const tokens = normalizedQuery.split(/[\s/\\]+/).filter(Boolean);
    if (!tokens.length) {
        return true;
    }

    const searchable = values.join(" ").toLowerCase();
    return tokens.every(token => searchable.includes(token));
}

async function enforceRetentionLimit(directory: string, maxSnapshots: number) {
    const files = await fs.readdir(directory).catch(() => [] as string[]);
    const snapshotFiles = files.filter(file => file.endsWith(".json")).sort().reverse();

    if (snapshotFiles.length <= maxSnapshots) {
        return;
    }

    const filesToDelete = snapshotFiles.slice(maxSnapshots);
    await Promise.all(filesToDelete.map(file => fs.unlink(path.join(directory, file)).catch(() => { })));
}

export async function archiveSourceMemberSnapshot(options: ArchiveSourceMemberOptions): Promise<string | undefined> {
    const { connection, uri, body, reason, sourceDates, languageId } = options;
    const settings = getArchiveSettings(connection);

    if (!settings.enabled) {
        return;
    }

    const directory = getMemberArchiveDirectory(connection, uri, settings.rootPath);
    await fs.mkdir(directory, { recursive: true });

    const memberParts = connection.parserMemberPath(uri.path);
    const createdAt = new Date().toISOString();
    const randomSuffix = Math.random().toString(36).slice(2, 8);
    const fileName = `${createdAt.replace(/[:.]/g, "-")}-${randomSuffix}.json`;
    const filePath = path.join(directory, fileName);

    const snapshot: SourceArchiveSnapshotFile = {
        version: ARCHIVE_VERSION,
        createdAt,
        connectionName: connection.currentConnectionName,
        memberPath: getMemberPath(connection, uri),
        library: memberParts.library,
        file: memberParts.file,
        member: memberParts.name,
        extension: memberParts.extension || "",
        languageId: languageId || undefined,
        reason,
        rows: toRows(body, sourceDates),
    };

    await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2), "utf8");
    await enforceRetentionLimit(directory, settings.maxSnapshots);

    return filePath;
}

export async function listSourceMemberSnapshots(connection: IBMi, uri: vscode.Uri): Promise<SourceArchiveSnapshotInfo[]> {
    const settings = getArchiveSettings(connection);
    const directory = getMemberArchiveDirectory(connection, uri, settings.rootPath);
    const files = await fs.readdir(directory).catch(() => [] as string[]);

    const snapshots = await Promise.all(files
        .filter(file => file.endsWith(".json"))
        .map(async file => {
            const filePath = path.join(directory, file);
            const snapshot = await readSourceMemberSnapshot(filePath).catch(() => undefined);
            if (!snapshot) {
                return undefined;
            }

            return {
                filePath,
                createdAt: snapshot.createdAt,
                reason: snapshot.reason || "save-before-write",
                memberLabel: `${snapshot.member}.${snapshot.extension || `NONE`}`,
                library: snapshot.library,
                file: snapshot.file,
                member: snapshot.member,
                extension: snapshot.extension,
                memberPath: snapshot.memberPath,
            } as SourceArchiveSnapshotInfo;
        }));

    return snapshots
        .filter((snapshot): snapshot is SourceArchiveSnapshotInfo => snapshot !== undefined)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function listSourceMemberSnapshotsMatching(connection: IBMi, query: string): Promise<SourceArchiveSnapshotInfo[]> {
    const settings = getArchiveSettings(connection);
    const connectionDirectory = getArchiveConnectionDirectory(connection, settings.rootPath);
    const snapshotFiles = await collectSnapshotFiles(connectionDirectory);

    const snapshots = await Promise.all(snapshotFiles.map(async filePath => {
        const snapshot = await readSourceMemberSnapshot(filePath).catch(() => undefined);
        if (!snapshot) {
            return undefined;
        }

        if (!matchesSearchTerms([
            snapshot.library,
            snapshot.file,
            snapshot.member,
            snapshot.extension,
            snapshot.memberPath,
            snapshot.reason,
            path.basename(filePath),
        ], query)) {
            return undefined;
        }

        return {
            filePath,
            createdAt: snapshot.createdAt,
            reason: snapshot.reason || "save-before-write",
            memberLabel: `${snapshot.member}.${snapshot.extension || `NONE`}`,
            library: snapshot.library,
            file: snapshot.file,
            member: snapshot.member,
            extension: snapshot.extension,
            memberPath: snapshot.memberPath,
        } as SourceArchiveSnapshotInfo;
    }));

    return snapshots
        .filter((snapshot): snapshot is SourceArchiveSnapshotInfo => snapshot !== undefined)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function readSourceMemberSnapshot(filePath: string): Promise<SourceArchiveSnapshot> {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<SourceArchiveSnapshotFile>;

    if (typeof parsed !== "object" || parsed === null) {
        throw new Error("Invalid snapshot format.");
    }

    const rows = Array.isArray(parsed.rows)
        ? parsed.rows
            .filter(row => typeof row === `object` && row !== null)
            .map((row: any) => ({
                srcdat: String(row.srcdat || `0`),
                srcdta: String(row.srcdta || ``),
            }))
        : undefined;

    const normalizedRows = rows && rows.length > 0
        ? rows
        : undefined;

    if (!normalizedRows) {
        throw new Error("Invalid snapshot format.");
    }

    const materialized = fromRows(normalizedRows);

    return {
        version: Number(parsed.version || ARCHIVE_VERSION),
        createdAt: String(parsed.createdAt || ""),
        connectionName: String(parsed.connectionName || ""),
        memberPath: String(parsed.memberPath || ""),
        library: String(parsed.library || ""),
        file: String(parsed.file || ""),
        member: String(parsed.member || ""),
        extension: String(parsed.extension || ""),
        languageId: typeof parsed.languageId === `string` ? parsed.languageId : undefined,
        reason: String(parsed.reason || ""),
        rows: normalizedRows,
        body: materialized.body,
        sourceDates: materialized.sourceDates,
    };
}
