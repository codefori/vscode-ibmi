import path from "path";
import tmp from "tmp";
import util from "util";
import { commands, CompletionItem, CompletionItemKind, CompletionItemProvider, Disposable, l10n, languages, MarkdownString, Position, ProgressLocation, QuickPickItem, QuickPickItemKind, Range, Selection, SnippetString, TextDocument, TextEditor, Uri, window, workspace, WorkspaceEdit } from "vscode";
import IBMi from "../api/IBMi";
import { NamedSharedSnippet, SharedSnippets } from "../api/sharedSnippets";
import { getUriFromPath } from "../filesystems/qsys/QSysFs";
import Instance from "../Instance";
import { SharedSnippet } from "../typings";
import { VscodeTools } from "../ui/Tools";

const SNIPPETS_LANGUAGE = `snippets`;

const tmpDirectory = util.promisify(tmp.dir);

function parseScope(scope: string) {
  return scope.split(`,`).map(languageId => languageId.trim().toLocaleLowerCase()).filter(Boolean);
}

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
        expression += current.replace(/[.+^$|()\\\-\]]/, matched => `\\${matched}`);
    }
  }

  return new RegExp(`^${expression}$`, `i`).test(target);
}

function matches(snippet: SharedSnippet, document: { languageId: string, uri: Uri }) {
  if (snippet.scope && !parseScope(snippet.scope).includes(document.languageId.toLocaleLowerCase())) {
    return false;
  }

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
        SharedSnippets.invalidate(connection);
      }
    }),

    commands.registerCommand(`code-for-ibmi.openSharedSnippets`, async () => {
      const connection = instance.getConnection();
      if (connection) {
        await showSnippetsMenu(connection);
      }
    }),

    commands.registerCommand(`code-for-ibmi.createSharedSnippet`, async (languageId?: string) => {
      const connection = instance.getConnection();
      if (connection) {
        await createSnippet(connection, languageId !== undefined ? { languageId } : undefined);
      }
    })
  ];

  async function showSnippetsMenu(connection: IBMi) {
    const CREATE_LABEL = `$(add) ${l10n.t("Create new shared snippet...")}`;
    const selected = await selectSnippetsFile(connection, {
      placeHolder: l10n.t("Select a snippets file to edit"),
      extraItems: [{ label: CREATE_LABEL }, { label: ``, kind: QuickPickItemKind.Separator }]
    });

    if (selected?.label === CREATE_LABEL) {
      await createSnippet(connection);
    }
    else if (selected) {
      await openSnippetsFile(connection, selected.languageId);
    }
  }

  type SnippetsFileItem = QuickPickItem & { languageId?: string, newFile?: boolean };

  async function selectSnippetsFile(connection: IBMi, options: { placeHolder: string, extraItems?: SnippetsFileItem[] }) {
    const files = await SharedSnippets.getSnippetsFiles(connection, { forceReload: true });
    const global = files.find(file => !file.languageId);
    const languageFiles = files.filter(file => file.languageId).sort((f1, f2) => f1.languageId!.localeCompare(f2.languageId!));

    const items: SnippetsFileItem[] = [
      ...(options.extraItems || []),
      {
        label: `$(json) ${l10n.t("Global Snippets")}`,
        description: SharedSnippets.getFilePath(),
        detail: global ? countLabel(global.snippets.length) : l10n.t("Not created yet")
      },
      ...(languageFiles.length ? [{ label: l10n.t("Languages"), kind: QuickPickItemKind.Separator } as SnippetsFileItem] : []),
      ...languageFiles.map(file => ({
        label: `$(symbol-snippet) ${file.languageId}`,
        description: file.path,
        detail: countLabel(file.snippets.length),
        languageId: file.languageId
      })),
      { label: ``, kind: QuickPickItemKind.Separator },
      { label: `$(add) ${l10n.t("New language snippets file...")}`, newFile: true }
    ];

    const selected = await window.showQuickPick(items, { title: l10n.t("Shared Snippets"), placeHolder: options.placeHolder });
    if (selected?.newFile) {
      const languageId = await selectLanguage(languageFiles.map(file => file.languageId!));
      return languageId ? { label: languageId, languageId } : undefined;
    }

    return selected;
  }

  async function selectLanguage(existing: string[]) {
    const available = (await languages.getLanguages())
      //a language file named after the global one would silently take its place
      .filter(languageId => !existing.includes(languageId) && SharedSnippets.getFilePath(languageId) !== SharedSnippets.getFilePath())
      .sort((l1, l2) => l1.localeCompare(l2));

    return window.showQuickPick(available, {
      title: l10n.t("New language snippets file"),
      placeHolder: l10n.t("Select the language the snippets will apply to")
    });
  }

  async function createSnippet(connection: IBMi, target?: { languageId?: string }) {
    //Grabbed before any quick pick steals the focus from it
    const editor = window.activeTextEditor;

    const file = target || await selectSnippetsFile(connection, { placeHolder: l10n.t("Select the snippets file to add the snippet to") });
    if (!file) {
      return;
    }

    const filePath = SharedSnippets.getFilePath(file.languageId);
    if (await connection.getContent().testStreamFile(filePath, `e`) && !await connection.getContent().testStreamFile(filePath, `w`)) {
      window.showErrorMessage(l10n.t("You don't have the rights to write into {0}.", filePath));
      return;
    }

    const existingNames = (await SharedSnippets.getSnippetsFiles(connection)).find(f => f.path === filePath)?.snippets.map(snippet => snippet.name) || [];
    const name = await window.showInputBox({
      title: l10n.t("New shared snippet"),
      prompt: l10n.t("How the snippet is listed in the completion"),
      placeHolder: l10n.t("Snippet name..."),
      validateInput: input => validateName(input, existingNames)
    });

    if (!name) {
      return;
    }

    const prefix = await window.showInputBox({
      title: l10n.t("Shared snippet prefix"),
      prompt: l10n.t("Typed to trigger the snippet completion. Several prefixes can be given, comma separated"),
      placeHolder: l10n.t("Prefix..."),
      validateInput: validatePrefix
    });

    if (!prefix) {
      return;
    }

    const description = await window.showInputBox({
      title: l10n.t("Shared snippet description"),
      placeHolder: l10n.t("Description (optional)...")
    });

    if (description === undefined) {
      return;
    }

    //A language file's name already is its scope
    let scope;
    if (!file.languageId) {
      const languageIds = await selectScope();
      if (!languageIds) {
        return;
      }
      scope = languageIds.join(`,`) || undefined;
    }

    const body = await selectBody(name.trim(), file.languageId || scope?.split(`,`)[0] || editor?.document.languageId, editor);
    if (!body) {
      return;
    }

    const prefixes = parsePrefixes(prefix);
    const snippet: SharedSnippet = {
      prefix: prefixes.length === 1 ? prefixes[0] : prefixes,
      body: body.length === 1 ? body[0] : body,
      ...(description ? { description } : undefined),
      ...(scope ? { scope } : undefined)
    };

    await insertSnippet(connection, file.languageId, name.trim(), snippet);
  }

  /** Picking no language leaves the snippet unscoped, so that it applies to every language. */
  async function selectScope() {
    const available = (await languages.getLanguages()).sort((l1, l2) => l1.localeCompare(l2));
    return window.showQuickPick(available, {
      title: l10n.t("Shared snippet scope"),
      placeHolder: l10n.t("Select the languages the snippet applies to, or none to apply it to all of them"),
      canPickMany: true
    });
  }

  async function selectBody(name: string, languageId: string | undefined, editor?: TextEditor) {
    type BodyItem = QuickPickItem & { getText?: () => string };

    const items: BodyItem[] = [
      {
        label: `$(edit) ${l10n.t("Write the snippet's content...")}`,
        detail: l10n.t("Opens an editor where tab stops and placeholders can be used")
      },
      ...(editor && !editor.selection.isEmpty ? [{
        label: `$(selection) ${l10n.t("Use the current selection")}`,
        description: path.posix.basename(editor.document.uri.path),
        getText: () => editor.document.getText(editor.selection)
      }] : []),
      ...(editor ? [{
        label: `$(file-code) ${l10n.t("Use the whole active editor")}`,
        description: path.posix.basename(editor.document.uri.path),
        getText: () => editor.document.getText()
      }] : [])
    ];

    const selected = items.length === 1 ? items[0] : await window.showQuickPick(items, {
      title: l10n.t("Shared snippet content"),
      placeHolder: l10n.t("Select the snippet's content")
    });

    if (!selected) {
      return;
    }

    //A hand written body is left alone, so that it can carry tab stops and placeholders
    return selected.getText ? escapeBody(selected.getText()).split(/\r?\n/) : writeBody(name, languageId);
  }

  /**
   * An input box only takes a single line, so the content is written in a scratch file: saving it keeps
   * the content, closing it drops the snippet. A file rather than an untitled document, so that saving
   * is the plain save command and closing never asks where the content should be stored.
   */
  async function writeBody(name: string, languageId?: string) {
    const directory = await tmpDirectory();
    const scratch = Uri.file(path.join(directory, name.replace(/[\\/:*?"<>|]/g, `_`)));
    await workspace.fs.writeFile(scratch, Buffer.from(``, `utf8`));

    try {
      let document = await workspace.openTextDocument(scratch);
      if (languageId && document.languageId !== languageId) {
        //This reopens the document, so it has to be done before listening to its events
        document = await languages.setTextDocumentLanguage(document, languageId);
      }
      await window.showTextDocument(document, { preview: false });

      //A notification only stays up while it carries a running progress, and this one must stand
      //until the content is written - which is anything but a matter of seconds
      const body = await window.withProgress({
        location: ProgressLocation.Notification,
        title: l10n.t("Write the snippet's content, then save the editor to add it. Tab stops and placeholders can be used."),
        cancellable: true
      }, (progress, token) => new Promise<string | undefined>(resolve => {
        const listeners: Disposable[] = [];
        const finish = (written?: string) => {
          listeners.forEach(listener => listener.dispose());
          resolve(written);
        };

        listeners.push(
          workspace.onDidSaveTextDocument(saved => saved.uri.toString() === scratch.toString() ? finish(saved.getText()) : undefined),
          workspace.onDidCloseTextDocument(closed => closed.uri.toString() === scratch.toString() ? finish() : undefined),
          token.onCancellationRequested(() => finish())
        );
      }));

      return body?.split(/\r?\n/);
    }
    finally {
      //Reverted, so a cancelled snippet never asks to be saved
      const editor = window.visibleTextEditors.find(visible => visible.document.uri.toString() === scratch.toString());
      if (editor) {
        await window.showTextDocument(editor.document, { preview: false });
        await commands.executeCommand(`workbench.action.revertAndCloseActiveEditor`);
      }
      await workspace.fs.delete(Uri.file(directory), { recursive: true });
    }
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
      throw new Error(l10n.t("Could not add shared snippet '{0}' to {1}.", name, document.uri.path));
    }

    SharedSnippets.invalidate(connection);
    window.showInformationMessage(l10n.t("Created shared snippet '{0}'.", name));

    const added = new Position(position.line + 1, 0);
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
    item.detail = snippet.name;
    item.documentation = new MarkdownString(description);
    item.sortText = `0_${prefix}`; //push above other providers' matches
    item.insertText = new SnippetString(body);
    return item;
  });
}
