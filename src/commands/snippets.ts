import path from "path";
import { commands, CompletionItem, CompletionItemKind, CompletionItemProvider, Disposable, l10n, languages, MarkdownString, QuickPickItem, QuickPickItemKind, Range, Selection, SnippetString, TextDocument, TextEditor, Uri, window, workspace, WorkspaceEdit } from "vscode";
import IBMi from "../api/IBMi";
import { NamedSharedSnippet, SharedSnippets } from "../api/sharedSnippets";
import { getUriFromPath } from "../filesystems/qsys/QSysFs";
import Instance from "../Instance";
import { SharedSnippet } from "../typings";
import { VscodeTools } from "../ui/Tools";

const SNIPPETS_LANGUAGE = `snippets`;

function parsePrefixes(input: string) {
  return [...new Set(input.split(`,`).map(prefix => prefix.trim()).filter(Boolean))];
}

function validateName(name: string, existing: string[]) {
  if (!name.trim()) {
    return l10n.t("Name cannot be empty");
  }
  else if (VscodeTools.includesCaseInsensitive(existing, name)) {
    return l10n.t("This name is already used by another shared snippet");
  }
}

function validatePrefix(input: string) {
  const prefixes = parsePrefixes(input);
  if (!prefixes.length) {
    return l10n.t("Prefix cannot be empty");
  }
  else if (prefixes.some(prefix => /\s/.test(prefix))) {
    return l10n.t("Prefix cannot contain spaces");
  }
}

/** `$` and `\` drive the snippet syntax, so captured code must be escaped to be inserted back as it is. */
function escapeBody(text: string) {
  return text.replace(/[\\$]/g, matched => `\\${matched}`);
}

function toArray(value?: string | string[]) {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

/** The glob patterns VS Code supports for snippets: `*`, `**`, `?`, `{a,b}` and `[abc]`, case insensitive. */
function matchGlob(pattern: string, target: string) {
  let expression = ``;
  let braces = 0;

  for (let i = 0; i < pattern.length; i++) {
    const current = pattern[i];
    switch (current) {
      case `*`:
        if (pattern[i + 1] === `*`) {
          i++;
          if (pattern[i + 1] === `/`) {
            i++;
            expression += `(?:[^/]*\\/)*`; //any number of segments, none included
          }
          else {
            expression += `.*`;
          }
        }
        else {
          expression += `[^/]*`;
        }
        break;

      case `?`:
        expression += `[^/]`;
        break;

      case `{`:
        braces++;
        expression += `(?:`;
        break;

      case `}`:
        if (braces) {
          braces--;
          expression += `)`;
        }
        else {
          expression += `\\}`;
        }
        break;

      case `,`:
        expression += braces ? `|` : `,`;
        break;

      case `[`: {
        const end = pattern.indexOf(`]`, i + 1);
        if (end > i + 1) {
          expression += `[${pattern.substring(i + 1, end).replace(/^[!^]/, `^`)}]`;
          i = end;
        }
        else {
          expression += `\\[`;
        }
        break;
      }

      default:
        expression += current.replace(/[.+^$|()\\\-\]]/g, matched => `\\${matched}`);
    }
  }

  return new RegExp(`^${expression}$`, `i`).test(target);
}

function matches(snippet: SharedSnippet, document: { uri: Uri }) {
  return isFileIncluded(snippet, document.uri);
}

/** Same rules as VS Code: a pattern with a `/` matches the whole path, others match the file name only. */
function isFileIncluded(snippet: SharedSnippet, uri: Uri) {
  const uriPath = uri.scheme === `file` ? uri.fsPath : uri.path;
  const fileName = path.basename(uriPath);
  const getMatchTarget = (pattern: string) => pattern.includes(`/`) ? uriPath : fileName;

  if (toArray(snippet.exclude).filter(Boolean).some(pattern => matchGlob(pattern, getMatchTarget(pattern)))) {
    return false;
  }

  const include = toArray(snippet.include).filter(Boolean);
  return include.length ? include.some(pattern => matchGlob(pattern, getMatchTarget(pattern))) : true;
}

export function registerSnippetCommands(instance: Instance): Disposable[] {
  return [
    // '*' as selector isn't reliably invoked for custom schemes like "member" - list them explicitly instead
    languages.registerCompletionItemProvider(
      [{ scheme: `file` }, { scheme: `untitled` }, { scheme: `member` }, { scheme: `streamfile` }],
      new SharedSnippetCompletionItemProvider(instance)
    ),

    // Snippets files are edited like any other streamfile, and the editor knows nothing about our cache
    workspace.onDidSaveTextDocument(document => {
      const connection = instance.getConnection();
      if (connection && document.uri.scheme === `streamfile` && SharedSnippets.isSnippetsFile(document.uri.path)) {
        SharedSnippets.invalidate(connection, document.uri.path);
      }
    }),

    commands.registerCommand(`code-for-ibmi.openSharedSnippets`, async () => {
      const connection = instance.getConnection();
      if (connection) {
        await reportFailure(() => showSnippetsMenu(connection));
      }
    }),

    commands.registerCommand(`code-for-ibmi.createSharedSnippetFromDocument`, () => createSnippetFromEditor(editor => editor.document.getText())),

    commands.registerCommand(`code-for-ibmi.createSharedSnippetFromSelection`, () => createSnippetFromEditor(editor => editor.document.getText(editor.selection)))
  ];

  async function createSnippetFromEditor(getContent: (editor: TextEditor) => string) {
    //Grabbed before any quick pick steals the focus from it
    const editor = window.activeTextEditor;
    const connection = instance.getConnection();
    if (connection && editor) {
      await reportFailure(() => createSnippet(connection, editor.document.languageId, getContent(editor)));
    }
  }

  /** Snippets live on the IFS: creating or writing them can always be turned down by the system. */
  async function reportFailure(action: () => Promise<void>) {
    try {
      await action();
    }
    catch (error: any) {
      window.showErrorMessage(String(error.message || error));
    }
  }

  /** Writing a snippet by hand is what opening a snippets file is for: the JSON schema drives the content assist. */
  async function showSnippetsMenu(connection: IBMi) {
    const selected = await selectSnippetsFile(connection, l10n.t("Select a snippets file to open"));
    if (selected) {
      await openSnippetsFile(connection, selected.languageId);
    }
  }

  type SnippetsFileItem = QuickPickItem & { languageId?: string, newFile?: boolean };

  async function selectSnippetsFile(connection: IBMi, placeHolder: string, options?: { preferredLanguageId?: string, title?: string }) {
    const preferredLanguageId = options?.preferredLanguageId;
    const title = options?.title || l10n.t("Shared Snippets");
    const files = await SharedSnippets.getSnippetsFiles(connection, { forceReload: true });
    const global = files.find(file => !file.languageId);
    const languageFiles = files.filter(file => file.languageId).sort((f1, f2) => f1.languageId!.localeCompare(f2.languageId!));

    //When the snippet comes from an editor, the file for its language is the likely target - offer it first, creating it if needed
    const preferred = preferredLanguageId && SharedSnippets.getFilePath(preferredLanguageId) !== SharedSnippets.getFilePath() ? preferredLanguageId : undefined;
    const otherLanguageFiles = languageFiles.filter(file => file.languageId !== preferred);

    const languageItem = (languageId: string): SnippetsFileItem => {
      const existing = languageFiles.find(file => file.languageId === languageId);
      return {
        label: `$(symbol-snippet) ${languageId}`,
        description: SharedSnippets.getFilePath(languageId),
        detail: existing ? countLabel(existing.snippets.length) : l10n.t("Not created yet"),
        languageId
      };
    };

    const items: SnippetsFileItem[] = [
      ...(preferred ? [languageItem(preferred), { label: ``, kind: QuickPickItemKind.Separator } as SnippetsFileItem] : []),
      {
        label: `$(json) ${l10n.t("Global Snippets")}`,
        description: SharedSnippets.getFilePath(),
        detail: global ? countLabel(global.snippets.length) : l10n.t("Not created yet")
      },
      ...(otherLanguageFiles.length ? [{ label: l10n.t("Languages"), kind: QuickPickItemKind.Separator } as SnippetsFileItem] : []),
      ...otherLanguageFiles.map(file => languageItem(file.languageId!)),
      { label: ``, kind: QuickPickItemKind.Separator },
      { label: `$(add) ${l10n.t("New language snippets file...")}`, newFile: true }
    ];

    const selected = await window.showQuickPick(items, { title, placeHolder });
    if (selected?.newFile) {
      const languageId = await selectLanguage(languageFiles.map(file => file.languageId!), title);
      return languageId ? { label: languageId, languageId } : undefined;
    }

    return selected;
  }

  async function selectLanguage(existing: string[], title = l10n.t("New language snippets file")) {
    const available = (await languages.getLanguages())
      //a language file named after the global one would silently take its place
      .filter(languageId => !existing.includes(languageId) && SharedSnippets.getFilePath(languageId) !== SharedSnippets.getFilePath())
      .sort((l1, l2) => l1.localeCompare(l2));

    return window.showQuickPick(available, {
      title,
      placeHolder: l10n.t("Select the language the snippets will apply to")
    });
  }

  /** The snippet's content always comes from an editor: the wizard only asks for what surrounds it. */
  async function createSnippet(connection: IBMi, sourceLanguageId: string, content: string) {
    if (!content.trim()) {
      window.showWarningMessage(l10n.t("There is nothing to make a shared snippet out of."));
      return;
    }

    //VS Code UX guidelines: keep one title and show the progress through the wizard's steps
    const TOTAL_STEPS = 4;
    const stepTitle = (step: number) => l10n.t("New IBM i Shared Snippet ({0}/{1})", step, TOTAL_STEPS);

    const file = await selectSnippetsFile(connection, l10n.t("Select the snippets file to add the snippet to"), { preferredLanguageId: sourceLanguageId, title: stepTitle(1) });
    if (!file) {
      return;
    }

    //Fail before asking anything if the target file - or its folder - can't be written
    const accessError = await SharedSnippets.checkWriteAccess(connection, file.languageId);
    if (accessError) {
      window.showErrorMessage(accessError);
      return;
    }

    const filePath = SharedSnippets.getFilePath(file.languageId);
    const existingNames = (await SharedSnippets.getSnippetsFiles(connection)).find(f => f.path === filePath)?.snippets.map(snippet => snippet.name) || [];
    const name = await window.showInputBox({
      title: stepTitle(2),
      prompt: l10n.t("How the snippet is listed in the completion"),
      placeHolder: l10n.t("Snippet name..."),
      validateInput: input => validateName(input, existingNames)
    });

    if (!name) {
      return;
    }

    const prefix = await window.showInputBox({
      title: stepTitle(3),
      prompt: l10n.t("Typed to trigger the snippet completion. Several prefixes can be given, comma separated"),
      placeHolder: l10n.t("Prefix..."),
      validateInput: validatePrefix
    });

    if (!prefix) {
      return;
    }

    const description = await window.showInputBox({
      title: stepTitle(4),
      prompt: l10n.t("Shown next to the snippet in the completion details"),
      placeHolder: l10n.t("Description (optional)...")
    });

    if (description === undefined) {
      return;
    }

    const body = escapeBody(content).split(/\r?\n/);
    const prefixes = parsePrefixes(prefix);
    const snippet: SharedSnippet = {
      prefix: prefixes.length === 1 ? prefixes[0] : prefixes,
      body: body.length === 1 ? body[0] : body,
      ...(description ? { description } : undefined)
    };

    await insertSnippet(connection, file.languageId, name.trim(), snippet);
  }

  /** Written through the editor, so that it and the IFS never disagree on the file's content. */
  async function insertSnippet(connection: IBMi, languageId: string | undefined, name: string, snippet: SharedSnippet) {
    const editor = await openSnippetsFile(connection, languageId);
    const document = editor.document;
    const insertion = SharedSnippets.buildInsertion(document.getText(), name, snippet);
    const position = document.positionAt(insertion.offset);

    const edit = new WorkspaceEdit();
    edit.insert(document.uri, position, insertion.text);
    if (!await workspace.applyEdit(edit) || !await document.save()) {
      throw new Error(l10n.t("Could not add shared snippet '{0}' to {1}; you may not be allowed to write into this file.", name, document.uri.path));
    }

    SharedSnippets.invalidate(connection, document.uri.path);
    window.showInformationMessage(l10n.t("Created shared snippet '{0}'.", name));

    //The entry doesn't always start right at the insertion point: the separator comes first
    const added = document.positionAt(insertion.offset + insertion.text.match(/^[,\s]*/)![0].length);
    editor.selection = new Selection(added, added);
    editor.revealRange(new Range(added, document.positionAt(insertion.offset + insertion.text.length)));
  }

  async function openSnippetsFile(connection: IBMi, languageId?: string) {
    const filePath = await SharedSnippets.createSnippetsFile(connection, languageId);
    let document = await workspace.openTextDocument(getUriFromPath(filePath));
    if (document.languageId !== SNIPPETS_LANGUAGE) {
      document = await languages.setTextDocumentLanguage(document, SNIPPETS_LANGUAGE);
    }
    return window.showTextDocument(document);
  }

  function countLabel(count: number) {
    return count === 1 ? l10n.t("1 snippet") : l10n.t("{0} snippets", count);
  }
}

class SharedSnippetCompletionItemProvider implements CompletionItemProvider {
  constructor(private readonly instance: Instance) { }

  async provideCompletionItems(document: TextDocument) {
    const connection = this.instance.getConnection();
    if (!connection) {
      return;
    }

    const items: CompletionItem[] = [];
    for (const file of await SharedSnippets.getSnippetsFiles(connection)) {
      if (file.languageId && file.languageId !== document.languageId) {
        continue;
      }

      for (const snippet of file.snippets.filter(snippet => matches(snippet, document))) {
        items.push(...toCompletionItems(snippet));
      }
    }

    return items;
  }
}

function toCompletionItems(snippet: NamedSharedSnippet) {
  const body = toArray(snippet.body).join(`\n`);
  const description = toArray(snippet.description).join(`\n`);

  //Like VS Code does, a snippet with no prefix is offered under its name
  const prefixes = toArray(snippet.prefix).filter(Boolean);
  return (prefixes.length ? prefixes : [snippet.name]).map(prefix => {
    const item = new CompletionItem(prefix, CompletionItemKind.Snippet);
    item.detail = l10n.t("{0} (IBM i shared)", snippet.name);
    item.documentation = new MarkdownString(description);
    item.sortText = `0_${prefix}`; //push above other providers' matches
    item.insertText = new SnippetString(body);
    return item;
  });
}
