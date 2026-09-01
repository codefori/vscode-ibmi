import path from "path";
import { commands, CompletionItem, CompletionItemKind, CompletionItemProvider, Disposable, Event, EventEmitter, FileChangeEvent, FileChangeType, FileStat, FileSystemError, FileSystemProvider, FileType, l10n, languages, MarkdownString, QuickInputButton, QuickPickItem, SnippetString, TextDocument, ThemeIcon, Uri, window, workspace } from "vscode";
import IBMi from "../api/IBMi";
import { SharedSnippetTools } from "../api/sharedSnippets";
import Instance from "../Instance";
import { SharedSnippet } from "../typings";
import { VscodeTools } from "../ui/Tools";

/** Virtual files holding a snippet's body, so it can be edited like a source file. */
const SNIPPET_SCHEME = `code4isnippet`;

export namespace Snippets {
  export function validateName(name: string, names: string[]) {
    if (!name) {
      return l10n.t("Name cannot be empty");
    }
    else if (VscodeTools.includesCaseInsensitive(names, name)) {
      return l10n.t("This name is already used by another shared snippet");
    }
  }

  export function validatePrefix(prefix: string) {
    if (!parsePrefixes(prefix).length) {
      return l10n.t("Prefix cannot be empty");
    }
    else if (parsePrefixes(prefix).some(p => /\s/.test(p))) {
      return l10n.t("Prefix cannot contain spaces");
    }
  }

  /** "ordh, ORDHDR ,," -> ["ordh", "ORDHDR"] */
  export function parsePrefixes(input: string): string[] {
    return [...new Set(input.split(",").map(prefix => prefix.trim()).filter(Boolean))];
  }

  /** "rpgle, SQLRPGLE ,," -> ["rpgle", "sqlrpgle"] */
  export function parseScope(input: string): string[] {
    return [...new Set(input.split(",").map(scope => scope.trim().replace(/^\.+/, "").toLocaleLowerCase()).filter(Boolean))];
  }

  /** A snippet applies when one of its scopes matches the document's extension or language. */
  export function matches(snippet: SharedSnippet, extension: string, languageId: string) {
    return snippet.scope.some(scope => {
      const snippetScope = scope.toLocaleLowerCase();
      return snippetScope === extension || snippetScope === languageId;
    });
  }
}

export function registerSnippetCommands(instance: Instance): Disposable[] {
  const snippetFiles = new SharedSnippetFileSystemProvider(instance);

  return [
    workspace.registerFileSystemProvider(SNIPPET_SCHEME, snippetFiles, { isCaseSensitive: true }),

    // '*' as selector isn't reliably invoked for custom schemes like "member" - list the
    // schemes explicitly instead. Language filtering happens inside the provider itself.
    languages.registerCompletionItemProvider(
      [{ scheme: 'file' }, { scheme: 'untitled' }, { scheme: 'member' }, { scheme: 'streamfile' }],
      new SharedSnippetCompletionItemProvider(instance)
    ),

    // The snippets file can also be edited through the generic IFS editor, which knows
    // nothing about our cache - drop it on every save.
    workspace.onDidSaveTextDocument(document => {
      const connection = instance.getConnection();
      if (connection && document.uri.scheme === 'streamfile' && document.uri.path === SharedSnippetTools.getSnippetsFile()) {
        SharedSnippetTools.invalidate(connection);
      }
    }),

    commands.registerCommand("code-for-ibmi.snippet.create", async () => {
      const connection = instance.getConnection();
      if (connection) {
        const existingNames = (await SharedSnippetTools.getSnippets(connection)).map(snippet => snippet.name);
        const name = await window.showInputBox({
          title: l10n.t("New shared snippet"),
          placeHolder: l10n.t("Snippet name..."),
          validateInput: name => Snippets.validateName(name, existingNames)
        });

        if (name) {
          const prefix = await window.showInputBox({
            title: l10n.t("Shared snippet prefix"),
            prompt: l10n.t("Typed to trigger the snippet completion"),
            placeHolder: l10n.t("Prefix..."),
            validateInput: Snippets.validatePrefix
          });

          if (prefix) {
            const description = await window.showInputBox({
              title: l10n.t("Shared snippet description"),
              placeHolder: l10n.t("Description (optional)...")
            });

            const scopeInput = await window.showInputBox({
              title: l10n.t("Shared snippet scope"),
              prompt: l10n.t("Which file extensions/languages this snippet applies to"),
              placeHolder: l10n.t("File extension(s), comma separated, e.g. rpgle, sqlrpgle..."),
              value: "txt"
            });

            const scope = scopeInput ? Snippets.parseScope(scopeInput) : [];
            if (scope.length) {
              const snippet: SharedSnippet = {
                name,
                prefix: Snippets.parsePrefixes(prefix),
                description: description || "",
                scope,
                body: [""]
              };

              await SharedSnippetTools.createSnippet(connection, snippet);
              window.showInformationMessage(l10n.t("Created shared snippet '{0}'.", name));
              await commands.executeCommand("code-for-ibmi.snippet.open", snippet);
            }
          }
        }
      }
    }),

    commands.registerCommand("code-for-ibmi.snippet.publish", async () => {
      const connection = instance.getConnection();
      const editor = window.activeTextEditor;
      if (!editor) {
        window.showWarningMessage(l10n.t("No active editor to publish as a shared snippet."));
      }
      else if (connection) {
        const existingNames = (await SharedSnippetTools.getSnippets(connection)).map(snippet => snippet.name);
        const name = await window.showInputBox({
          title: l10n.t("Publish active editor as shared snippet"),
          placeHolder: l10n.t("Snippet name..."),
          validateInput: name => Snippets.validateName(name, existingNames)
        });

        if (name) {
          const prefix = await window.showInputBox({
            title: l10n.t("Shared snippet prefix"),
            prompt: l10n.t("Typed to trigger the snippet completion"),
            placeHolder: l10n.t("Prefix..."),
            validateInput: Snippets.validatePrefix
          });

          if (prefix) {
            const description = await window.showInputBox({
              title: l10n.t("Shared snippet description"),
              placeHolder: l10n.t("Description (optional)...")
            });

            const text = editor.selection.isEmpty ? editor.document.getText() : editor.document.getText(editor.selection);
            const detectedScope = path.extname(editor.document.uri.path).substring(1).toLocaleLowerCase() || "txt";

            const scopeInput = await window.showInputBox({
              title: l10n.t("Shared snippet scope"),
              prompt: l10n.t("Which file extensions/languages this snippet applies to"),
              placeHolder: l10n.t("File extension(s), comma separated, e.g. rpgle, sqlrpgle..."),
              value: detectedScope
            });

            const scope = scopeInput ? Snippets.parseScope(scopeInput) : [detectedScope];
            const snippet: SharedSnippet = {
              name,
              prefix: Snippets.parsePrefixes(prefix),
              description: description || "",
              scope: scope.length ? scope : [detectedScope],
              body: SharedSnippetTools.toBody(text)
            };

            await SharedSnippetTools.createSnippet(connection, snippet);
            window.showInformationMessage(l10n.t("Published shared snippet '{0}'.", name));
          }
        }
      }
    }),

    commands.registerCommand("code-for-ibmi.snippet.open", async (snippet: SharedSnippet) => {
      const document = await workspace.openTextDocument(snippetFiles.getUri(snippet));
      await window.showTextDocument(document);
    }),

    commands.registerCommand("code-for-ibmi.snippet.openFile", () =>
      commands.executeCommand("code-for-ibmi.openEditable", SharedSnippetTools.getSnippetsFile())),

    commands.registerCommand("code-for-ibmi.snippet.insert", async (snippet: SharedSnippet) => {
      const editor = window.activeTextEditor;
      if (!editor) {
        window.showWarningMessage(l10n.t("No active editor to insert the shared snippet into."));
      }
      else {
        editor.insertSnippet(new SnippetString(SharedSnippetTools.getBodyText(snippet)));
      }
    }),

    commands.registerCommand("code-for-ibmi.snippet.rename", async (snippet: SharedSnippet) => {
      const connection = instance.getConnection();
      if (connection) {
        const existingNames = (await SharedSnippetTools.getSnippets(connection)).map(s => s.name).filter(n => n !== snippet.name);
        const newName = await window.showInputBox({
          title: l10n.t("Rename shared snippet"),
          placeHolder: l10n.t("Snippet name..."),
          value: snippet.name,
          validateInput: name => Snippets.validateName(name, existingNames)
        });

        if (newName) {
          const newPrefix = await window.showInputBox({
            title: l10n.t("Shared snippet prefix"),
            placeHolder: l10n.t("Prefix..."),
            value: snippet.prefix.join(", "),
            validateInput: Snippets.validatePrefix
          });

          if (newPrefix) {
            const newDescription = await window.showInputBox({
              title: l10n.t("Shared snippet description"),
              placeHolder: l10n.t("Description (optional)..."),
              value: snippet.description
            });

            const newScopeInput = await window.showInputBox({
              title: l10n.t("Shared snippet scope"),
              placeHolder: l10n.t("File extension(s), comma separated, e.g. rpgle, sqlrpgle..."),
              value: snippet.scope.join(", ")
            });
            const newScope = newScopeInput ? Snippets.parseScope(newScopeInput) : snippet.scope;

            await SharedSnippetTools.updateSnippet(connection, snippet, {
              newName,
              newPrefix: Snippets.parsePrefixes(newPrefix),
              newDescription: newDescription ?? snippet.description,
              newScope: newScope.length ? newScope : snippet.scope
            });
            snippetFiles.renamed(snippet.name, newName);
            window.showInformationMessage(l10n.t("Updated shared snippet '{0}'.", newName));
          }
        }
      }
    }),

    commands.registerCommand("code-for-ibmi.snippet.delete", async (snippet: SharedSnippet) => {
      const connection = instance.getConnection();
      if (connection && await window.showInformationMessage(l10n.t("Do you really want to delete shared snippet '{0}' ?", snippet.name), { modal: true }, l10n.t("Yes"))) {
        await SharedSnippetTools.updateSnippet(connection, snippet, { delete: true });
        window.showInformationMessage(l10n.t("Deleted shared snippet '{0}'.", snippet.name));
      }
    }),

    commands.registerCommand("code-for-ibmi.openSharedSnippets", async () => {
      const connection = instance.getConnection();
      if (connection) {
        await showSnippetsMenu(connection);
      }
    })
  ];

  async function showSnippetsMenu(connection: IBMi) {
    const snippets = await SharedSnippetTools.getSnippets(connection);

    const openButton: QuickInputButton = { iconPath: new ThemeIcon("go-to-file"), tooltip: l10n.t("Open for editing") };
    const renameButton: QuickInputButton = { iconPath: new ThemeIcon("edit"), tooltip: l10n.t("Rename...") };
    const deleteButton: QuickInputButton = { iconPath: new ThemeIcon("trash"), tooltip: l10n.t("Delete...") };

    const CREATE_LABEL = `$(add) ${l10n.t("Create new shared snippet...")}`;
    const PUBLISH_LABEL = `$(cloud-upload) ${l10n.t("Publish active editor as shared snippet...")}`;
    const OPEN_FILE_LABEL = `$(json) ${l10n.t("Open snippets.json...")}`;

    type SnippetQuickPickItem = QuickPickItem & { snippet?: SharedSnippet };

    const items: SnippetQuickPickItem[] = [
      { label: CREATE_LABEL },
      ...(window.activeTextEditor ? [{ label: PUBLISH_LABEL }] : []),
      { label: OPEN_FILE_LABEL },
      ...snippets.map(snippet => ({
        label: `$(symbol-snippet) ${snippet.name}`,
        description: snippet.prefix.join(", "),
        detail: snippet.description,
        buttons: [openButton, renameButton, deleteButton],
        snippet
      }))
    ];

    const quickPick = window.createQuickPick<SnippetQuickPickItem>();
    quickPick.title = l10n.t("Shared Snippets");
    quickPick.placeholder = l10n.t("Select a snippet to insert at the cursor");
    quickPick.items = items;

    quickPick.onDidAccept(() => {
      const selected = quickPick.selectedItems[0];
      if (selected) {
        quickPick.hide();
        if (selected.label === CREATE_LABEL) {
          commands.executeCommand("code-for-ibmi.snippet.create");
        }
        else if (selected.label === PUBLISH_LABEL) {
          commands.executeCommand("code-for-ibmi.snippet.publish");
        }
        else if (selected.label === OPEN_FILE_LABEL) {
          commands.executeCommand("code-for-ibmi.snippet.openFile");
        }
        else if (selected.snippet) {
          commands.executeCommand("code-for-ibmi.snippet.insert", selected.snippet);
        }
      }
    });

    quickPick.onDidTriggerItemButton(event => {
      quickPick.hide();
      const snippet = event.item.snippet;
      if (snippet) {
        if (event.button === openButton) {
          commands.executeCommand("code-for-ibmi.snippet.open", snippet);
        }
        else if (event.button === renameButton) {
          commands.executeCommand("code-for-ibmi.snippet.rename", snippet);
        }
        else if (event.button === deleteButton) {
          commands.executeCommand("code-for-ibmi.snippet.delete", snippet);
        }
      }
    });

    quickPick.onDidHide(() => quickPick.dispose());
    quickPick.show();
  }
}

/**
 * Backs the `code4isnippet:` scheme: a snippet's body is opened as a virtual file named
 * after the snippet - so the editor picks the right language - and saving it writes the
 * body back into the shared snippets file.
 */
class SharedSnippetFileSystemProvider implements FileSystemProvider {
  private readonly emitter = new EventEmitter<FileChangeEvent[]>();
  readonly onDidChangeFile: Event<FileChangeEvent[]> = this.emitter.event;
  /** uri path -> snippet name, since the file name is sanitized and the name is not */
  private readonly names = new Map<string, string>();

  constructor(private readonly instance: Instance) { }

  getUri(snippet: SharedSnippet) {
    const fileName = SharedSnippetTools.sanitizeFileName(snippet.name, snippet.scope[0] || `txt`);
    let uriPath = `/${fileName}`;
    // two snippets can sanitize down to the same file name; keep one path per snippet
    for (let suffix = 2; this.names.has(uriPath) && this.names.get(uriPath) !== snippet.name; suffix++) {
      uriPath = `/${suffix}_${fileName}`;
    }

    this.names.set(uriPath, snippet.name);
    return Uri.from({ scheme: SNIPPET_SCHEME, path: uriPath });
  }

  /** Keeps open editors pointing at a snippet that was renamed. */
  renamed(oldName: string, newName: string) {
    for (const [uriPath, name] of this.names) {
      if (name === oldName) {
        this.names.set(uriPath, newName);
      }
    }
  }

  async stat(uri: Uri): Promise<FileStat> {
    const snippet = await this.getSnippet(uri);
    return {
      type: FileType.File,
      ctime: 0,
      mtime: 0,
      size: Buffer.byteLength(SharedSnippetTools.getBodyText(snippet), `utf8`)
    };
  }

  async readFile(uri: Uri): Promise<Uint8Array> {
    return Buffer.from(SharedSnippetTools.getBodyText(await this.getSnippet(uri)), `utf8`);
  }

  async writeFile(uri: Uri, content: Uint8Array): Promise<void> {
    const connection = this.instance.getConnection();
    if (!connection) {
      throw FileSystemError.Unavailable(uri);
    }

    const snippet = await this.getSnippet(uri);
    await SharedSnippetTools.updateSnippet(connection, snippet, { newBody: SharedSnippetTools.toBody(Buffer.from(content).toString(`utf8`)) });
    this.emitter.fire([{ type: FileChangeType.Changed, uri }]);
  }

  watch(): Disposable {
    return new Disposable(() => { });
  }

  readDirectory(): [string, FileType][] {
    return [];
  }

  createDirectory(uri: Uri): void {
    throw FileSystemError.NoPermissions(uri);
  }

  delete(uri: Uri): void {
    throw FileSystemError.NoPermissions(uri);
  }

  rename(uri: Uri): void {
    throw FileSystemError.NoPermissions(uri);
  }

  private async getSnippet(uri: Uri) {
    const connection = this.instance.getConnection();
    const name = this.names.get(uri.path);
    const snippet = connection && name ? (await SharedSnippetTools.getSnippets(connection)).find(s => s.name === name) : undefined;
    if (!snippet) {
      throw FileSystemError.FileNotFound(uri);
    }
    return snippet;
  }
}

/**
 * Offers the shared snippets as completions (prefix -> Tab to expand).
 */
class SharedSnippetCompletionItemProvider implements CompletionItemProvider {
  constructor(private readonly instance: Instance) { }

  async provideCompletionItems(document: TextDocument) {
    const connection = this.instance.getConnection();
    if (!connection) {
      return;
    }

    // extension covers saved files; languageId also catches an untitled buffer with a manually-picked language
    // used for example in db2 ext
    const extension = path.extname(document.uri.path).substring(1).toLocaleLowerCase();
    const languageId = document.languageId.toLocaleLowerCase();
    const snippets = await SharedSnippetTools.getSnippets(connection);

    return snippets.filter(snippet => Snippets.matches(snippet, extension, languageId))
      .flatMap(snippet => snippet.prefix.map(prefix => {
        const item = new CompletionItem(prefix, CompletionItemKind.Snippet);
        item.detail = snippet.name;
        item.documentation = new MarkdownString(snippet.description);
        item.sortText = `0_${prefix}`; // push above other providers' matches
        item.insertText = new SnippetString(SharedSnippetTools.getBodyText(snippet));
        return item;
      }));
  }
}
