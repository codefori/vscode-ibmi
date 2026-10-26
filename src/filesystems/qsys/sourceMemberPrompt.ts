import vscode from "vscode";
import { instance } from "../../instantiate";
import { normalizeSourceMemberPromptData, SourceMemberPromptInput, SourceMemberPromptResult } from "./sourceMemberPromptUtils";

export { normalizeSourceMemberPromptData, SourceMemberPromptInput, SourceMemberPromptResult } from "./sourceMemberPromptUtils";

interface SourceMemberPromptMemberInfo {
    name: string;
    type: string;
    text: string;
}

function escapeHtml(value: string) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function buildSourceMemberPromptHtml(defaults: SourceMemberPromptResult) {
    const labels = {
        sourceFile: vscode.l10n.t(`Source file:`),
        library: vscode.l10n.t(`Library:`),
        member: vscode.l10n.t(`Member:`),
        sourceType: vscode.l10n.t(`Type:`),
        keepExistingChangeDates: vscode.l10n.t(`Keep Existing Change Dates`),
        save: vscode.l10n.t(`Save`),
        cancel: vscode.l10n.t(`Cancel`),
    };

    return /* html */`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>Source member</title>
            <style>
                :root {
                    color-scheme: light dark;
                    --bg: var(--vscode-editor-background);
                    --fg: var(--vscode-editor-foreground);
                    --input-bg: var(--vscode-input-background);
                    --input-fg: var(--vscode-input-foreground);
                    --input-border: var(--vscode-input-border, rgba(127, 127, 127, 0.8));
                    --button-bg: var(--vscode-button-background);
                    --button-fg: var(--vscode-button-foreground);
                    --button-border: var(--vscode-button-border, transparent);
                    --button-hover: var(--vscode-button-hoverBackground, rgba(255, 255, 255, 0.08));
                }

                html, body {
                    margin: 0;
                    padding: 0;
                    height: 100%;
                    background: var(--bg);
                    color: var(--fg);
                    font-family: var(--vscode-font-family, "Segoe UI", sans-serif);
                }

                body {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                .prompter {
                    width: min(24rem, 90vw);
                    background: var(--bg);
                    border: 1px solid var(--input-border);
                    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.08);
                    padding: 1.5rem 1.25rem 1rem;
                }

                .field {
                    display: grid;
                    grid-template-columns: 7.5rem 11.5rem;
                    gap: 0.5rem 0.5rem;
                    align-items: center;
                    margin-bottom: 0.7rem;
                }

                .field label {
                    text-align: left;
                    font-weight: 600;
                    letter-spacing: 0.02em;
                    white-space: nowrap;
                }

                .field label.library-label {
                    padding-left: 2ch;
                }

                .field input.library-input {
                    margin-left: 2ch;
                }

                .checkbox-field {
                    display: flex;
                    align-items: center;
                    gap: 0.45rem;
                    margin-left: calc(7.5rem + 0.5rem);
                    margin-bottom: 0.7rem;
                }

                .checkbox-field input {
                    width: 1rem;
                    height: 1rem;
                    margin: 0;
                    accent-color: var(--vscode-checkbox-selectBackground, var(--button-bg));
                }

                .checkbox-field label {
                    font-weight: 600;
                    letter-spacing: 0.02em;
                }

                input {
                    width: 11.5rem;
                    height: 2rem;
                    padding: 0 0.5rem;
                    border: 1px solid var(--input-border);
                    background: var(--input-bg);
                    color: var(--input-fg);
                    font-size: 0.95rem;
                    box-sizing: border-box;
                    outline: none;
                }

                input:focus {
                    border-color: var(--vscode-focusBorder, var(--input-border));
                    box-shadow: 0 0 0 1px var(--vscode-focusBorder, var(--input-border));
                }

                .actions {
                    display: flex;
                    justify-content: flex-start;
                    gap: 0.5rem;
                    margin-top: 1rem;
                    margin-left: calc(7.5rem + 0.5rem);
                    padding-top: 0.5rem;
                }

                button {
                    min-width: 6.25rem;
                    height: 2rem;
                    padding: 0 1rem;
                    border: 1px solid var(--button-border);
                    background: var(--button-bg);
                    color: var(--button-fg);
                    cursor: pointer;
                    font-size: 0.9rem;
                }

                button.secondary {
                    background: var(--button-bg);
                    color: var(--button-fg);
                    border-color: var(--button-border);
                }

                button:hover {
                    background: var(--button-hover);
                }
            </style>
        </head>
        <body>
            <form id="source-member-form" class="prompter" autocomplete="off">
                <div class="field">
                    <label for="sourceFile">${escapeHtml(labels.sourceFile)}</label>
                    <input id="sourceFile" name="sourceFile" maxlength="10" value="${escapeHtml(defaults.sourceFile)}" />
                </div>

                <div class="field">
                    <label for="library" class="library-label">${escapeHtml(labels.library)}</label>
                    <input id="library" name="library" class="library-input" maxlength="10" value="${escapeHtml(defaults.library)}" />
                </div>

                <div class="field">
                    <label for="member">${escapeHtml(labels.member)}</label>
                    <input id="member" name="member" maxlength="10" value="${escapeHtml(defaults.member)}" />
                </div>

                <div class="field">
                    <label for="sourceType">${escapeHtml(labels.sourceType)}</label>
                    <input id="sourceType" name="sourceType" maxlength="10" value="${escapeHtml(defaults.sourceType)}" />
                </div>

                <div class="checkbox-field">
                    <input id="keepExistingChangeDates" name="keepExistingChangeDates" type="checkbox" ${defaults.keepExistingChangeDates ? `checked` : ``} />
                    <label for="keepExistingChangeDates">${escapeHtml(labels.keepExistingChangeDates)}</label>
                </div>

                <div class="actions">
                    <button id="save" type="submit">${escapeHtml(labels.save)}</button>
                    <button id="cancel" type="button" class="secondary">${escapeHtml(labels.cancel)}</button>
                </div>
            </form>

            <script>
                const vscode = acquireVsCodeApi();
                const form = document.getElementById('source-member-form');

                const readValues = () => {
                    return {
                        sourceFile: document.getElementById('sourceFile').value,
                        library: document.getElementById('library').value,
                        member: document.getElementById('member').value,
                        sourceType: document.getElementById('sourceType').value,
                        keepExistingChangeDates: document.getElementById('keepExistingChangeDates').checked,
                    };
                };

                const submit = () => {
                    const values = readValues();
                    if (!values.library || !values.sourceFile || !values.member) {
                        return;
                    }

                    vscode.postMessage({ type: 'submit', data: values });
                };

                form.addEventListener('submit', (event) => {
                    event.preventDefault();
                    submit();
                });

                document.getElementById('cancel').addEventListener('click', () => {
                    vscode.postMessage({ type: 'cancel' });
                });

                window.addEventListener('message', (event) => {
                    const message = event.data;
                    if (message?.type === 'setMember' && message.data?.member) {
                        const memberInput = document.getElementById('member');
                        memberInput.value = message.data.member;
                        memberInput.focus();
                        memberInput.select();
                    }
                });

                document.addEventListener('keydown', (event) => {
                    if (event.key === 'F4') {
                        const active = document.activeElement;
                        if (active && active.id === 'member') {
                            event.preventDefault();
                            vscode.postMessage({ type: 'lookupMember', data: readValues() });
                            return;
                        }
                    }

                    if (event.key === 'Enter') {
                        const active = document.activeElement;
                        if (active && active.tagName === 'INPUT') {
                            event.preventDefault();
                            submit();
                        }
                    }
                });
            </script>
        </body>
        </html>
    `;
}

async function getSourceMemberPromptMembers(library: string, sourceFile: string): Promise<SourceMemberPromptMemberInfo[]> {
    const connection = instance.getConnection();
    if (!connection) {
        throw new Error(`Not connected to IBM i.`);
    }

    const normalized = normalizeSourceMemberPromptData({ library, sourceFile, member: `` });
    const safeLibrary = normalized.library;
    const safeSourceFile = normalized.sourceFile;

    const statement = /* sql */
        `SELECT RTRIM(PART_STAT.SYSTEM_TABLE_MEMBER) AS MBRNAME,
            COALESCE(RTRIM(CAST(PART_STAT.SOURCE_TYPE AS VARCHAR(10))), '') AS SRCTYPE,
            COALESCE(RTRIM(VARCHAR(PART_STAT.TEXT)), '') AS MBRTEXT
           FROM TABLE (qsys2.object_statistics('${safeLibrary}', '*FILE', '${safeSourceFile}')) OBJ_STAT,
           LATERAL (SELECT * FROM TABLE (qsys2.PARTITION_STATISTICS(RPAD(OBJ_STAT.OBJLIB, 10), RPAD(OBJ_STAT.OBJNAME, 10)))) PART_STAT
          ORDER BY MBRNAME`;

    const rows = await connection.runSQL(statement) as { MBRNAME: string; SRCTYPE: string; MBRTEXT: string }[];
    return rows
        .map((row) => ({
            name: String(row.MBRNAME || ``).trim(),
            type: String(row.SRCTYPE || ``).trim(),
            text: String(row.MBRTEXT || ``).trim(),
        }))
        .filter((row) => row.name.length > 0);
}

async function promptForSourceMemberSelection(library: string, sourceFile: string): Promise<string | undefined> {
    const members = await getSourceMemberPromptMembers(library, sourceFile);

    if (!members.length) {
        vscode.window.showInformationMessage(`No source members found in ${library}/${sourceFile}.`);
        return;
    }

    const picked = await vscode.window.showQuickPick(
        members.map((member) => ({
            label: member.name,
            description: member.type ? `.${member.type}` : undefined,
            detail: member.text || undefined,
            member: member.name,
        })),
        {
            title: `Select source member`,
            placeHolder: `${library}/${sourceFile}`,
            matchOnDescription: true,
            matchOnDetail: true,
        }
    );

    return picked?.member;
}

export async function promptForSourceMember(defaults: SourceMemberPromptInput = {}): Promise<SourceMemberPromptResult | undefined> {
    const initialValues = normalizeSourceMemberPromptData(defaults);
    const panel = vscode.window.createWebviewPanel(
        'ibmiSourceMemberPrompt',
        'Source member',
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
        }
    );

    panel.webview.html = buildSourceMemberPromptHtml(initialValues);

    return new Promise((resolve) => {
        let resolved = false;

        const finish = (result?: SourceMemberPromptResult) => {
            if (resolved) {
                return;
            }
            resolved = true;
            panel.dispose();
            resolve(result);
        };

        const listener = panel.webview.onDidReceiveMessage(async (message: { type?: string; data?: SourceMemberPromptInput }) => {
            switch (message.type) {
                case 'submit': {
                    const result = normalizeSourceMemberPromptData(message.data ?? {});
                    if (!result.library || !result.sourceFile || !result.member) {
                        return;
                    }
                    finish(result);
                    break;
                }

                case 'lookupMember': {
                    const data = normalizeSourceMemberPromptData(message.data ?? {});
                    if (!data.library || !data.sourceFile) {
                        vscode.window.showWarningMessage(`Library and Source file are required to list members.`);
                        return;
                    }

                    try {
                        const selectedMember = await promptForSourceMemberSelection(data.library, data.sourceFile);
                        if (selectedMember) {
                            panel.webview.postMessage({ type: 'setMember', data: { member: selectedMember } });
                        }
                    } catch (error: any) {
                        vscode.window.showErrorMessage(`Unable to list members for ${data.library}/${data.sourceFile}. ${error?.message || error}`);
                    }
                    break;
                }

                case 'cancel':
                    finish();
                    break;

                default:
                    break;
            }
        });

        panel.onDidDispose(() => {
            listener.dispose();
            if (!resolved) {
                resolve(undefined);
            }
        });
    });
}
