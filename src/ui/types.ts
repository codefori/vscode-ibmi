import { TreeItemCollapsibleState, TreeItem, ThemeIcon, ThemeColor, ProviderResult, MarkdownString } from "vscode"
import { FocusOptions, IBMiMember, IBMiObject, ObjectFilters, WithPath } from "../api/types"

export type BrowserItemParameters = {
  icon?: string
  color?: string
  state?: TreeItemCollapsibleState
  parent?: BrowserItem
}

export interface FilteredItem {
  filter: ObjectFilters
}

export interface ObjectItem extends FilteredItem, WithPath {
  object: IBMiObject
}

export interface MemberItem extends FilteredItem, WithPath {
  member: IBMiMember
}

export class BrowserItem extends TreeItem {
  constructor(label: string, readonly params?: BrowserItemParameters) {
    super(label, params?.state);
    this.iconPath = params?.icon ? new ThemeIcon(params.icon, params.color ? new ThemeColor(params.color) : undefined) : undefined;
  }

  get parent() {
    return this.params?.parent;
  }

  getChildren?(): ProviderResult<BrowserItem[]>;
  refresh?(): void;
  reveal?(options?: FocusOptions): Thenable<void>;
  getToolTip?(): Promise<MarkdownString | undefined>;
}