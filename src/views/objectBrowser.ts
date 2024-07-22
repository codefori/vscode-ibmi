import fs, { existsSync } from "fs";
import os from "os";
import path, { basename, dirname } from "path";
import vscode from "vscode";
import { ConnectionConfiguration, DefaultOpenMode, GlobalConfiguration } from "../api/Configuration";
import { parseFilter } from "../api/Filter";
import { MemberParts } from "../api/IBMi";
import { SortOptions, SortOrder } from "../api/IBMiContent";
import { Search } from "../api/Search";
import { GlobalStorage } from '../api/Storage';
import { Tools } from "../api/Tools";
import { getMemberUri } from "../filesystems/qsys/QSysFs";
import { instance } from "../instantiate";
import { t } from "../locale";
import { BrowserItem, BrowserItemParameters, CommandResult, FilteredItem, FocusOptions, IBMiMember, IBMiObject, MemberItem, OBJECT_BROWSER_MIMETYPE, ObjectItem, WithLibrary } from "../typings";
import { editFilter } from "../webviews/filters";

const URI_LIST_SEPARATOR = "\r\n";

const objectNamesLower = () => GlobalConfiguration.get<boolean>(`ObjectBrowser.showNamesInLowercase`);
const objectSortOrder = () => GlobalConfiguration.get<SortOrder>(`ObjectBrowser.sortObjectsByName`) ? `name` : `type`;

const correctCase = (value: string) => {
  ;
  if (objectNamesLower()) {
    return value.toLocaleLowerCase();
  } else {
    return value;
  }
}

//https://code.visualstudio.com/api/references/icons-in-labels
const objectIcons = {
  'FILE': `database`,
  'CMD': `terminal`,
  'MODULE': `extensions`,
  'PGM': `file-binary`,
  'DTAARA': `clippy`,
  'DTAQ': `list-ordered`,
  'JOBQ': `checklist`,
  'LIB': `library`,
  'MEDDFN': `save-all`,
  'OUTQ': `symbol-enum`,
  'PNLGRP': `book`,
  'SBSD': `server-process`,
  'SRVPGM': `file-submodule`,
  'USRSPC': `chrome-maximize`,
  '': `circle-large-outline`
}

abstract class ObjectBrowserItem extends BrowserItem {
  constructor(readonly filter: ConnectionConfiguration.ObjectFilters, label: string, params?: BrowserItemParameters) {
    super(label, params);
  }

  refresh(): void {
    vscode.commands.executeCommand(`code-for-ibmi.refreshObjectBrowserItem`, this);
  }

  reveal(options?: FocusOptions) {
    return vscode.commands.executeCommand<void>(`code-for-ibmi.revealInObjectBrowser`, this, options);
  }

  abstract toString(): string;
  abstract delete(): Promise<boolean>;
  abstract isProtected(): boolean;
}

class ObjectBrowser implements vscode.TreeDataProvider<BrowserItem> {
  private readonly emitter = new vscode.EventEmitter<BrowserItem | BrowserItem[] | undefined | null | void>();
  readonly onDidChangeTreeData = this.emitter.event;

  async moveFilterInList(node: ObjectBrowserItem, filterMovement: `TOP` | `UP` | `DOWN` | `BOTTOM`) {
    const config = getConfig();
    if (config) {
      const filterName = node.filter.name;
      const objectFilters = config.objectFilters;
      const from = objectFilters.findIndex(filter => filter.name === filterName);
      let to;

      if (from === -1) throw `Filter ${filterName} is not found in list`;
      if (from === 0 && [`TOP`, `UP`].includes(filterMovement)) throw `Filter ${filterName} is at top of list`;
      if (from === objectFilters.length && [`DOWN`, `BOTTOM`].includes(filterMovement)) throw `Filter ${filterName} is at bottom of list`;

      switch (filterMovement) {
        case `TOP`:
          to = 0;
          break;
        case `UP`:
          to = from - 1;
          break;
        case `DOWN`:
          to = from + 1;
          break;
        case `BOTTOM`:
          to = objectFilters.length;
          break;
      }

      const filter = objectFilters[from];
      objectFilters.splice(from, 1);
      objectFilters.splice(to, 0, filter);
      config.objectFilters = objectFilters;
      await ConnectionConfiguration.update(config);
      this.autoRefresh();
    }
  }

  refresh(node?: BrowserItem) {
    this.emitter.fire(node);
  }

  autoRefresh(message?: string) {
    const autoRefresh = GlobalConfiguration.get(`autoRefresh`);
    if (autoRefresh) {
      if (message) {
        vscode.window.showInformationMessage(message);
      }

      this.refresh();
    }

    return autoRefresh;
  }

  getTreeItem(element: BrowserItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: BrowserItem): vscode.ProviderResult<BrowserItem[]> {
    return element?.getChildren?.() || this.getFilters();
  }

  getFilters(): BrowserItem[] {
    const config = getConfig();
    const filters = config.objectFilters;
    if (filters.length) {
      return filters.map(filter => new ObjectBrowserFilterItem(filter));
    } else {
      return [new CreateFilterItem()];
    }
  }

  getParent(element: BrowserItem): vscode.ProviderResult<BrowserItem> {
    return element.parent;
  }

  async resolveTreeItem(item: vscode.TreeItem, element: BrowserItem, token: vscode.CancellationToken): Promise<BrowserItem> {
    if (element.getToolTip) {
      element.tooltip = await element.getToolTip();
    }

    return element;
  }
}

class CreateFilterItem extends BrowserItem {
  constructor() {
    super(`${t('objectBrowser.createFilter')}...`, { icon: "add" });
    this.command = {
      command: `code-for-ibmi.maintainFilter`,
      title: `Create new filter`
    };
  }

  getChildren() {
    return [];
  }
}

class ObjectBrowserFilterItem extends ObjectBrowserItem implements WithLibrary {
  readonly library: string;
  constructor(filter: ConnectionConfiguration.ObjectFilters) {
    super(filter, filter.name, { icon: filter.protected ? `lock-small` : '', state: vscode.TreeItemCollapsibleState.Collapsed });
    this.library = parseFilter(filter.library, filter.filterType).noFilter ? filter.library : '';
    this.contextValue = `filter${this.library ? "_library" : ''}${this.isProtected() ? `_readonly` : ``}`;
    this.description = `${filter.library}/${filter.object}/${filter.member}.${filter.memberType || `*`} (${filter.types.join(`, `)})`;
    this.tooltip = ``;
  }

  isProtected(): boolean {
    return this.filter.protected;
  }

  async getChildren(): Promise<ObjectBrowserItem[]> {
    const libraryFilter = parseFilter(this.filter.library);
    if (libraryFilter.noFilter) {
      return await listObjects(this);
    }
    else {
      return (await getContent().getLibraries(this.filter))
        .map(object => {
          return object.sourceFile ? new ObjectBrowserSourcePhysicalFileItem(this, object) : new ObjectBrowserObjectItem(this, object);
        });
    }
  }

  toString(): string {
    return `${this.filter.name} (filter)`;
  }

  async delete() {
    const config = getConfig();
    const filter = this.filter;
    const index = config.objectFilters.findIndex(f => f.name === filter.name);

    if (index > -1) {
      config.objectFilters.splice(index, 1);
      await ConnectionConfiguration.update(config);

    }

    return true;
  }
}

class ObjectBrowserSourcePhysicalFileItem extends ObjectBrowserItem implements ObjectItem {
  readonly sort: SortOptions = { order: "name", ascending: true };
  readonly path: string;

  constructor(parent: ObjectBrowserFilterItem, readonly object: IBMiObject) {
    const type = object.type.startsWith(`*`) ? object.type.substring(1) : object.type;
    super(parent.filter, correctCase(object.name), { parent, icon: `file-directory`, state: vscode.TreeItemCollapsibleState.Collapsed });

    this.contextValue = `SPF${this.isProtected() ? `_readonly` : ``}`;
    this.updateDescription();

    this.path = [object.library, object.name].join(`/`);

    this.resourceUri = vscode.Uri.from({
      scheme: `object`,
      path: `/${object.library}/${object.name}.${type}`,
    });
  }

  isProtected(): boolean {
    return this.filter.protected || getContent().isProtectedPath(this.object.library);
  }

  sortBy(sort: SortOptions) {
    if (this.sort.order !== sort.order) {
      this.sort.order = sort.order;
      this.sort.ascending = true;
    }
    else {
      this.sort.ascending = !this.sort.ascending
    }
    this.updateDescription(true);
    this.description = `${this.object.text ? `${this.object.text} ` : ``}(sort: ${this.sort.order} ${this.sort.ascending ? `🔼` : `🔽`})`;
    this.reveal({ expand: true });
    this.refresh();
  }

  updateDescription(includeOrder?: boolean) {
    this.description = this.object.text ? `${this.object.text} ` : ``;
    if (includeOrder)
      this.description = this.description.concat(` (sort: ${this.sort.order} ${this.sort.ascending ? `🔼` : `🔽`})`);
  }

  async getChildren(): Promise<BrowserItem[] | undefined> {
    const connection = getConnection();
    const content = getContent();

    const writable = await content.checkObject({
      library: this.object.library,
      name: this.object.name,
      type: `*FILE`
    }, [`*UPD`]);

    try {
      const members = await content.getMemberList({
        library: this.object.library,
        sourceFile: this.object.name,
        members: this.filter.member,
        extensions: this.filter.memberType,
        filterType: this.filter.filterType,
        sort: this.sort
      });

      await storeMemberList(this.path, members.map(member => `${member.name}.${member.extension}`));

      return members.map(member => new ObjectBrowserMemberItem(this, member, writable));
    } catch (e: any) {
      console.log(e);

      // Work around since we can't get the member list if the users CCSID is not setup.
      const config = getConfig();
      if (connection.enableSQL) {
        if (e && e.message && e.message.includes(`CCSID`)) {
          vscode.window.showErrorMessage(`Error getting member list. Disabling SQL and refreshing. It is recommended you reload. ${e.message}`, `Reload`).then(async (value) => {
            if (value === `Reload`) {
              await vscode.commands.executeCommand(`workbench.action.reloadWindow`);
            }
          });

          connection.enableSQL = false;
          await ConnectionConfiguration.update(config);
          return this.getChildren();
        }
      } else {
        throw e;
      }
    }
  }

  toString(): string {
    return `${this.path} (${this.object.type})`;
  }

  async delete() {
    return deleteObject(this.object);
  }

  async getToolTip() {
    return await getContent().sourcePhysicalFileToToolTip(this.path, this.object);
  }
}

class ObjectBrowserObjectItem extends ObjectBrowserItem implements ObjectItem, WithLibrary {
  readonly path: string;
  readonly library: string;

  constructor(parent: ObjectBrowserFilterItem, readonly object: IBMiObject) {
    const type = object.type.startsWith(`*`) ? object.type.substring(1) : object.type;
    const icon = Object.entries(objectIcons).find(([key]) => key === type.toUpperCase())?.[1] || objectIcons[``];
    const isLibrary = type === 'LIB';
    super(parent.filter, correctCase(`${object.name}.${type}`), { icon, parent, state: isLibrary ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None });

    this.library = isLibrary ? object.name : '';
    this.path = [object.library, object.name].join(`/`);
    this.updateDescription();

    this.contextValue = `object.${type.toLowerCase()}${object.attribute ? `.${object.attribute}` : ``}${isLibrary ? '_library' : ''}${this.isProtected() ? `_readonly` : ``}`;
    this.tooltip = getContent().objectToToolTip(this.path, object);

    this.resourceUri = vscode.Uri.from({
      scheme: `object`,
      path: `/${object.library}/${object.name}.${type}`,
      fragment: object.attribute
    });

    if (!isLibrary) {
      this.command = {
        command: `vscode.open`,
        title: `Open`,
        arguments: [this.resourceUri]
      };
    }
  }

  isProtected(): boolean {
    return this.filter.protected || getContent().isProtectedPath(this.object.library);
  }

  updateDescription() {
    this.description = this.object.text.trim() + (this.object.attribute ? ` (${this.object.attribute})` : ``);
  }

  async getChildren() {
    const objectFilter = Object.assign({}, this.filter);
    objectFilter.library = this.object.name;
    return await listObjects(this, objectFilter);
  }

  toString(): string {
    return `${this.path} (${this.object.type})`;
  }

  async delete() {
    return deleteObject(this.object);
  }
}

class ObjectBrowserMemberItem extends ObjectBrowserItem implements MemberItem {
  readonly path: string;
  readonly sortBy: (sort: SortOptions) => void;
  readonly readonly: boolean;
  constructor(parent: ObjectBrowserSourcePhysicalFileItem, readonly member: IBMiMember, writable: boolean) {
    const readonly = !writable || parent.isProtected();
    super(parent.filter, correctCase(`${member.name}.${member.extension}`), { icon: readonly ? `lock-small` : "", parent });
    this.contextValue = `member${readonly ? `_readonly` : ``}`;
    this.description = member.text;

    this.resourceUri = getMemberUri(member, { readonly });
    this.path = this.resourceUri.path.substring(1);
    this.tooltip = getContent().memberToToolTip(this.path, member);

    this.sortBy = (sort: SortOptions) => parent.sortBy(sort);

    this.command = {
      command: "code-for-ibmi.openWithDefaultMode",
      title: `Open Member`,
      arguments: [{ path: this.path }, (readonly ? "browse" : undefined) as DefaultOpenMode]
    };

    this.readonly = readonly;
  }

  isProtected(): boolean {
    return this.readonly;
  }

  toString(): string {
    return this.path;
  }

  async delete() {
    const connection = getConnection();
    const { library, file, name } = connection.parserMemberPath(this.path);

    const removeResult = await connection.runCommand({
      command: `RMVM FILE(${library}/${file}) MBR(${name})`,
      noLibList: true
    });

    if (removeResult.code !== 0) {
      vscode.window.showErrorMessage(t(`objectBrowser.deleteMember.errorMessage`, removeResult.stderr));
    }

    return removeResult.code === 0;
  }
}

class ObjectBrowserMemberItemDragAndDrop implements vscode.TreeDragAndDropController<ObjectBrowserMemberItem> {
  readonly dragMimeTypes = [OBJECT_BROWSER_MIMETYPE];
  readonly dropMimeTypes = [];

  handleDrag(source: readonly ObjectBrowserMemberItem[], dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken) {
    dataTransfer.set(OBJECT_BROWSER_MIMETYPE, new vscode.DataTransferItem(source.filter(item => item.resourceUri?.scheme === `member`)
      .map(item => item.resourceUri)
      .join(URI_LIST_SEPARATOR)));
  }
}

export function initializeObjectBrowser(context: vscode.ExtensionContext) {
  const objectBrowser = new ObjectBrowser();
  const objectTreeViewer = vscode.window.createTreeView(
    `objectBrowser`, {
    treeDataProvider: objectBrowser,
    showCollapseAll: true,
    canSelectMany: true,
    dragAndDropController: new ObjectBrowserMemberItemDragAndDrop()
  });

  context.subscriptions.push(
    objectTreeViewer,

    vscode.commands.registerCommand(`code-for-ibmi.sortMembersByName`, (item: ObjectBrowserSourcePhysicalFileItem | ObjectBrowserMemberItem) => {
      item.sortBy({ order: "name" });
    }),

    vscode.commands.registerCommand(`code-for-ibmi.sortMembersByDate`, (item: ObjectBrowserSourcePhysicalFileItem | ObjectBrowserMemberItem) => {
      item.sortBy({ order: "date" });
    }),

    vscode.commands.registerCommand(`code-for-ibmi.createFilter`, async () => {
      await editFilter();
      objectBrowser.refresh();
    }),

    vscode.commands.registerCommand(`code-for-ibmi.createQuickFilter`, async () => {
      const config = getConfig();
      const connection = getConnection();
      const objectFilters = config.objectFilters;

      const LIBRARY_REGEX = /^(?<lib>[^/.() ]+)\*$/;
      const FILTER_REGEX = /^(?<lib>[^/.() ]+)(\/(?<obj>[^/.() ]+))?(\/(?<mbr>[^/.() ]+))?(\.(?<mbrType>[^/.() ]+))?( \((?<objType>[^/.()]+)\))?$/;

      const newFilter = await vscode.window.showInputBox({
        prompt: `Enter filter as LIB* or LIB/OBJ/MBR.MBRTYPE (OBJTYPE) where each parameter is optional except the library`,
        value: ``,
        validateInput: newFilter => {
          const libraryRegex = LIBRARY_REGEX.exec(connection.upperCaseName(newFilter));
          const filterRegex = FILTER_REGEX.exec(connection.upperCaseName(newFilter));
          if (!libraryRegex && !filterRegex) return `Invalid filter: ${newFilter}. Use format LIB* or LIB/OBJ/MBR.MBRTYPE (OBJTYPE) where each parameter is optional except the library`;
        }
      });

      if (newFilter) {
        let regex = LIBRARY_REGEX.exec(connection.upperCaseName(newFilter));
        const parsedFilter = regex?.groups;
        if (regex && parsedFilter) {
          const filter = {
            name: `Filter ${objectFilters.length + 1}`,
            filterType: 'simple',
            library: `${parsedFilter.lib}*`,
            object: `*`,
            types: [`*ALL`],
            member: `*`,
            memberType: `*`,
            protected: false
          } as ConnectionConfiguration.ObjectFilters;
          objectFilters.push(filter);
        } else {
          regex = FILTER_REGEX.exec(connection.upperCaseName(newFilter));
          const parsedFilter = regex?.groups;
          if (regex && parsedFilter) {
            const filter = {
              name: `Filter ${objectFilters.length + 1}`,
              filterType: 'simple',
              library: parsedFilter.lib || `QGPL`,
              object: parsedFilter.obj || `*`,
              types: [parsedFilter.objType || `*SRCPF`],
              member: parsedFilter.mbr || `*`,
              memberType: parsedFilter.mbrType || `*`,
              protected: false
            } as ConnectionConfiguration.ObjectFilters;
            objectFilters.push(filter);
          }
        }

        config.objectFilters = objectFilters;
        await ConnectionConfiguration.update(config);
        objectBrowser.refresh();
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.copyFilter`, async (node: FilteredItem) => {
      await editFilter(node.filter, true);
      objectBrowser.refresh();
    }),

    vscode.commands.registerCommand(`code-for-ibmi.maintainFilter`, async (node?: FilteredItem) => {
      await editFilter(node?.filter);
      objectBrowser.refresh();
    }),

    vscode.commands.registerCommand(`code-for-ibmi.moveFilterUp`, (node: ObjectBrowserFilterItem) => objectBrowser.moveFilterInList(node, `UP`)),
    vscode.commands.registerCommand(`code-for-ibmi.moveFilterDown`, (node: ObjectBrowserFilterItem) => objectBrowser.moveFilterInList(node, `DOWN`)),
    vscode.commands.registerCommand(`code-for-ibmi.moveFilterToTop`, (node: ObjectBrowserFilterItem) => objectBrowser.moveFilterInList(node, `TOP`)),
    vscode.commands.registerCommand(`code-for-ibmi.moveFilterToBottom`, (node: ObjectBrowserFilterItem) => objectBrowser.moveFilterInList(node, `BOTTOM`)),

    vscode.commands.registerCommand(`code-for-ibmi.sortFilters`, async () => {
      const config = getConfig();
      config.objectFilters.sort((filter1, filter2) => filter1.name.toLowerCase().localeCompare(filter2.name.toLowerCase()));
      await ConnectionConfiguration.update(config);
      objectBrowser.autoRefresh();
    }),

    vscode.commands.registerCommand(`code-for-ibmi.refreshObjectBrowser`, () => objectBrowser.refresh()),

    vscode.commands.registerCommand(`code-for-ibmi.refreshObjectBrowserItem`, async (item: BrowserItem) => {
      objectBrowser.refresh(item);
    }),

    vscode.commands.registerCommand(`code-for-ibmi.revealInObjectBrowser`, async (item: BrowserItem, options?: FocusOptions) => {
      objectTreeViewer.reveal(item, options);
    }),

    vscode.commands.registerCommand(`code-for-ibmi.createMember`, async (node: ObjectBrowserSourcePhysicalFileItem, fullName?: string) => {
      const connection = getConnection();
      const toPath = (value: string) => connection.upperCaseName(`${node.path}/${value}`);
      fullName = await vscode.window.showInputBox({
        prompt: t(`objectBrowser.createMember.prompt`),
        value: fullName,
        validateInput: (value) => {
          try {
            connection.parserMemberPath(toPath(value));
          } catch (e: any) {
            return e.toString();
          }
        }
      });

      if (fullName) {
        const fullPath = toPath(fullName);
        const member = connection.parserMemberPath(fullPath);
        const error = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t(`objectBrowser.createMember.progressTitle`, fullPath) }, async (progress) => {
          const addResult = await connection.runCommand({
            command: `ADDPFM FILE(${member.library}/${member.file}) MBR(${member.name}) SRCTYPE(${member.extension.length > 0 ? member.extension : `*NONE`})`,
            noLibList: true
          })

          if (addResult.code === 0) {
            if (GlobalConfiguration.get(`autoOpenFile`)) {
              vscode.commands.executeCommand(`code-for-ibmi.openEditable`, fullPath);
            }

            objectBrowser.refresh(node);

          } else {
            return addResult.stderr
          }
        });

        if (error) {
          if (await vscode.window.showErrorMessage(t(`objectBrowser.createMember.errorMessage`, fullPath, error), t(`Retry`))) {
            vscode.commands.executeCommand(`code-for-ibmi.createMember`, node, fullName);
          }
        }
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.copyMember`, async (node: ObjectBrowserMemberItem, fullPath?: string) => {
      const connection = getConnection();
      const oldMember = node.member;
      fullPath = await vscode.window.showInputBox({
        prompt: t(`objectBrowser.copyMember.prompt`),
        value: node.path || fullPath,
        validateInput: (value) => {
          try {
            const memberPath = connection.parserMemberPath(value);
            if (memberPath.library === oldMember.library && memberPath.file === oldMember.file && memberPath.name === oldMember.name) {
              return t(`objectBrowser.copyMember.errorMessage`);
            }
          } catch (e: any) {
            return e.toString();
          }
        }
      });

      if (fullPath) {
        const memberPath = connection.parserMemberPath(fullPath);
        const error = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t(`objectBrowser.copyMember.progressTitle`, fullPath.toUpperCase()) }, async (progress) => {
          try {
            const checkResult = await connection.runCommand({
              command: `CHKOBJ OBJ(${memberPath.library}/${memberPath.file}) OBJTYPE(*FILE) MBR(${memberPath.name})`,
              noLibList: true
            })

            const newMemberExists = checkResult.code === 0;

            if (newMemberExists) {
              const result = await vscode.window.showInformationMessage(t(`objectBrowser.copyMember.overwrite`, memberPath.name), { modal: true }, t(`Yes`), t(`No`))
              if (result === t(`Yes`)) {
                await connection.runCommand({
                  command: `RMVM FILE(${memberPath.library}/${memberPath.file}) MBR(${memberPath.name})`,
                  noLibList: true
                })
              } else {
                throw t(`objectBrowser.copyMember.errorMessage2`, memberPath.name)
              }
            }

            const copyResult = await connection.runCommand({
              command: `CPYSRCF FROMFILE(${oldMember.library}/${oldMember.file}) TOFILE(${memberPath.library}/${memberPath.file}) FROMMBR(${oldMember.name}) TOMBR(${memberPath.name}) MBROPT(*REPLACE)`,
              noLibList: true
            })

            const copyMessages = Tools.parseMessages(copyResult.stderr);
            if (copyResult.code !== 0 && copyMessages.messages.length && !(copyMessages.findId(`CPF2869`) && copyMessages.findId(`CPF2817`))) {
              throw (copyResult.stderr)
            }

            if (oldMember.extension !== memberPath.extension) {
              await connection.runCommand({
                command: `CHGPFM FILE(${memberPath.library}/${memberPath.file}) MBR(${memberPath.name}) SRCTYPE(${memberPath.extension.length > 0 ? memberPath.extension : `*NONE`})`,
                noLibList: true
              });
            }

            if (GlobalConfiguration.get(`autoOpenFile`)) {
              vscode.commands.executeCommand(`code-for-ibmi.openEditable`, fullPath);
            }

            if (oldMember.library.toLocaleLowerCase() === memberPath.library.toLocaleLowerCase()) {
              if (oldMember.file.toLocaleLowerCase() === memberPath.file.toLocaleLowerCase()) {
                objectBrowser.refresh(node.parent);
              }
              else {
                objectBrowser.refresh(node.parent?.parent);
              }
            }
            else {
              objectBrowser.autoRefresh();
            }
          } catch (e) {
            return e;
          }
        });

        if (error) {
          if (await vscode.window.showErrorMessage(t(`objectBrowser.copyMember.errorMessage3`, fullPath, error), t(`Retry`))) {
            vscode.commands.executeCommand(`code-for-ibmi.copyMember`, node, fullPath);
          }
        }
      }
    }),
    vscode.commands.registerCommand(`code-for-ibmi.updateMemberText`, async (node: ObjectBrowserMemberItem) => {
      const connection = getConnection();
      const { library, file, name, basename } = connection.parserMemberPath(node.path);
      const oldText = node.member.text;
      const newText = await vscode.window.showInputBox({
        value: oldText,
        prompt: t(`objectBrowser.updateMemberText.prompt`, basename)
      });

      if (newText && newText !== oldText) {
        const escapedText = newText.replace(/'/g, `''`);
        const connection = getConnection();

        const changeResult = await connection.runCommand({
          command: `CHGPFM FILE(${library}/${file}) MBR(${name}) TEXT(${newText.toUpperCase() !== `*BLANK` ? `'${escapedText}'` : `*BLANK`})`,
          noLibList: true
        });

        if (changeResult.code === 0) {
          node.description = newText.toUpperCase() !== `*BLANK` ? newText : ``;
          objectBrowser.refresh(node);
        } else {
          vscode.window.showErrorMessage(t(`objectBrowser.updateMemberText.errorMessage`, changeResult.stderr));
        }

      }
    }),
    vscode.commands.registerCommand(`code-for-ibmi.renameMember`, async (node: ObjectBrowserMemberItem) => {
      const connection = getConnection();
      const oldMember = connection.parserMemberPath(node.path);
      const oldUri = node.resourceUri as vscode.Uri;
      const library = oldMember.library;
      const sourceFile = oldMember.file;
      let newBasename: string | undefined = oldMember.basename;
      let newMember: MemberParts | undefined;
      let newMemberPath: string | undefined;
      let newNameOK;

      // Check if the member is currently open in an editor tab.
      const oldMemberTabs = Tools.findUriTabs(oldUri);

      // If the member is currently open in an editor tab, and 
      // the member has unsaved changes, then prevent the renaming operation.
      if (oldMemberTabs.find(tab => tab.isDirty)) {
        vscode.window.showErrorMessage(t("objectBrowser.renameMember.errorMessage", t("member.has.unsaved.changes")));
        return;
      }

      do {
        newBasename = await vscode.window.showInputBox({
          value: newBasename,
          prompt: t(`objectBrowser.renameMember.prompt`, oldMember.basename),
          validateInput: value => connection.upperCaseName(value) === oldMember.basename ? t("objectBrowser.renameMember.invalid.input") : undefined
        });

        if (newBasename) {
          newNameOK = true;
          newMemberPath = library + `/` + sourceFile + `/` + newBasename;
          try {
            newMember = connection.parserMemberPath(newMemberPath);
          } catch (e: any) {
            newNameOK = false;
            vscode.window.showErrorMessage(e);
          }

          if (newMember) {
            let commandResult: CommandResult;

            if (oldMember.name !== newMember.name) {
              commandResult = await connection.runCommand({
                command: `RNMM FILE(${library}/${sourceFile}) MBR(${oldMember.name}) NEWMBR(${newMember.name})`,
                noLibList: true
              });

              if (commandResult.code !== 0) {
                newNameOK = false;
                vscode.window.showErrorMessage(t(`objectBrowser.renameMember.errorMessage`, commandResult.stderr));
              }
            }
            if (oldMember.extension !== newMember.extension) {
              commandResult = await connection.runCommand({
                command: `CHGPFM FILE(${library}/${sourceFile}) MBR(${newMember.name}) SRCTYPE(${newMember.extension.length > 0 ? newMember.extension : `*NONE`})`,
                noLibList: true
              });

              if (commandResult.code !== 0) {
                newNameOK = false;
                vscode.window.showErrorMessage(t(`objectBrowser.renameMember.errorMessage`, commandResult.stderr));
              }
            }

            objectBrowser.refresh(node.parent);
          }
        }
      } while (newBasename && !newNameOK)

      // If the member was open in an editor tab prior to the renaming,
      // refresh those tabs to reflect the new member path/name.
      // (Directly modifying the label or uri of an open tab is apparently not
      // possible with the current VS Code API, so refresh the tab by closing
      // it and then opening a new one at the new uri.)
      if (newNameOK && newMemberPath) {
        oldMemberTabs.forEach((tab) => {
          vscode.window.tabGroups.close(tab).then(() => {
            vscode.commands.executeCommand(`code-for-ibmi.openEditable`, newMemberPath);
          });
        })
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.uploadAndReplaceMemberAsFile`, async (node: MemberItem) => {
      const contentApi = getContent();

      const originPath = await vscode.window.showOpenDialog({ defaultUri: vscode.Uri.file(os.homedir()) });

      if (originPath) {
        const connection = getConnection();
        const { asp, library, file, name } = connection.parserMemberPath(node.path);
        const data = fs.readFileSync(originPath[0].fsPath, `utf8`);

        try {
          contentApi.uploadMemberContent(asp, library, file, name, data);
          vscode.window.showInformationMessage(t(`objectBrowser.uploadAndReplaceMemberAsFile.infoMessage`));
        } catch (e) {
          vscode.window.showErrorMessage(t(`objectBrowser.uploadAndReplaceMemberAsFile.errorMessage`, e));
        }
      }

    }),

    vscode.commands.registerCommand(`code-for-ibmi.downloadMemberAsFile`, async (node: ObjectItem | MemberItem, nodes?: (ObjectItem | MemberItem)[]) => {
      const contentApi = getContent();
      const connection = getConnection();
      const config = getConfig();

      //Gather all the members
      const members: IBMiMember[] = [];
      for (const item of (nodes || [node])) {
        if ("object" in item) {
          members.push(...await contentApi.getMemberList({ library: item.object.library, sourceFile: item.object.name }));
        }
        else if ("member" in item) {
          members.push(item.member);
        }
      }

      const saveIntoDirectory = members.length > 1;
      let downloadLocation: string | undefined;
      if (saveIntoDirectory) {
        downloadLocation = (await vscode.window.showOpenDialog({
          canSelectMany: false,
          canSelectFiles: false,
          canSelectFolders: true,
          defaultUri: vscode.Uri.file(connection.getLastDownloadLocation())
        }))?.[0]?.path;
      }
      else {
        downloadLocation = (await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(path.join(connection.getLastDownloadLocation(), members[0].name)),
          filters: { 'Source member': [members[0].extension || '*'] }
        }))?.path;
      }

      if (downloadLocation) {
        //Remove double entries and map to { path, copy } object
        const toBeDownloaded = members
          .filter((member, index, list) => list.findIndex(m => m.library === member.library && m.file === member.file && m.name === member.name) === index)
          .sort((m1, m2) => m1.name.localeCompare(m2.name))
          .map(member => ({ path: Tools.qualifyPath(member.library, member.file, member.name, member.asp), name: `${member.name}.${member.extension || "MBR"}`, copy: true }));

        if (!saveIntoDirectory) {
          toBeDownloaded[0].name = basename(downloadLocation);
          downloadLocation = dirname(downloadLocation);
        }

        await connection.setLastDownloadLocation(downloadLocation);

        //Ask what do to with existing files in the target directory
        if (saveIntoDirectory) {
          let overwriteAll = false;
          let skipAll = false;
          const overwriteLabel = t('overwrite');
          const overwriteAllLabel = t('overwrite_all');
          const skipAllLabel = t('skip_all');
          for (const item of toBeDownloaded) {
            const target = path.join(Tools.fixWindowsPath(downloadLocation), item.name);
            if (existsSync(target)) {
              if (skipAll) {
                item.copy = false;
              }
              else if (!overwriteAll) {
                const answer = await vscode.window.showWarningMessage(t('ask.overwrite', item.name), { modal: true }, t('skip'), skipAllLabel, overwriteLabel, overwriteAllLabel);
                if (answer) {
                  overwriteAll ||= (answer === overwriteAllLabel);
                  skipAll ||= (answer === skipAllLabel);
                  item.copy = !skipAll && (overwriteAll || answer === overwriteLabel);
                }
                else {
                  //Abort!
                  vscode.window.showInformationMessage(t('objectBrowser.downloadMemberContent.cancel'));
                  return;
                }
              }
            }
          }
        }

        //Download members
        vscode.window.withProgress({ title: t('objectBrowser.downloadMemberContent.download.progress', toBeDownloaded.filter(m => m.copy).length), location: vscode.ProgressLocation.Notification }, async (task) => {
          try {
            await connection.withTempDirectory(async directory => {
              task.report({ message: t('objectBrowser.downloadMemberContent.download.cpytostmf'), increment: 33 })
              const copyToStreamFiles = toBeDownloaded
                .filter(member => member.copy)
                .map(member => `@CPYTOSTMF FROMMBR('${member.path}') TOSTMF('${directory}/${member.name.toLocaleLowerCase()}') STMFOPT(*REPLACE) STMFCCSID(1208) DBFCCSID(${config.sourceFileCCSID}) ENDLINFMT(*LF);`)
                .join("\n");
              await contentApi.runSQL(copyToStreamFiles);

              task.report({ message: t('objectBrowser.downloadMemberContent.download.streamfiles'), increment: 33 })
              await connection.downloadDirectory(downloadLocation!, directory);
              vscode.window.showInformationMessage(t(`objectBrowser.downloadMemberContent.infoMessage`));
            });
          } catch (e) {
            vscode.window.showErrorMessage(t(`objectBrowser.downloadMemberContent.errorMessage`, e));
          }
        });
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.searchSourceFile`, async (node?: ObjectItem) => {
      const parameters = {
        path: node?.path || ``,
        filter: node?.filter
      }

      if (!parameters.path) {
        const connection = getConnection();
        const input = await vscode.window.showInputBox({
          prompt: t(`objectBrowser.searchSourceFile.prompt`),
          title: t(`objectBrowser.searchSourceFile.title`),
          validateInput: (input) => {
            input = input.trim();
            const path = input.split(`/`);
            let checkPath;
            if (path.length > 3) {
              return t(`objectBrowser.searchSourceFile.invalidForm`)
            } else if (path.length > 2) {                 // Check member
              let checkMember = path[2].replace(/[*]/g, ``).split(`.`);
              checkMember[0] = checkMember[0] !== `` ? checkMember[0] : `a`;
              checkPath = path[0] + `/` + path[1] + `/` + checkMember[0] + `.` + (checkMember.length > 1 ? checkMember[1] : ``);
            } else if (path.length > 1) {                 // Check filename
              checkPath = input + (path[path.length - 1] === `` ? `a` : ``) + `/a.b`;
            } else {                                      // Check library
              checkPath = input + (path[path.length - 1] === `` ? `a` : ``) + `/a/a.a`;
            }
            if (checkPath) {
              try {
                connection.parserMemberPath(checkPath);
              } catch (e: any) {
                return e;
              }
            }
          }
        });

        if (input) {
          const path = connection.upperCaseName(input.trim()).split(`/`);
          parameters.path = [path[0], path[1]].join('/');
        }
      }

      if (parameters.path) {
        const config = getConfig();

        const pathParts = parameters.path.split(`/`);
        if (pathParts[1] !== `*ALL`) {
          const aspText = ((config.sourceASP && config.sourceASP.length > 0) ? t(`objectBrowser.searchSourceFile.aspText`, config.sourceASP) : ``);

          const list = GlobalStorage.get().getPreviousSearchTerms();
          const listHeader: vscode.QuickPickItem[] = [
            { label: t(`objectBrowser.searchSourceFile.previousSearches`), kind: vscode.QuickPickItemKind.Separator }
          ];
          const clearList = t(`clearList`);
          const clearListArray = [{ label: ``, kind: vscode.QuickPickItemKind.Separator }, { label: clearList }];

          const quickPick = vscode.window.createQuickPick();
          quickPick.items = list.length > 0 ? listHeader.concat(list.map(term => ({ label: term }))).concat(clearListArray) : [];
          quickPick.placeholder = list.length > 0 ? t(`objectBrowser.searchSourceFile.placeholder`) : t(`objectBrowser.searchSourceFile.placeholder2`);
          quickPick.title = t(`objectBrowser.searchSourceFile.title2`, parameters.path, aspText);

          quickPick.onDidChangeValue(() => {
            if (quickPick.value === ``) {
              quickPick.items = listHeader.concat(list.map(term => ({ label: term }))).concat(clearListArray);
            } else if (!list.includes(quickPick.value)) {
              quickPick.items = [{ label: quickPick.value }].concat(listHeader)
                .concat(list.map(term => ({ label: term })))
            }
          })

          quickPick.onDidAccept(async () => {
            const searchTerm = quickPick.activeItems[0].label;
            if (searchTerm) {
              if (searchTerm === clearList) {
                GlobalStorage.get().clearPreviousSearchTerms();
                quickPick.items = [];
                quickPick.placeholder = t(`objectBrowser.searchSourceFile.placeholder2`);
                vscode.window.showInformationMessage(t(`clearedList`));
                quickPick.show();
              } else {
                quickPick.hide();
                GlobalStorage.get().addPreviousSearchTerm(searchTerm);
                await doSearchInSourceFile(searchTerm, parameters.path, parameters.filter);
              }
            }
          });

          quickPick.onDidHide(() => quickPick.dispose());
          quickPick.show();

        } else {
          vscode.window.showErrorMessage(t(`objectBrowser.searchSourceFile.errorMessage`));
        }
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.createLibrary`, async () => {
      const config = getConfig();
      const connection = getConnection();

      const newLibrary = await vscode.window.showInputBox({
        prompt: t(`objectBrowser.createLibrary.prompt`),
        validateInput: (library => library.length > 10 ? t(`objectBrowser.createLibrary.errorMessage2`) : undefined)
      });

      if (newLibrary) {

        const filters = config.objectFilters;

        const createResult = await connection.runCommand({
          command: `CRTLIB LIB(${newLibrary})`,
          noLibList: true
        });

        if (createResult.code !== 0) {
          vscode.window.showErrorMessage(t(`objectBrowser.createLibrary.errorMessage`, newLibrary, createResult.stderr));
        }

        filters.push({
          name: newLibrary,
          filterType: 'simple',
          library: newLibrary,
          object: `*ALL`,
          types: [`*ALL`],
          member: `*`,
          memberType: `*`,
          protected: false
        });

        config.objectFilters = filters;
        ConnectionConfiguration.update(config);
        const autoRefresh = objectBrowser.autoRefresh();

        // Add to library list ?
        await vscode.window.showInformationMessage(t(`objectBrowser.createLibrary.infoMessage`), t(`Yes`), t(`No`))
          .then(async result => {
            switch (result) {
              case t(`Yes`):
                await vscode.commands.executeCommand(`code-for-ibmi.addToLibraryList`, { library: newLibrary });
                if (autoRefresh) {
                  vscode.commands.executeCommand(`code-for-ibmi.refreshLibraryListView`);
                }
                break;
            }
          });
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.createSourceFile`, async (node: ObjectBrowserFilterItem | ObjectBrowserObjectItem) => {
      if (node.library) {
        const fileName = await vscode.window.showInputBox({
          prompt: t(`objectBrowser.createSourceFile.prompt`),
          validateInput: (fileName => fileName.length > 10 ? t('objectBrowser.createSourceFile.errorMessage2') : undefined)
        });

        if (fileName) {
          const connection = getConnection();
          const library = node.library;
          const uriPath = `${library}/${connection.upperCaseName(fileName)}`

          vscode.window.showInformationMessage(t(`objectBrowser.createSourceFile.infoMessage`, uriPath));
          const createResult = await connection.runCommand({
            command: `CRTSRCPF FILE(${uriPath}) RCDLEN(112)`,
            noLibList: true
          });

          if (createResult.code === 0) {
            objectBrowser.refresh(node);
          } else {
            vscode.window.showErrorMessage(t(`objectBrowser.createSourceFile.errorMessage`, createResult.stderr));
          }
        }
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.changeObjectDesc`, async (node: ObjectBrowserObjectItem | ObjectBrowserSourcePhysicalFileItem) => {
      let newText = node.object.text;
      let newTextOK;
      do {
        newText = await vscode.window.showInputBox({
          prompt: t(`objectBrowser.changeObjectDesc.prompt`, node.path),
          value: newText,
          validateInput: newText => {
            return newText.length <= 50 ? null : t(`objectBrowser.changeObjectDesc.errorMessage`);
          }
        }) || "";

        if (newText) {
          const escapedText = newText.replace(/'/g, `''`).replace(/`/g, `\\\``);
          const connection = getConnection();

          newTextOK = true;
          const changeResult = await connection.runCommand({
            command: `CHGOBJD OBJ(${node.path}) OBJTYPE(${node.object.type}) TEXT(${newText.toUpperCase() !== `*BLANK` ? `'${escapedText}'` : `*BLANK`})`,
            noLibList: true
          });

          if (changeResult.code === 0) {
            node.object.text = newText;
            node.updateDescription();
            objectBrowser.refresh(node);
            vscode.window.showInformationMessage(t(`objectBrowser.changeObjectDesc.infoMessage`, node.path, node.object.type.toUpperCase()));
          } else {
            vscode.window.showErrorMessage(t(`objectBrowser.changeObjectDesc.errorMessage2`, node.path, changeResult.stderr));
            newTextOK = false;
          }
        }
      } while (newText && !newTextOK)
    }),

    vscode.commands.registerCommand(`code-for-ibmi.copyObject`, async (node: ObjectBrowserObjectItem | ObjectBrowserSourcePhysicalFileItem) => {
      let newPath = node.path;
      let newPathOK;
      do {
        newPath = await vscode.window.showInputBox({
          prompt: t(`objectBrowser.copyObject.prompt`),
          value: newPath,
          validateInput: newPath => {
            let splitPath = newPath.split(`/`);
            if (splitPath.length != 2) return t(`objectBrowser.copyObject.errorMessage`, newPath);
            if (splitPath[0].length > 10) return t(`objectBrowser.copyObject.errorMessage2`);
            if (splitPath[1].length > 10) return t(`objectBrowser.copyObject.errorMessage3`);
          }
        }) || "";

        if (newPath) {
          const [oldLibrary, oldObject] = node.path.split(`/`);
          const escapedPath = newPath.replace(/'/g, `''`).replace(/`/g, `\\\``);
          const [newLibrary, newObject] = escapedPath.split(`/`);
          const connection = getConnection();

          newPathOK = true;
          const commandRes = await connection.runCommand({
            command: node.object.type.toLocaleLowerCase() === `*lib` ?
              `CPYLIB FROMLIB(${oldObject}) TOLIB(${newObject})` :
              `CRTDUPOBJ OBJ(${oldObject}) FROMLIB(${oldLibrary}) OBJTYPE(${node.object.type}) TOLIB(${newLibrary}) NEWOBJ(${newObject})`,
            noLibList: true
          });

          if (commandRes.code === 0) {

            if (oldLibrary.toLocaleLowerCase() === newLibrary.toLocaleLowerCase()) {
              objectBrowser.refresh(node.parent);
            }
            else if (!objectBrowser.autoRefresh(t(`objectBrowser.copyObject.infoMessage`, node.path, node.object.type.toUpperCase(), escapedPath))) {
              vscode.window.showInformationMessage(t(`objectBrowser.copyObject.infoMessage2`, node.path, node.object.type.toUpperCase(), escapedPath));
            }
          } else {
            vscode.window.showErrorMessage(t(`objectBrowser.copyObject.errorMessage4`, node.path, commandRes.stderr));
            newPathOK = false;
          }
        }
      } while (newPath && !newPathOK)
    }),

    vscode.commands.registerCommand(`code-for-ibmi.renameObject`, async (node: ObjectBrowserObjectItem) => {
      let [, newObject] = node.path.split(`/`);
      let newObjectOK;
      do {
        newObject = await vscode.window.showInputBox({
          prompt: t(`objectBrowser.renameObject.prompt`),
          value: newObject,
          validateInput: newObject => {
            return newObject.length <= 10 ? null : t(`objectBrowser.renameObject.errorMessage`);
          }
        }) || "";

        if (newObject) {
          const escapedObject = newObject.replace(/'/g, `''`).replace(/`/g, `\\\``).split(`/`);
          const connection = getConnection();
          newObjectOK = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t("objectBrowser.renameObject.progress", node.path, node.object.type.toUpperCase(), escapedObject) }
            , async (progress) => {
              const renameResult = await connection.runCommand({
                command: `RNMOBJ OBJ(${node.path}) OBJTYPE(${node.object.type}) NEWOBJ(${escapedObject})`,
                noLibList: true
              });

              if (renameResult.code !== 0) {
                vscode.window.showErrorMessage(t(`objectBrowser.renameObject.errorMessage2`, node.path, renameResult.stderr));
                return false;
              }

              vscode.window.showInformationMessage(t(`objectBrowser.renameObject.infoMessage`, node.path, node.object.type.toUpperCase(), escapedObject));
              objectBrowser.refresh(node.parent);
              return true;
            }
          );
        }
      } while (newObject && !newObjectOK)
    }),

    vscode.commands.registerCommand(`code-for-ibmi.moveObject`, async (node: ObjectBrowserObjectItem) => {
      let [newLibrary,] = node.path.split(`/`);
      let newLibraryOK;
      do {
        newLibrary = await vscode.window.showInputBox({
          prompt: t(`objectBrowser.moveObject.prompt`),
          value: newLibrary,
          validateInput: newLibrary => {
            return newLibrary.length <= 10 ? null : t(`objectBrowser.moveObject.errorMessage`);

          }
        }) || "";

        if (newLibrary) {
          const escapedLibrary = newLibrary.replace(/'/g, `''`).replace(/`/g, `\\\``);
          const connection = getConnection();

          newLibraryOK = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t("objectBrowser.moveObject.progress", node.path, node.object.type.toUpperCase(), escapedLibrary) }
            , async (progress) => {
              const moveResult = await connection.runCommand({
                command: `MOVOBJ OBJ(${node.path}) OBJTYPE(${node.object.type}) TOLIB(${newLibrary})`,
                noLibList: true
              });

              if (moveResult.code !== 0) {
                vscode.window.showErrorMessage(t(`objectBrowser.moveObject.errorMessage2`, node.path, moveResult.stderr));
                return false;
              }

              if (!objectBrowser.autoRefresh(t(`objectBrowser.moveObject.infoMessage`, node.path, node.object.type.toUpperCase(), escapedLibrary))) {
                vscode.window.showInformationMessage(t(`objectBrowser.moveObject.infoMessage2`, node.path, node.object.type.toUpperCase(), escapedLibrary));
              }
              return true;
            });
        }
      } while (newLibrary && !newLibraryOK)
    }),
    vscode.commands.registerCommand("code-for-ibmi.objectBrowser.delete", async (node?: ObjectBrowserItem, nodes?: ObjectBrowserItem[]) => {
      const candidates: ObjectBrowserItem[] = [];
      if (nodes) {
        candidates.push(...nodes);
      }
      else if (node) {
        candidates.push(node);
      }
      else {
        candidates.push(...objectTreeViewer.selection.filter(i => i instanceof ObjectBrowserItem) as ObjectBrowserItem[]);
      }

      const toBeDeleted = candidates.filter(item => !item.isProtected());
      if (toBeDeleted.length) {
        const message = toBeDeleted.length === 1 ? t('objectBrowser.delete.confirm', toBeDeleted[0].toString()) : t('objectBrowser.delete.multiple.confirm', toBeDeleted.length);
        const detail = toBeDeleted.length === 1 ? undefined : toBeDeleted.map(item => `- ${item.toString()}`).join("\n");
        if (await vscode.window.showWarningMessage(message, { modal: true, detail }, t(`Yes`))) {
          const increment = 100 / toBeDeleted.length;
          const toRefresh = new Set<BrowserItem>();
          let refreshBrowser = false;
          await vscode.window.withProgress({ title: t("objectBrowser.delete.progress"), location: vscode.ProgressLocation.Notification }, async (task) => {
            for (const item of toBeDeleted) {
              task.report({ message: item.toString(), increment });
              await item.delete();

              if (!item.parent) {
                //No parent (a filter): the whole browser needs to be refreshed
                refreshBrowser = true;
                toRefresh.clear();
              }

              if (!refreshBrowser && item.parent) {
                //Refresh the element's parent unless its own parent must be refreshed
                let parent: BrowserItem | undefined = item.parent;
                let found = false
                while (!found && parent) {
                  found = toRefresh.has(parent);
                  parent = parent.parent
                }

                if (!found) {
                  toRefresh.add(item.parent);
                }
              }
            }
          });

          if (refreshBrowser) {
            vscode.commands.executeCommand(`code-for-ibmi.refreshObjectBrowser`);
          }
          else {
            toRefresh.forEach(item => item.refresh?.());
          }
        }
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.searchObjectBrowser`, async () => {
      vscode.commands.executeCommand('objectBrowser.focus');
      vscode.commands.executeCommand('list.find');
    })
  );
}

function getConfig() {
  const config = instance.getConfig();
  if (config) {
    return config;
  }
  else {
    throw new Error(t('not.connected'));
  }
}

function getConnection() {
  const connection = instance.getConnection();
  if (connection) {
    return connection;
  }
  else {
    throw new Error(t('not.connected'));
  }
}

function getContent() {
  const content = instance.getContent();
  if (content) {
    return content;
  }
  else {
    throw new Error(t('not.connected'));
  }
}

function storeMemberList(path: string, list: string[]) {
  const storage = instance.getStorage();
  if (storage) {
    const existingDirs = storage.getSourceList();
    existingDirs[path] = list;
    return storage.setSourceList(existingDirs);
  }
}

async function doSearchInSourceFile(searchTerm: string, path: string, filter: ConnectionConfiguration.ObjectFilters | undefined) {
  const content = getContent();
  const pathParts = path.split(`/`);
  try {
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: t(`objectBrowser.doSearchInSourceFile.title`),
    }, async progress => {
      progress.report({
        message: t(`objectBrowser.doSearchInSourceFile.progressMessage`, path)
      });

      const members = await content.getMemberList({ library: pathParts[0], sourceFile: pathParts[1], members: filter?.member });
      if (members.length > 0) {
        // NOTE: if more messages are added, lower the timeout interval
        const timeoutInternal = 9000;
        const searchMessages = [
          t(`objectBrowser.doSearchInSourceFile.searchMessage1`, searchTerm, path),
          t(`objectBrowser.doSearchInSourceFile.searchMessage2`, members.length, searchTerm, path),
          t(`objectBrowser.doSearchInSourceFile.searchMessage3`, searchTerm),
          t(`objectBrowser.doSearchInSourceFile.searchMessage4`, searchTerm, path),
          t(`objectBrowser.doSearchInSourceFile.searchMessage5`),
          t(`objectBrowser.doSearchInSourceFile.searchMessage6`),
          t(`objectBrowser.doSearchInSourceFile.searchMessage7`),
          t(`objectBrowser.doSearchInSourceFile.searchMessage8`, members.length),
          t(`objectBrowser.doSearchInSourceFile.searchMessage9`, searchTerm, path),
        ];

        let currentMessage = 0;
        const messageTimeout = setInterval(() => {
          if (currentMessage < searchMessages.length) {
            progress.report({
              message: searchMessages[currentMessage]
            });
            currentMessage++;
          } else {
            clearInterval(messageTimeout);
          }
        }, timeoutInternal);

        const results = await Search.searchMembers(instance, pathParts[0], pathParts[1], `${filter?.member || `*`}.MBR`, searchTerm, filter?.protected || content.isProtectedPath(pathParts[0]));
        // Filter search result by member type filter.
        if (results.hits.length && filter?.member) {
          const patternExt = new RegExp(`^` + filter?.member.replace(/[*]/g, `.*`).replace(/[$]/g, `\\$`) + `$`);
          results.hits = results.hits.filter(result => {
            const resultPath = result.path.split(`/`);
            const resultName = resultPath[resultPath.length - 1];
            const member = members.find(member => member.name === resultName);
            return (member && patternExt.test(member.extension));
          })
        }

        if (results.hits.length) {
          const objectNamesLower = GlobalConfiguration.get(`ObjectBrowser.showNamesInLowercase`);

          // Format result to include member type.
          results.hits.forEach(result => {
            const resultPath = result.path.split(`/`);
            const resultName = resultPath[resultPath.length - 1];
            result.path += `.${members.find(member => member.name === resultName)?.extension || ''}`;
            if (objectNamesLower === true) {
              result.path = result.path.toLowerCase();
            }
          });

          results.hits = results.hits.sort((a, b) => {
            return a.path.localeCompare(b.path);
          });

          vscode.commands.executeCommand(`code-for-ibmi.setSearchResults`, results);
        } else {
          vscode.window.showInformationMessage(t(`objectBrowser.doSearchInSourceFile.notFound`, searchTerm, path));
        }

      } else {
        vscode.window.showErrorMessage(t(`objectBrowser.doSearchInSourceFile.noMembers`));
      }

    });

  } catch (e) {
    vscode.window.showErrorMessage(t(`objectBrowser.doSearchInSourceFile.errorMessage`, e));
  }
}

async function listObjects(item: ObjectBrowserFilterItem, filter?: ConnectionConfiguration.ObjectFilters) {
  return (await getContent().getObjectList(filter || item.filter, objectSortOrder()))
    .map(object => {
      return object.sourceFile ? new ObjectBrowserSourcePhysicalFileItem(item, object) : new ObjectBrowserObjectItem(item, object);
    });
}

async function deleteObject(object: IBMiObject) {
  const connection = getConnection();
  const deleteResult = await connection.runCommand({
    command: `DLTOBJ OBJ(${object.library}/${object.name}) OBJTYPE(${object.type})`,
    noLibList: true
  });

  if (deleteResult.code !== 0) {
    vscode.window.showErrorMessage(t(`objectBrowser.deleteObject.errorMessage`, deleteResult.stderr));
  }

  return deleteResult.code === 0;
}
