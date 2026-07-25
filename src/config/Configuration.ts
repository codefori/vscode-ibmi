
import * as vscode from 'vscode';
import IBMi from "../api/IBMi";
import { Config } from "../api/configuration/config/VirtualConfig";

export function onCodeForIBMiConfigurationChange<T>(props: string | string[], todo: (value: vscode.ConfigurationChangeEvent) => void) {
  const keys = (Array.isArray(props) ? props : Array.of(props)).map(key => `code-for-ibmi.${key}`);
  return vscode.workspace.onDidChangeConfiguration(async event => {
    if (keys.some(key => event.affectsConfiguration(key))) {
      todo(event);
    }
  })
}

/**
 * Settings that shape the shared views, read in one place so that every consumer —
 * including extensions built on top of this one, via the exported API — applies the
 * same defaults and bounds. Duplicating the clamping on the caller's side is what
 * makes a table render pages of one size while its query fetches another.
 */
export namespace ViewSettings {
  /** Fallback page size when the setting is unset or unusable, and the floor it is clamped to. */
  const DEFAULT_ITEMS_PER_PAGE = 50;
  const MIN_ITEMS_PER_PAGE = 30;

  /** Fallback interval, in seconds, when the setting is unset or unusable. */
  const DEFAULT_AUTO_REFRESH_SECONDS = 30;

  /**
   * Page size for every paginated table, from `code-for-ibmi.tables.itemsPerPage`.
   * Callers that paginate server-side must use this for their own LIMIT/OFFSET too,
   * otherwise the page count shown by the table won't match the rows it receives.
   */
  export function getItemsPerPage(): number {
    const configured = IBMi.connectionManager.get(`tables.itemsPerPage`);
    if (typeof configured !== 'number' || !Number.isFinite(configured)) {
      return DEFAULT_ITEMS_PER_PAGE;
    }
    return Math.max(MIN_ITEMS_PER_PAGE, Math.floor(configured));
  }

  /**
   * Auto-refresh interval in milliseconds, from `code-for-ibmi.views.autoRefreshInterval`
   * (which is expressed in seconds). Returns 0 when auto-refresh is disabled.
   */
  export function getAutoRefreshInterval(): number {
    const configured = IBMi.connectionManager.get(`views.autoRefreshInterval`);
    const seconds = typeof configured === 'number' && Number.isFinite(configured) && configured >= 0
      ? Math.floor(configured)
      : DEFAULT_AUTO_REFRESH_SECONDS;
    return seconds * 1000;
  }
}

export class VsCodeConfig extends Config {
  constructor() {
    super();
  }
  private getWorkspaceConfig() {
    return vscode.workspace.getConfiguration(`code-for-ibmi`);
  }

  get<T>(key: string): T | undefined {
    return this.getWorkspaceConfig().get<T>(key);
  }
  async set(key: string, value: any): Promise<void> {
    await this.getWorkspaceConfig().update(key, value, vscode.ConfigurationTarget.Global);
  }

}