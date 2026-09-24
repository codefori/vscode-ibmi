import path from "path";
import vscode from "vscode";
import IBMi from "../../api/IBMi";
import { getAliasName, SourceDateHandler } from "./sourceDateHandler";
import { archiveSourceMemberSnapshot } from "./sourceMemberArchive";

const DEFAULT_SRCDTA_LENGTH = 100;
const STAGING_TABLE_NAME = `C4I_SRCSAVE`;
const STAGING_TABLE = `QTEMP.${STAGING_TABLE_NAME}`;
const TARGET_ALIAS_NAME = `C4I_MBR_ALIAS`;
const TARGET_ALIAS = `QTEMP.${TARGET_ALIAS_NAME}`;
const BACKUP_TABLE_NAME = `C4I_BACKUP`;
const BACKUP_TABLE = `QTEMP.${BACKUP_TABLE_NAME}`;

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
    const startedAt = Date.now();
    let completed = false;

    try {
        await connection.runSQL(`CREATE OR REPLACE ALIAS ${TARGET_ALIAS} FOR ${library}.${file}(${name})`);

        await connection.runSQL(
            `CREATE OR REPLACE TABLE ${STAGING_TABLE} LIKE "${library}"."${file}" ON REPLACE DELETE ROWS;`
        );

        const rowsPerBatch = 500;
        for (let i = 0; i < rows.length; i += rowsPerBatch) {
            const batch = rows.slice(i, i + rowsPerBatch);
            const batchNumber = Math.floor(i / rowsPerBatch) + 1;
            const batchStart = batch[0]?.[0] ?? 0;
            const batchEnd = batch[batch.length - 1]?.[0] ?? batchStart;
            connection.appendOutput(`[Source save] Mapepire SQL batch ${batchNumber} rows=${batchStart}-${batchEnd} (${batch.length}).\n`);

            const valuesSql = batch.map(row => `(${formatSourceSequence(row[0])}, ${row[1]}, ?)`).join(`, `);
            const bindings = batch.map(row => row[2]);
            try {
                await connection.runSQL(
                    `insert into ${STAGING_TABLE} (SRCSEQ, SRCDAT, SRCDTA) values ${valuesSql}`,
                    { bindings }
                );
            } catch (batchInsertError) {
                const firstDate = batch[0]?.[1] ?? 0;
                const lastDate = batch[batch.length - 1]?.[1] ?? firstDate;
                connection.appendOutput(
                    `[Source save] Mapepire SQL batch ${batchNumber} failed (SRCSEQ ${formatSourceSequence(batchStart)}-${formatSourceSequence(batchEnd)}, SRCDAT ${firstDate}-${lastDate}).\n`
                );
                throw batchInsertError;
            }
        }

        await connection.runSQL([
            `CREATE OR REPLACE TABLE ${BACKUP_TABLE} LIKE ${STAGING_TABLE} ON REPLACE DELETE ROWS`,
            `Insert into ${BACKUP_TABLE} (SRCSEQ, SRCDAT, SRCDTA) Select SRCSEQ, case when locate('40', hex(SRCDAT)) > 0 then 0 else SRCDAT end, SRCDTA From ${TARGET_ALIAS}`
        ].join(`;\n`));

        const [stagingCountRow] = await connection.runSQL(`Select count(*) as C from ${STAGING_TABLE}`);
        const [backupCountRow] = await connection.runSQL(`Select count(*) as C from ${BACKUP_TABLE}`);
        const expectedCount = Number(stagingCountRow?.C ?? 0);
        const backupCount = Number(backupCountRow?.C ?? 0);

        connection.appendOutput(`[Source save] Mapepire SQL staged rows=${expectedCount}, backup rows=${backupCount}.\n`);

        try {
            await connection.runSQL([
                `Delete from ${TARGET_ALIAS}`,
                `Insert into ${TARGET_ALIAS} (SRCSEQ, SRCDAT, SRCDTA) Select SRCSEQ, SRCDAT, Substr(SRCDTA, 1, ${recordLength}) From ${STAGING_TABLE} Order by SRCSEQ`
            ].join(`;\n`));

            const [targetCountRow] = await connection.runSQL(`Select count(*) as C from ${TARGET_ALIAS}`);
            const targetCount = Number(targetCountRow?.C ?? 0);

            if (targetCount !== expectedCount) {
                await connection.runSQL([
                    `Delete from ${TARGET_ALIAS}`,
                    `Insert into ${TARGET_ALIAS} (SRCSEQ, SRCDAT, SRCDTA) Select SRCSEQ, SRCDAT, SRCDTA From ${BACKUP_TABLE} Order by SRCSEQ`
                ].join(`;\n`)).catch(() => { });

                throw new Error(`Post-save verification failed (expected ${expectedCount} rows, found ${targetCount}). Restored backup content.`);
            }

            connection.appendOutput(`[Source save] Mapepire SQL target rows=${targetCount}.\n`);
            completed = true;
        } catch (saveError) {
            await connection.runSQL([
                `Delete from ${TARGET_ALIAS}`,
                `Insert into ${TARGET_ALIAS} (SRCSEQ, SRCDAT, SRCDTA) Select SRCSEQ, SRCDAT, SRCDTA From ${BACKUP_TABLE} Order by SRCSEQ`
            ].join(`;\n`)).catch(() => { });

            connection.appendOutput(`[Source save] Mapepire SQL save failed; attempted backup restore.\n`);

            throw saveError;
        }
    } finally {
        await connection.runSQL(`Drop alias ${TARGET_ALIAS}`).catch(() => { });
        await connection.runSQL(`Drop table ${BACKUP_TABLE}`).catch(() => { });
        await connection.runSQL(`Drop table ${STAGING_TABLE}`).catch(() => { });

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
    const alias = getAliasName(uri);
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
}
