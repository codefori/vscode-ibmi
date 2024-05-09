import vscode from "vscode";

export class FileStatCache {
  private readonly cache: Map<string, vscode.FileStat | null> = new Map

  set(uri: vscode.Uri | string, stat: vscode.FileStat | null) {
    this.cache.set(toPath(uri), stat);
  }

  get(uri: vscode.Uri | string) {
    return this.cache.get(toPath(uri));
  }

  clear(uri?: vscode.Uri | string) {
    if (uri) {
      this.cache.delete(toPath(uri));
    }
    else {
      this.cache.clear();
    }
  }
}

function toPath(uri: vscode.Uri | string) {
  return typeof uri === "string" ? uri : uri.path;
}