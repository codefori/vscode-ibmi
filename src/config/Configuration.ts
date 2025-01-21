
import * as vscode from 'vscode';
import { Config } from "../api/configuration/config/VirtualConfig";

export function onCodeForIBMiConfigurationChange<T>(props: string | string[], todo: (value: vscode.ConfigurationChangeEvent) => void) {
  const keys = (Array.isArray(props) ? props : Array.of(props)).map(key => `code-for-ibmi.${key}`);
  return vscode.workspace.onDidChangeConfiguration(async event => {
    if (keys.some(key => event.affectsConfiguration(key))) {
      todo(event);
    }
  })
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