import path from "path";
import vscode from "vscode";
import type IBMi from "../../api/IBMi";
import type { SourceDateHandler } from "./sourceDateHandler";
import { archiveSourceMemberSnapshot } from "./sourceMemberArchive";

const DEFAULT_SRCDTA_LENGTH = 100;
const saveQueues = new Map<string, Promise<void>>();
const SAVE_AS_TTL_MS = 5 * 60 * 1000;
const SAVE_AS_MAX_ENTRIES = 200;

type SaveAsEntry = {
    body: string;
    sourceDates: string[];
    createdAt: number;
};

const saveAsSourceDateMap = new Map<string, SaveAsEntry>();

function pruneSaveAsSourceDateMap(now = Date.now()) {
    for (const [key, entry] of saveAsSourceDateMap.entries()) {
        if ((now - entry.createdAt) > SAVE_AS_TTL_MS) {
            saveAsSourceDateMap.delete(key);
        }
    }

    while (saveAsSourceDateMap.size >= SAVE_AS_MAX_ENTRIES) {
        const oldestKey = saveAsSourceDateMap.keys().next().value as string | undefined;
        if (!oldestKey) {
            break;
        }

        saveAsSourceDateMap.delete(oldestKey);
    }
}

function getConnectionSaveKey(connection: IBMi): string {
    return connection.currentConnectionName || connection.currentHost || `default`;
}

async function enqueueSourceMemberSave<T>(connection: IBMi, task: () => Promise<T>): Promise<T> {
    const key = getConnectionSaveKey(connection);
    const previous = saveQueues.get(key) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
        release = resolve;
    });

    saveQueues.set(key, previous.then(() => current));

    try {
        await previous;
        return await task();
    } finally {
        release?.();
        if (saveQueues.get(key) === current) {
            saveQueues.delete(key);
        }
    }
}

export function prepareSourceMemberSaveAs(sourceUri: vscode.Uri, targetUri: vscode.Uri, body: string, sourceDates: string[]) {
    pruneSaveAsSourceDateMap();

    saveAsSourceDateMap.set(targetUri.toString(), {
        body,
        sourceDates: sourceDates.slice(),
        createdAt: Date.now(),
    });
}

interface NativeSaveAsPreparationOptions {
    useMapepireForSourceMemberSaves: boolean;
    activeDocument?: {
        uri: vscode.Uri;
        getText: () => string;
    };
    targetUri: vscode.Uri;
    sourceDates?: string[];
    readSourceDates?: () => Promise<string[] | undefined>;
}

export async function prepareNativeSaveAsSourceDates(options: NativeSaveAsPreparationOptions): Promise<boolean> {
    const {
        useMapepireForSourceMemberSaves,
        activeDocument,
        targetUri,
        sourceDates,
        readSourceDates,
    } = options;

    if (useMapepireForSourceMemberSaves !== true) {
        return false;
    }

    if (!activeDocument || activeDocument.uri.scheme !== `member`) {
        return false;
    }

    if (activeDocument.uri.toString() === targetUri.toString()) {
        return false;
    }

    const sourceBody = activeDocument.getText();
    if (!sourceBody.length) {
        return false;
    }

    const effectiveSourceDates = sourceDates?.length ? sourceDates : await readSourceDates?.();
    if (!effectiveSourceDates?.length) {
        return false;
    }

    prepareSourceMemberSaveAs(activeDocument.uri, targetUri, sourceBody, effectiveSourceDates);
    return true;
}

export function consumeSourceMemberSaveAs(targetUri: vscode.Uri): { body: string; sourceDates: string[] } | undefined {
    pruneSaveAsSourceDateMap();

    const key = targetUri.toString();
    const entry = saveAsSourceDateMap.get(key);
    if (entry) {
        saveAsSourceDateMap.delete(key);

        if ((Date.now() - entry.createdAt) <= SAVE_AS_TTL_MS) {
            return {
                body: entry.body,
                sourceDates: entry.sourceDates,
            };
        }
    }

    return undefined;
}

function sanitizeTempObjectSegment(value: string): string {
    return value
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9_]/g, `_`)
        .replace(/_+/g, `_`)
        .replace(/^_+|_+$/g, ``)
        .slice(0, 10);
}

function buildTempObjectName(prefix: string, library: string, file: string, member: string): string {
    const identity = [library, file, member]
        .map(segment => sanitizeTempObjectSegment(segment))
        .filter(Boolean)
        .join(`_`);

    return `QTEMP.${prefix}_${identity}`;
}

interface SaveSourceMbrOptions {
    connection: IBMi;
    uri: vscode.Uri;
    body: string;
    sourceDateHandler: SourceDateHandler;
    ensureBaseSourceLoaded: () => Promise<void>;
}

interface RestoreSourceMbrOptions {
    connection: IBMi;
    uri: vscode.Uri;
    body: string;
    sourceDates?: string[];
}

async function readRecordLength(connection: IBMi, uri: vscode.Uri, alias: string, sourceDateHandler: SourceDateHandler): Promise<number> {
    let recordLength = sourceDateHandler.recordLengths.get(alias);
    if (!recordLength) {
        const { library, file } = connection.parserMemberPath(uri.path);
        const [result] = await connection.runSQL(
            `SELECT LENGTH FROM QSYS2.SYSCOLUMNS WHERE TABLE_SCHEMA = '${library}' AND TABLE_NAME = '${file}' AND COLUMN_NAME = 'SRCDTA'`
        ) as { LENGTH: number }[];
        recordLength = result?.LENGTH ? Number(result.LENGTH) : DEFAULT_SRCDTA_LENGTH;

        sourceDateHandler.recordLengths.set(alias, recordLength);
    }

    return recordLength;
}

async function saveRowsToHost(connection: IBMi, uri: vscode.Uri, rows: [number, number, string][], recordLength: number) {
    const { library, file, name } = connection.parserMemberPath(uri.path);
    const targetAlias = buildTempObjectName(`C4I_MBR_ALIAS`, library, file, name);
    const stagingTable = buildTempObjectName(`C4I_SRCSAVE`, library, file, name);
    const backupTable = buildTempObjectName(`C4I_BACKUP`, library, file, name);
    const startedAt = Date.now();
    let completed = false;

    try {
        await connection.runSQL(`CREATE OR REPLACE ALIAS ${targetAlias} FOR ${library}.${file}(${name})`);

        await connection.runSQL(
            `CREATE OR REPLACE TABLE ${stagingTable} LIKE "${library}"."${file}" ON REPLACE DELETE ROWS;`
        );

        const configuredBatchSize = (() => {
            const configValue = (connection as any).config?.mapepireSaveBufferSize ?? (connection as any).getConfig?.()?.mapepireSaveBufferSize ?? 500;
            const parsed = Number(configValue);
            return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 500;
        })();
        const rowsPerBatch = configuredBatchSize;
        for (let i = 0; i < rows.length; i += rowsPerBatch) {
            const batch = rows.slice(i, i + rowsPerBatch);
            const batchNumber = Math.floor(i / rowsPerBatch) + 1;
            const batchStart = batch[0]?.[0] ?? 0;
            const batchEnd = batch[batch.length - 1]?.[0] ?? batchStart;
            connection.appendOutput(`[Source save] Mapepire SQL batch ${batchNumber} rows=${batchStart}-${batchEnd} (${batch.length}).\n`);

            // Mapepire server treats a 2D bindings array as a JDBC batch: one inner array per row,
            // executed via addBatch/executeLargeBatch. Explicit CASTs give the driver concrete SQL
            // types for the markers, avoiding parameter-metadata derivation against DDS-described
            // zoned-decimal columns (07006 NumberFormatException from JT400 on mapepire-server 2.3.6).
            const bindings = batch.map(row => [row[0], row[1], row[2]]);
            try {
                await connection.runSQL(
                    `insert into ${stagingTable} (SRCSEQ, SRCDAT, SRCDTA) values (cast(? as numeric(6, 2)), cast(? as numeric(6, 0)), cast(? as varchar(${recordLength})))`,
                    { bindings }
                );
            } catch (batchInsertError: any) {
                const firstDate = batch[0]?.[1] ?? 0;
                const lastDate = batch[batch.length - 1]?.[1] ?? firstDate;
                const sqlstate = typeof batchInsertError?.sqlstate === `string` && batchInsertError.sqlstate !== `0`
                    ? batchInsertError.sqlstate
                    : undefined;
                const errorDetail = sqlstate
                    ? `[${sqlstate}] ${batchInsertError.message}`
                    : String(batchInsertError);
                const preview = `(${formatSourceSequence(batchStart)}, ${firstDate}, ${JSON.stringify(String(batch[0]?.[2] ?? ``).slice(0, 40))})`;
                connection.appendOutput(
                    `[Source save] Mapepire SQL batch ${batchNumber} failed (SRCSEQ ${formatSourceSequence(batchStart)}-${formatSourceSequence(batchEnd)}, SRCDAT ${firstDate}-${lastDate}, first row ${preview}): ${errorDetail}\n`
                );
                throw batchInsertError;
            }
        }

        await connection.runSQL([
            `CREATE OR REPLACE TABLE ${backupTable} LIKE ${stagingTable} ON REPLACE DELETE ROWS`,
            `Insert into ${backupTable} (SRCSEQ, SRCDAT, SRCDTA) Select SRCSEQ, case when locate('40', hex(SRCDAT)) > 0 then 0 else SRCDAT end, SRCDTA From ${targetAlias}`
        ].join(`;\n`));

        const [stagingCountRow] = await connection.runSQL(`Select count(*) as C from ${stagingTable}`);
        const [backupCountRow] = await connection.runSQL(`Select count(*) as C from ${backupTable}`);
        const expectedCount = Number(stagingCountRow?.C ?? 0);
        const backupCount = Number(backupCountRow?.C ?? 0);

        connection.appendOutput(`[Source save] Mapepire SQL staged rows=${expectedCount}, backup rows=${backupCount}.\n`);

        try {
            await connection.runSQL([
                `Delete from ${targetAlias}`,
                `Insert into ${targetAlias} (SRCSEQ, SRCDAT, SRCDTA) Select SRCSEQ, SRCDAT, Substr(SRCDTA, 1, ${recordLength}) From ${stagingTable} Order by SRCSEQ`
            ].join(`;\n`));

            const [targetCountRow] = await connection.runSQL(`Select count(*) as C from ${targetAlias}`);
            const targetCount = Number(targetCountRow?.C ?? 0);

            if (targetCount !== expectedCount) {
                await connection.runSQL([
                    `Delete from ${targetAlias}`,
                    `Insert into ${targetAlias} (SRCSEQ, SRCDAT, SRCDTA) Select SRCSEQ, SRCDAT, SRCDTA From ${backupTable} Order by SRCSEQ`
                ].join(`;\n`)).catch(() => { });

                throw new Error(`Post-save verification failed (expected ${expectedCount} rows, found ${targetCount}). Restored backup content.`);
            }

            connection.appendOutput(`[Source save] Mapepire SQL target rows=${targetCount}.\n`);
            completed = true;
        } catch (saveError) {
            await connection.runSQL([
                `Delete from ${targetAlias}`,
                `Insert into ${targetAlias} (SRCSEQ, SRCDAT, SRCDTA) Select SRCSEQ, SRCDAT, SRCDTA From ${backupTable} Order by SRCSEQ`
            ].join(`;\n`)).catch(() => { });

            connection.appendOutput(`[Source save] Mapepire SQL save failed; attempted backup restore.\n`);

            throw saveError;
        }
    } finally {
        await connection.runSQL(`Drop alias ${targetAlias}`).catch(() => { });
        await connection.runSQL(`Drop table ${backupTable}`).catch(() => { });
        await connection.runSQL(`Drop table ${stagingTable}`).catch(() => { });

        const elapsedMs = Date.now() - startedAt;
        connection.appendOutput(`[Source save] Mapepire SQL ${completed ? `completed` : `finished with errors`} in ${elapsedMs}ms.\n`);
    }
}

function normalizeSourceDate(rawDate: string | undefined): number {
    const digitsOnly = String(rawDate || "0").replace(/\D/g, "").slice(0, 6);
    if (!digitsOnly) {
        return 0;
    }

    return Number(digitsOnly.padEnd(6, "0"));
}

function formatSourceSequence(sequence: number): string {
    return Number(sequence).toFixed(2);
}

function buildRows(body: string, recordLength: number, sourceDates: string[]) {
    const sourceData = body.split(`\n`);
    const decimalSequence = sourceData.length >= 10000;
    const tabSize = (vscode.window.activeTextEditor?.options.tabSize as number) || 4;

    const rows: [number, number, string][] = [];
    for (let i = 0; i < sourceData.length; i++) {
        const sequence = decimalSequence ? Number(((i + 1) / 100).toFixed(2)) : i + 1;
        sourceData[i] = sourceData[i].replace(/\t/g, (_, offset) => ' '.repeat(tabSize - (offset % tabSize))).trimEnd();
        if (sourceData[i].length > recordLength) {
            sourceData[i] = sourceData[i].substring(0, recordLength);
        }

        rows.push([
            sequence,
            normalizeSourceDate(sourceDates[i]),
            sourceData[i],
        ]);
    }

    return rows;
}

export async function restoreSourceMbrToHost(options: RestoreSourceMbrOptions) {
    const { connection, uri, body, sourceDates } = options;
    const sourceData = body.split(`\n`);
    const { library, file } = connection.parserMemberPath(uri.path);
    const [result] = await connection.runSQL(
        `SELECT LENGTH FROM QSYS2.SYSCOLUMNS WHERE TABLE_SCHEMA = '${library}' AND TABLE_NAME = '${file}' AND COLUMN_NAME = 'SRCDTA'`
    ) as { LENGTH: number }[];
    const recordLength = result?.LENGTH ? Number(result.LENGTH) : DEFAULT_SRCDTA_LENGTH;

    const dates = (sourceDates || []).slice(0, sourceData.length);
    while (dates.length < sourceData.length) {
        dates.push(`0`);
    }

    const rows = buildRows(body, recordLength, dates);
    await saveRowsToHost(connection, uri, rows, recordLength);
}

export async function saveSourceMbrToHost(options: SaveSourceMbrOptions) {
    const { connection, uri, body, sourceDateHandler, ensureBaseSourceLoaded } = options;

    await enqueueSourceMemberSave(connection, async () => {
        const alias = uri.toString();
        const { library, file, name } = connection.parserMemberPath(uri.path);

        connection.appendOutput(`[Source save] Using Mapepire SQL save for ${library}/${file}(${name})\n`);

        if (!sourceDateHandler.baseSource.has(alias)) {
            await ensureBaseSourceLoaded();
        }

        const previousBody = sourceDateHandler.baseSource.get(alias);
        const previousSourceDates = sourceDateHandler.baseDates.get(alias);
        const existingLanguageId = vscode.workspace.textDocuments.find(document => document.uri.toString() === uri.toString())?.languageId;
        if (typeof previousBody === `string` && previousBody !== body) {
            try {
                const archivePath = await archiveSourceMemberSnapshot({
                    connection,
                    uri,
                    body: previousBody,
                    reason: `save-before-write`,
                    sourceDates: previousSourceDates,
                    languageId: existingLanguageId,
                });

                if (archivePath) {
                    connection.appendOutput(`[Source save] Archived ${library}/${file}(${name}) to snapshot ${path.basename(archivePath)}\n`);
                }
            } catch (archiveError) {
                connection.appendOutput(`[Source save] Local archive write failed; continuing save: ${String(archiveError)}\n`);
            }
        }

        const sourceDates = sourceDateHandler.calcNewSourceDates(alias, body);
        const recordLength = await readRecordLength(connection, uri, alias, sourceDateHandler);
        const rows = buildRows(body, recordLength, sourceDates);

        await saveRowsToHost(connection, uri, rows, recordLength);

        sourceDateHandler.baseSource.set(alias, body);
        sourceDateHandler.baseDates.set(alias, sourceDates);
        sourceDateHandler.baseSequences.delete(alias);
    });
}
