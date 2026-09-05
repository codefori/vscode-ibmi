import * as vscode from "vscode";
import { parseBlockFoldingRanges } from "./foldingRanges";

const rpgleSelectors: vscode.DocumentSelector = [
  { language: `rpgle` },
  { pattern: `**/*.rpgle` },
  { pattern: `**/*.sqlrpgle` },
  { pattern: `**/*.rpgleinc` }
];

class RpgleProcedureFoldingProvider implements vscode.FoldingRangeProvider {
  provideFoldingRanges(document: vscode.TextDocument): vscode.FoldingRange[] {
    return parseBlockFoldingRanges(document.getText().split(/\r?\n/))
      .map(range => new vscode.FoldingRange(range.start, range.end, vscode.FoldingRangeKind.Region));
  }
}

export function registerRpgleProcedureFolding(): vscode.Disposable {
  return vscode.languages.registerFoldingRangeProvider(
    rpgleSelectors,
    new RpgleProcedureFoldingProvider()
  );
}