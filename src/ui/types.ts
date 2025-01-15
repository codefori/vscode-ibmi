import { TreeItemCollapsibleState, TreeItem, ThemeIcon, ThemeColor, ProviderResult, MarkdownString } from "vscode"
import { FocusOptions } from "../api/types"

export type BrowserItemParameters = {
  icon?: string
  color?: string
  state?: TreeItemCollapsibleState
  parent?: BrowserItem
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