import path from "path";
import vscode, { commands, Disposable, l10n, window, workspace } from "vscode";
import Instance from "../Instance";
import IBMi from "../api/IBMi";
import { VscodeTools } from "../ui/Tools";
import { getUriFromPath } from "../filesystems/qsys/QSysFs";
import { listSourceMemberSnapshots, listSourceMemberSnapshotsMatching, readSourceMemberSnapshot, SourceArchiveSnapshot, SourceArchiveSnapshotInfo } from "../filesystems/qsys/sourceMemberArchive";
import { restoreSourceMbrToHost } from "../filesystems/qsys/sourceMemberSave";

const ARCHIVE_PREVIEW_SCHEME = `code-for-ibmi-archive`;

type PreviewSnapshot = {
    previewUri: vscode.Uri;
    snapshotPath: string;
    sourceDates: string[];
    content: string;
    memberPath: string;
    memberLabel: string;
    preferredLanguageId: string;
};

const previewSnapshotMap = new Map<string, PreviewSnapshot>();
const sourceDateDecoration = vscode.window.createTextEditorDecorationType({
    before: {
        color: new vscode.ThemeColor(`editorLineNumber.foreground`),
        textDecoration: `none`,
        fontWeight: `normal`,
        fontStyle: `normal`,
        margin: `0 1ch 0 0`,
        width: `7ch`,
    },
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
});

const LANGUAGE_BY_EXTENSION: { [key: string]: string } = {
    RPGLE: `rpgle`,
    SQLRPGLE: `rpgle`,
    CLLE: `cl`,
    CLP: `cl`,
    CL: `cl`,
    BND: `bnd`,
    CMD: `cmd`,
    SQL: `sql`,
    CBLLE: `cobol`,
    CBL: `cobol`,
    C: `c`,
    CPP: `cpp`,
    H: `c`,
};

function getActiveMemberEditor() {
    const editor = window.activeTextEditor;
    if (editor?.document.uri.scheme === "member") {
        return editor;
    }
}

function getSnapshotLabel(snapshot: SourceArchiveSnapshotInfo): string {
    const date = new Date(snapshot.createdAt);
    return Number.isNaN(date.valueOf()) ? snapshot.createdAt : date.toLocaleString();
}

function getSnapshotDetail(snapshot: SourceArchiveSnapshotInfo): string {
    return `${snapshot.library}/${snapshot.file} · ${getSnapshotLabel(snapshot)}`;
}

function getLanguageForSnapshotExtension(extension: string) {
    const normalized = extension.toUpperCase();
    return LANGUAGE_BY_EXTENSION[normalized] || `plaintext`;
}

async function resolveAvailableLanguageId(preferredLanguageId: string) {
    const availableLanguageIds = await vscode.languages.getLanguages();
    return availableLanguageIds.includes(preferredLanguageId) ? preferredLanguageId : `plaintext`;
}

function createSnapshotPreviewUri(member: string, extension: string) {
    const safeExt = extension ? extension.replace(/[^A-Za-z0-9]/g, "") : "txt";
    const safeMember = member.replace(/[^A-Za-z0-9_.-]/g, "_");
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return vscode.Uri.parse(`${ARCHIVE_PREVIEW_SCHEME}:/${safeMember}.${safeExt}?id=${encodeURIComponent(unique)}`);
}

function applySourceDatePreviewDecorations(editor: vscode.TextEditor, sourceDates: string[]) {
    const lineCount = editor.document.lineCount;
    const decorations: vscode.DecorationOptions[] = [];

    for (let line = 0; line < lineCount; line++) {
        decorations.push({
            range: new vscode.Range(new vscode.Position(line, 0), new vscode.Position(line, 0)),
            renderOptions: {
                before: {
                    contentText: String(sourceDates[line] || `000000`).padStart(6, `0`),
                },
            },
        });
    }

    editor.setDecorations(sourceDateDecoration, decorations);
}

async function pickSnapshot(instance: Instance, memberUri?: vscode.Uri): Promise<SourceArchiveSnapshotInfo | undefined> {
    const connection = instance.getConnection();
    if (!connection) {
        return;
    }

    const activeSearchSnapshot = memberUri ? await listSourceMemberSnapshots(connection, memberUri) : [];

    type ArchiveQuickPickItem = vscode.QuickPickItem & { snapshot: SourceArchiveSnapshotInfo };

    return await new Promise<SourceArchiveSnapshotInfo | undefined>(resolve => {
        const quickPick = window.createQuickPick<ArchiveQuickPickItem>();
        quickPick.title = l10n.t("Source Member Archive");
        quickPick.placeholder = l10n.t("Type any part of the library, file, or member name. Examples: MYSTUFF, QRPGLESRC, COZZISRC/QRPGLESRC");
        quickPick.canSelectMany = false;
        quickPick.ignoreFocusOut = true;
        quickPick.matchOnDescription = false;
        quickPick.matchOnDetail = false;
        quickPick.value = ``;

        let requestId = 0;

        const refreshItems = async () => {
            const query = quickPick.value.trim();
            const currentRequest = ++requestId;

            if (!query) {
                quickPick.busy = true;
                const snapshots = memberUri ? activeSearchSnapshot : await listSourceMemberSnapshotsMatching(connection, query);
                if (currentRequest !== requestId) {
                    return;
                }

                quickPick.items = snapshots.map(snapshot => ({
                    label: `${snapshot.library}/${snapshot.file}/${snapshot.memberLabel}`,
                    description: getSnapshotLabel(snapshot),
                    detail: `${snapshot.reason} · ${snapshot.memberPath}`,
                    snapshot,
                }));
                quickPick.busy = false;
                return;
            }

            quickPick.busy = true;
            const snapshots = await listSourceMemberSnapshotsMatching(connection, query);

            if (currentRequest !== requestId) {
                return;
            }

            quickPick.items = snapshots.map(snapshot => ({
                label: `${snapshot.library}/${snapshot.file}/${snapshot.memberLabel}`,
                description: getSnapshotLabel(snapshot),
                detail: `${snapshot.reason} · ${snapshot.memberPath}`,
                snapshot,
            }));
            quickPick.busy = false;
        };

        quickPick.onDidChangeValue(() => {
            void refreshItems();
        });

        quickPick.onDidAccept(() => {
            const selected = quickPick.selectedItems[0] || quickPick.activeItems[0];
            quickPick.hide();
            resolve(selected?.snapshot);
        });

        quickPick.onDidHide(() => {
            quickPick.dispose();
            resolve(undefined);
        });

        quickPick.show();
        void refreshItems();
    });
}

async function restoreSnapshotToMember(instance: Instance, snapshotFilePath: string): Promise<SourceArchiveSnapshot | undefined> {
    const connection = instance.getConnection();
    if (!connection) {
        throw new Error(l10n.t("Not connected to IBM i."));
    }

    const snapshot = await readSourceMemberSnapshot(snapshotFilePath);
    const memberPath = snapshot.memberPath || "";

    if (!memberPath) {
        throw new Error(l10n.t("Snapshot does not include a target member path."));
    }

    const confirm = await window.showWarningMessage(
        l10n.t("About to upload to IBM i Server."),
        {
            modal: true,
            detail: l10n.t("This will replace member {0} in file {1}/{2}. Continue?", snapshot.member, snapshot.library, snapshot.file),
        },
        l10n.t("Confirm"),
        l10n.t("Cancel")
    );

    if (confirm !== l10n.t("Confirm")) {
        return;
    }

    await restoreSourceMbrToHost({
        connection,
        uri: getUriFromPath(memberPath),
        body: snapshot.body,
        sourceDates: snapshot.sourceDates,
    });

    const targetUri = getUriFromPath(memberPath);
    const existingDocument = VscodeTools.findExistingDocument(targetUri);
    if (existingDocument) {
        await window.showTextDocument(existingDocument);
    } else {
        await commands.executeCommand<boolean>("code-for-ibmi.openEditable", memberPath, { readonly: false });
    }
    await commands.executeCommand("code-for-ibmi.refreshFile", targetUri);

    connection.appendOutput(`[Source save] Restored member from local archive snapshot: ${snapshotFilePath}\n`);
    return snapshot;
}

async function closeArchivePreviewTab(snapshotFilePath?: string) {
    if (!snapshotFilePath) {
        return;
    }

    const tabsToClose: vscode.Tab[] = [];

    for (const preview of previewSnapshotMap.values()) {
        if (preview.snapshotPath === snapshotFilePath) {
            for (const group of window.tabGroups.all) {
                for (const tab of group.tabs) {
                    const input = tab.input as vscode.TabInputText | undefined;
                    if (input?.uri?.toString() === preview.previewUri.toString()) {
                        tabsToClose.push(tab);
                    }
                }
            }
        }
    }

    for (const tab of tabsToClose) {
        await window.tabGroups.close(tab);
    }
}

async function showRestoreToast(snapshot: SourceArchiveSnapshot) {
    if (IBMi.GlobalStorage.getArchiveRestoreToastHidden()) {
        return;
    }

    const choice = await window.showInformationMessage(
        l10n.t("Restored archived {0}/{1}({2}) to IBM i server. Restored member is now open for editing.", snapshot.library, snapshot.file, snapshot.member),
        l10n.t("Close"),
        l10n.t("Don't show this again")
    );

    if (choice === l10n.t("Don't show this again")) {
        await IBMi.GlobalStorage.setArchiveRestoreToastHidden(true);
    }
}

async function getSnapshotPathFromActivePreview(): Promise<string | undefined> {
    const activeDocument = window.activeTextEditor?.document;
    if (!activeDocument || activeDocument.uri.scheme !== ARCHIVE_PREVIEW_SCHEME) {
        return;
    }

    return previewSnapshotMap.get(activeDocument.uri.toString())?.snapshotPath;
}

function refreshPreviewDecorationsForEditor(editor?: vscode.TextEditor) {
    if (!editor || editor.document.uri.scheme !== ARCHIVE_PREVIEW_SCHEME) {
        return;
    }

    const previewInfo = previewSnapshotMap.get(editor.document.uri.toString());
    if (!previewInfo) {
        return;
    }

    applySourceDatePreviewDecorations(editor, previewInfo.sourceDates);
}

export function registerSourceArchiveCommands(instance: Instance): Disposable[] {
    const previewProvider: vscode.TextDocumentContentProvider = {
        provideTextDocumentContent(uri) {
            const preview = previewSnapshotMap.get(uri.toString());
            return preview?.content || ``;
        },
    };

    return [
        workspace.registerTextDocumentContentProvider(ARCHIVE_PREVIEW_SCHEME, previewProvider),

        window.onDidChangeActiveTextEditor(editor => {
            refreshPreviewDecorationsForEditor(editor);
        }),

        workspace.onDidCloseTextDocument(document => {
            if (document.uri.scheme === ARCHIVE_PREVIEW_SCHEME) {
                previewSnapshotMap.delete(document.uri.toString());
            }
        }),

        commands.registerCommand("code-for-ibmi.sourceArchive.openSnapshot", async () => {
            const editor = getActiveMemberEditor();
            const snapshot = await pickSnapshot(instance, editor?.document.uri);
            if (!snapshot) {
                return;
            }

            const snapshotData = await readSourceMemberSnapshot(snapshot.filePath);
            const previewUri = createSnapshotPreviewUri(snapshotData.member || `snapshot`, snapshotData.extension || `txt`);
            const preferredLanguage = snapshotData.languageId || getLanguageForSnapshotExtension(snapshotData.extension);

            previewSnapshotMap.set(previewUri.toString(), {
                previewUri,
                snapshotPath: snapshot.filePath,
                sourceDates: snapshotData.sourceDates || [],
                content: snapshotData.body,
                memberPath: snapshotData.memberPath,
                memberLabel: `${snapshotData.member}.${snapshotData.extension || `NONE`}`,
                preferredLanguageId: preferredLanguage,
            });

            const document = await workspace.openTextDocument(previewUri);
            const languageId = await resolveAvailableLanguageId(preferredLanguage);
            await vscode.languages.setTextDocumentLanguage(document, languageId);
            const previewEditor = await window.showTextDocument(document, { preview: false });
            applySourceDatePreviewDecorations(previewEditor, snapshotData.sourceDates || []);
        }),

        commands.registerCommand("code-for-ibmi.sourceArchive.restoreToHost", async () => {
            const editor = getActiveMemberEditor();
            if (editor) {
                const snapshot = await pickSnapshot(instance, editor.document.uri);
                if (!snapshot) {
                    return;
                }

                const restoredSnapshot = await restoreSnapshotToMember(instance, snapshot.filePath);
                if (restoredSnapshot) {
                    await closeArchivePreviewTab(snapshot.filePath);
                    await showRestoreToast(restoredSnapshot);
                }
                return;
            }

            const snapshotFilePath = await getSnapshotPathFromActivePreview();
            if (!snapshotFilePath) {
                await window.showInformationMessage(l10n.t("Open a source member or a source archive preview and try again."));
                return;
            }

            const restoredSnapshot = await restoreSnapshotToMember(instance, snapshotFilePath);
            if (restoredSnapshot) {
                await closeArchivePreviewTab(snapshotFilePath);
                await showRestoreToast(restoredSnapshot);
            }
        }),
    ];
}
