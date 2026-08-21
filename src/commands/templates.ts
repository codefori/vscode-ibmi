import path from "path";
import { commands, CompletionItem, CompletionItemKind, CompletionItemProvider, Disposable, l10n, languages, MarkdownString, QuickInputButton, QuickPickItem, SnippetString, TextDocument, ThemeIcon, window } from "vscode";
import IBMi from "../api/IBMi";
import { SharedTemplateTools } from "../api/sharedTemplates";
import Instance from "../Instance";
import { SharedTemplate } from "../typings";
import { VscodeTools } from "../ui/Tools";

export namespace Templates {
  export function validateName(name: string, names: string[]) {
    if (!name) {
      return l10n.t("Name cannot be empty");
    }
    else if (VscodeTools.includesCaseInsensitive(names, name)) {
      return l10n.t("This name is already used by another shared template");
    }
  }

  export function validatePrefix(prefix: string) {
    if (!prefix) {
      return l10n.t("Prefix cannot be empty");
    }
    else if (/\s/.test(prefix)) {
      return l10n.t("Prefix cannot contain spaces");
    }
  }

  /** "rpgle, SQLRPGLE ,," -> ["rpgle", "sqlrpgle"] */
  export function parseExtensions(input: string): string[] {
    return [...new Set(input.split(",").map(ext => ext.trim().replace(/^\.+/, "").toLocaleLowerCase()).filter(Boolean))];
  }
}

export function registerTemplateCommands(instance: Instance): Disposable[] {
  return [
    // '*' as selector isn't reliably invoked for custom schemes like "member" - list the
    // schemes explicitly instead. Language filtering happens inside the provider itself.
    languages.registerCompletionItemProvider(
      [{ scheme: 'file' }, { scheme: 'untitled' }, { scheme: 'member' }, { scheme: 'streamfile' }],
      new SharedTemplateCompletionItemProvider(instance)
    ),

    commands.registerCommand("code-for-ibmi.template.create", async () => {
      const connection = instance.getConnection();
      if (connection) {
        const existingNames = (await SharedTemplateTools.getTemplates(connection)).map(template => template.name);
        const name = await window.showInputBox({
          title: l10n.t("New shared template"),
          placeHolder: l10n.t("Template name..."),
          validateInput: name => Templates.validateName(name, existingNames)
        });

        if (name) {
          const prefix = await window.showInputBox({
            title: l10n.t("Shared template prefix"),
            prompt: l10n.t("Typed to trigger the snippet completion"),
            placeHolder: l10n.t("Prefix..."),
            validateInput: Templates.validatePrefix
          });

          if (prefix) {
            const description = await window.showInputBox({
              title: l10n.t("Shared template description"),
              placeHolder: l10n.t("Description (optional)...")
            });

            const extensionsInput = await window.showInputBox({
              title: l10n.t("Shared template extensions"),
              prompt: l10n.t("Which file extensions/languages this snippet applies to"),
              placeHolder: l10n.t("File extension(s), comma separated, e.g. rpgle, sqlrpgle..."),
              value: "txt"
            });

            const extensions = extensionsInput ? Templates.parseExtensions(extensionsInput) : [];
            if (extensions.length) {
              const template: SharedTemplate = {
                name,
                prefix,
                description: description || "",
                file: SharedTemplateTools.sanitizeFileName(name, extensions[0]),
                extensions
              };

              await SharedTemplateTools.createTemplate(connection, template, "");
              window.showInformationMessage(l10n.t("Created shared template '{0}'.", name));
              await commands.executeCommand("code-for-ibmi.openEditable", SharedTemplateTools.getTemplatePath(template));
            }
          }
        }
      }
    }),

    commands.registerCommand("code-for-ibmi.template.publish", async () => {
      const connection = instance.getConnection();
      const editor = window.activeTextEditor;
      if (!editor) {
        window.showWarningMessage(l10n.t("No active editor to publish as a shared template."));
      }
      else if (connection) {
        const existingNames = (await SharedTemplateTools.getTemplates(connection)).map(template => template.name);
        const name = await window.showInputBox({
          title: l10n.t("Publish active editor as shared template"),
          placeHolder: l10n.t("Template name..."),
          validateInput: name => Templates.validateName(name, existingNames)
        });

        if (name) {
          const prefix = await window.showInputBox({
            title: l10n.t("Shared template prefix"),
            prompt: l10n.t("Typed to trigger the snippet completion"),
            placeHolder: l10n.t("Prefix..."),
            validateInput: Templates.validatePrefix
          });

          if (prefix) {
            const description = await window.showInputBox({
              title: l10n.t("Shared template description"),
              placeHolder: l10n.t("Description (optional)...")
            });

            const text = editor.selection.isEmpty ? editor.document.getText() : editor.document.getText(editor.selection);
            const detectedExtension = path.extname(editor.document.uri.path).substring(1).toLocaleLowerCase() || "txt";

            const extensionsInput = await window.showInputBox({
              title: l10n.t("Shared template extensions"),
              prompt: l10n.t("Which file extensions/languages this snippet applies to"),
              placeHolder: l10n.t("File extension(s), comma separated, e.g. rpgle, sqlrpgle..."),
              value: detectedExtension
            });

            const extensions = extensionsInput ? Templates.parseExtensions(extensionsInput) : [detectedExtension];
            const template: SharedTemplate = {
              name,
              prefix,
              description: description || "",
              file: SharedTemplateTools.sanitizeFileName(name, extensions[0] || detectedExtension),
              extensions: extensions.length ? extensions : [detectedExtension]
            };

            await SharedTemplateTools.createTemplate(connection, template, text);
            window.showInformationMessage(l10n.t("Published shared template '{0}'.", name));
          }
        }
      }
    }),

    commands.registerCommand("code-for-ibmi.template.open", (template: SharedTemplate) =>
      commands.executeCommand("code-for-ibmi.openEditable", SharedTemplateTools.getTemplatePath(template))),

    commands.registerCommand("code-for-ibmi.template.insert", async (template: SharedTemplate) => {
      const connection = instance.getConnection();
      const editor = window.activeTextEditor;
      if (!editor) {
        window.showWarningMessage(l10n.t("No active editor to insert the shared template into."));
      }
      else if (connection) {
        const content = await SharedTemplateTools.getTemplateContent(connection, template);
        editor.insertSnippet(new SnippetString(content));
      }
    }),

    commands.registerCommand("code-for-ibmi.template.rename", async (template: SharedTemplate) => {
      const connection = instance.getConnection();
      if (connection) {
        const existingNames = (await SharedTemplateTools.getTemplates(connection)).map(t => t.name).filter(n => n !== template.name);
        const newName = await window.showInputBox({
          title: l10n.t("Rename shared template"),
          placeHolder: l10n.t("Template name..."),
          value: template.name,
          validateInput: name => Templates.validateName(name, existingNames)
        });

        if (newName) {
          const newPrefix = await window.showInputBox({
            title: l10n.t("Shared template prefix"),
            placeHolder: l10n.t("Prefix..."),
            value: template.prefix,
            validateInput: Templates.validatePrefix
          });

          if (newPrefix) {
            const newDescription = await window.showInputBox({
              title: l10n.t("Shared template description"),
              placeHolder: l10n.t("Description (optional)..."),
              value: template.description
            });

            const newExtensionsInput = await window.showInputBox({
              title: l10n.t("Shared template extensions"),
              placeHolder: l10n.t("File extension(s), comma separated, e.g. rpgle, sqlrpgle..."),
              value: template.extensions.join(", ")
            });
            const newExtensions = newExtensionsInput ? Templates.parseExtensions(newExtensionsInput) : template.extensions;

            await SharedTemplateTools.updateTemplate(connection, template, {
              newName,
              newPrefix,
              newDescription: newDescription ?? template.description,
              newExtensions: newExtensions.length ? newExtensions : template.extensions
            });
            window.showInformationMessage(l10n.t("Updated shared template '{0}'.", newName));
          }
        }
      }
    }),

    commands.registerCommand("code-for-ibmi.template.delete", async (template: SharedTemplate) => {
      const connection = instance.getConnection();
      if (connection && await window.showInformationMessage(l10n.t("Do you really want to delete shared template '{0}' ?", template.name), { modal: true }, l10n.t("Yes"))) {
        await SharedTemplateTools.updateTemplate(connection, template, { delete: true });
        window.showInformationMessage(l10n.t("Deleted shared template '{0}'.", template.name));
      }
    }),

    commands.registerCommand("code-for-ibmi.openSharedTemplate", async () => {
      const connection = instance.getConnection();
      if (connection) {
        await showTemplatesMenu(connection);
      }
    })
  ];

  async function showTemplatesMenu(connection: IBMi) {
    const templates = await SharedTemplateTools.getTemplates(connection);

    const openButton: QuickInputButton = { iconPath: new ThemeIcon("go-to-file"), tooltip: l10n.t("Open for editing") };
    const renameButton: QuickInputButton = { iconPath: new ThemeIcon("edit"), tooltip: l10n.t("Rename...") };
    const deleteButton: QuickInputButton = { iconPath: new ThemeIcon("trash"), tooltip: l10n.t("Delete...") };

    const CREATE_LABEL = `$(add) ${l10n.t("Create new shared template...")}`;
    const PUBLISH_LABEL = `$(cloud-upload) ${l10n.t("Publish active editor as shared template...")}`;

    type TemplateQuickPickItem = QuickPickItem & { template?: SharedTemplate };

    const items: TemplateQuickPickItem[] = [
      { label: CREATE_LABEL },
      ...(window.activeTextEditor ? [{ label: PUBLISH_LABEL }] : []),
      ...templates.map(template => ({
        label: `$(symbol-snippet) ${template.name}`,
        description: template.prefix,
        detail: template.description,
        buttons: [openButton, renameButton, deleteButton],
        template
      }))
    ];

    const quickPick = window.createQuickPick<TemplateQuickPickItem>();
    quickPick.title = l10n.t("Shared Templates");
    quickPick.placeholder = l10n.t("Select a template to insert at the cursor");
    quickPick.items = items;

    quickPick.onDidAccept(() => {
      const selected = quickPick.selectedItems[0];
      if (selected) {
        quickPick.hide();
        if (selected.label === CREATE_LABEL) {
          commands.executeCommand("code-for-ibmi.template.create");
        }
        else if (selected.label === PUBLISH_LABEL) {
          commands.executeCommand("code-for-ibmi.template.publish");
        }
        else if (selected.template) {
          commands.executeCommand("code-for-ibmi.template.insert", selected.template);
        }
      }
    });

    quickPick.onDidTriggerItemButton(event => {
      quickPick.hide();
      const template = event.item.template;
      if (template) {
        if (event.button === openButton) {
          commands.executeCommand("code-for-ibmi.template.open", template);
        }
        else if (event.button === renameButton) {
          commands.executeCommand("code-for-ibmi.template.rename", template);
        }
        else if (event.button === deleteButton) {
          commands.executeCommand("code-for-ibmi.template.delete", template);
        }
      }
    });

    quickPick.onDidHide(() => quickPick.dispose());
    quickPick.show();
  }
}

/**
 * Offers shared templates as snippet completions (prefix -> Tab to expand).
 * Content is fetched eagerly here rather than in resolveCompletionItem, since
 * resolve isn't guaranteed to finish before the item gets committed.
 */
class SharedTemplateCompletionItemProvider implements CompletionItemProvider {
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
    const templates = await SharedTemplateTools.getTemplates(connection);

    const matching = templates.filter(template =>
      template.extensions.some(ext => {
        const templateExtension = ext.toLocaleLowerCase();
        return templateExtension === extension || templateExtension === languageId;
      })
    );

    return Promise.all(matching.map(async template => {
      const item = new CompletionItem(template.prefix, CompletionItemKind.Snippet);
      item.detail = template.name;
      item.documentation = new MarkdownString(template.description);
      item.sortText = `0_${template.prefix}`; // push above other providers' matches
      const content = await SharedTemplateTools.getTemplateContent(connection, template);
      item.insertText = new SnippetString(content);
      return item;
    }));
  }
}
