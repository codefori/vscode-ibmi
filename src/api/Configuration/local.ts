
import * as vscode from 'vscode';

export class LocalConfiguration implements vscode.WorkspaceConfiguration {
  data: any = {};
  get<T>(section: string, defaultValue?: T): T | undefined {
    return this.data[section] || defaultValue;
  }
  has(section: string): boolean {
    return this.data[section] !== undefined;
  }
  inspect<T>(section: string): { key: string; defaultValue?: T; globalValue?: T; workspaceValue?: T; workspaceFolderValue?: T; defaultLanguageValue?: T; globalLanguageValue?: T; workspaceLanguageValue?: T; workspaceFolderLanguageValue?: T; languageIds?: string[]; } | undefined {
    throw new Error('Method not implemented.');
  }
  async update(section: string, value: any, configurationTarget?: vscode.ConfigurationTarget | boolean | null, overrideInLanguage?: boolean): Promise<void> {
    this.data[section] = value;
  }
}

const localConfig = new LocalConfiguration();

export function getTempConfiguration(): vscode.WorkspaceConfiguration {
  return localConfig;
}