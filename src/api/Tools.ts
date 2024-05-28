import Crypto from 'crypto';
import { readFileSync } from "fs";
import path from "path";
import vscode from "vscode";
import { t } from "../locale";
import { IBMiMessage, IBMiMessages, QsysPath } from '../typings';
import { API, GitExtension } from "./import/git";

export namespace Tools {
  export class SqlError extends Error {
    public sqlstate: string = "0";
    constructor(message: string) {
      super(message);
    }
  }

  export interface DB2Headers {
    name: string
    from: number
    length: number
  }

  export interface DB2Row extends Record<string, string | number | null> {

  }

  /**
   * Parse standard out for `/usr/bin/db2`
   * @param output /usr/bin/db2's output
   * @returns rows
   */
  export function db2Parse(output: string, input?: string): DB2Row[] {
    let gotHeaders = false;
    let figuredLengths = false;
    let iiErrorMessage = false;

    const data = output.split(`\n`).filter(line => {
      const trimmed = line.trim();
      return trimmed !== `DB2>` &&
        !trimmed.startsWith(`DB20`) && // Notice messages
        !/COMMAND .+ COMPLETED WITH EXIT STATUS \d+/.test(trimmed) && // @CL command execution output
        trimmed !== `?>`;
    });

    if (!data[data.length - 1]) {
      data.pop();
    }

    let headers: DB2Headers[];

    let SQLSTATE: string;

    const rows: DB2Row[] = [];

    data.forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed.length === 0 && iiErrorMessage) iiErrorMessage = false;
      if (trimmed.length === 0 || index === data.length - 1) return;

      if (trimmed === `**** CLI ERROR *****`) {
        iiErrorMessage = true;
        if (data.length > index + 3) {
          SQLSTATE = data[index + 1].trim();

          if (SQLSTATE.includes(`:`)) {
            SQLSTATE = SQLSTATE.split(`:`)[1].trim();
          }

          if (!SQLSTATE.startsWith(`01`)) {
            const errorMessage = data[index + 3] ? data[index + 3].trim() : `Unknown error`;
            let sqlError = new SqlError(`${errorMessage} (${SQLSTATE})`);
            sqlError.sqlstate = SQLSTATE;
            sqlError.cause = input;
            throw sqlError;
          }
        }
        return;
      }

      if (iiErrorMessage) return;

      if (gotHeaders === false) {
        headers = line.split(` `)
          .filter(header => header.length > 0)
          .map(header => {
            return {
              name: header,
              from: 0,
              length: 0,
            };
          });

        gotHeaders = true;
      } else if (figuredLengths === false) {
        let base = 0;
        line.split(` `).forEach((header, index) => {
          headers[index].from = base;
          headers[index].length = header.length;

          base += header.length + 1;
        });

        figuredLengths = true;
      } else {
        let row: DB2Row = {};
        let slideBytesBy = 0;

        headers.forEach(header => {
          const fromPos = header.from - slideBytesBy;
          let strValue = line.substring(fromPos, fromPos + header.length);

          /* For each DBCS character, add 1
          Since we are reading characters as UTF8 here, we assume any UTF8 character made up of more than 2 bytes is DBCS

          https://stackoverflow.com/a/14495321/4763757

          Look at a list of Unicode blocks and their code point ranges, e.g. 
          the browsable http://www.fileformat.info/info/unicode/block/index.htm or 
          the official http://www.unicode.org/Public/UNIDATA/Blocks.txt :

          Anything up to U+007F takes 1 byte: Basic Latin
          Then up to U+07FF it takes 2 bytes: Greek, Arabic, Cyrillic, Hebrew, etc
          Then up to U+FFFF it takes 3 bytes: Chinese, Japanese, Korean, Devanagari, etc
          Beyond that it takes 4 bytes

          */

          const extendedBytes = strValue.split(``).map(c => Buffer.byteLength(c) < 3 ? 0 : 1).reduce((a: number, b: number) => a + b, 0);

          slideBytesBy += extendedBytes;
          if (extendedBytes > 0) {
            strValue = strValue.substring(0, strValue.length - extendedBytes);
          }

          let realValue: string | number | null = strValue.trimEnd();

          // is value a number?
          if (realValue.startsWith(` `)) {
            const asNumber = Number(strValue.trim());
            if (!isNaN(asNumber)) {
              realValue = asNumber;
            }
          } else if (realValue === `-`) {
            realValue = null; //null?
          }

          row[header.name] = realValue;
        });

        rows.push(row);
      }
    });

    return rows;
  }

  export function makeid(length: number = 8) {
    let text = `O_`;
    const possible =
      `ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789`;

    for (let i = 0; i < length; i++)
      text += possible.charAt(Math.floor(Math.random() * possible.length));

    return text;
  }

  /**
   * Build the IFS path string to an object or member
   * @param library
   * @param object
   * @param member Optional
   * @param iasp Optional: an iASP name
   */
  export function qualifyPath(library: string, object: string, member?: string, iasp?: string, sanitise?: boolean) {
    const libraryPath = library === `QSYS` ? `QSYS.LIB` : `QSYS.LIB/${Tools.sanitizeLibraryNames([library]).join(``)}.LIB`;
    const filePath = `${object}.FILE`;
    const memberPath = member ? `/${member}.MBR` : '';
    const subPath = `${filePath}${memberPath}`;

    const result = (iasp && iasp.length > 0 ? `/${iasp}` : ``) + `/${libraryPath}/${sanitise ? subPath : Tools.escapePath(subPath)}`;
    return result;
  }

  /**
   * Unqualify member path from root
   */
  export function unqualifyPath(memberPath: string) {
    const pathInfo = path.posix.parse(memberPath);
    let splitPath = pathInfo.dir.split(path.posix.sep);

    // Remove use of `QSYS.LIB` two libraries in the path aren't value
    const isInQsys = splitPath.filter(part => part.endsWith(`.LIB`)).length === 2;
    if (isInQsys) {
      splitPath = splitPath.filter(part => part !== `QSYS.LIB`);
    }

    const correctedDir = splitPath.map(part => {
      const partInfo = path.posix.parse(part);
      if ([`.FILE`, `.LIB`].includes(partInfo.ext)) {
        return partInfo.name
      } else {
        return part
      }
    })
      .join(path.posix.sep);

    return path.posix.join(correctedDir, pathInfo.base);
  }

  /**
   * @param Path
   * @returns the escaped path
   */
  export function escapePath(Path: string): string {
    const path = Path.replace(/'|"|\$|\\| /g, matched => `\\`.concat(matched));
    return path;
  }

  let gitLookedUp: boolean;
  let gitAPI: API | undefined;
  export function getGitAPI(): API | undefined {
    if (!gitLookedUp) {
      try {
        gitAPI = vscode.extensions.getExtension<GitExtension>(`vscode.git`)?.exports.getAPI(1);
      }
      catch (error) {
        console.log(`Git extension issue.`, error);
      }
      finally {
        gitLookedUp = true;
      }
    }
    return gitAPI;
  }

  export function distinct(value: any, index: number, array: any[]) {
    return array.indexOf(value) === index;
  }

  export function md5Hash(file: vscode.Uri): string {
    const bytes = readFileSync(file.fsPath);
    return Crypto.createHash("md5")
      .update(bytes)
      .digest("hex")
      .toLowerCase();
  }

  export function capitalize(text: string) {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  export function sanitizeLibraryNames(libraries: string[]): string[] {
    return libraries
      .map(library => {
        // Escape any $ signs
        library = library.replace(/\$/g, `\\$`);
        // Quote libraries starting with #
        return library.startsWith(`#`) ? `"${library}"` : library;
      });
  }

  export function parseMessages(output: string): IBMiMessages {
    const messages = output.split("\n").map(line => ({
      id: line.substring(0, line.indexOf(':')).trim(),
      text: line.substring(line.indexOf(':') + 1).trim()
    }) as IBMiMessage);
    return {
      messages,
      findId: id => messages.find(m => m.id === id)
    }
  }

  export function parseQSysPath(path: string): QsysPath {
    const parts = path.split('/');
    if (parts.length > 3) {
      return {
        asp: parts[0],
        library: parts[1],
        name: parts[2]
      }
    }
    else {
      return {
        library: parts[0],
        name: parts[1]
      }
    }
  }

  /**
   * Check whether two given uris point to the same file/member
   */
  export function areEquivalentUris(uriA: vscode.Uri, uriB: vscode.Uri) {
    return uriStringWithoutFragment(uriA) === uriStringWithoutFragment(uriB);
  }

  /**
   * We do this to find previously opened files with the same path, but different case OR readonly flags.
   * Without this, it's possible for the same document to be opened twice simply due to the readonly flag.
   */
  export function findExistingDocumentUri(uri: vscode.Uri) {
    const possibleDoc = findExistingDocument(uri);
    return possibleDoc?.uri || uri;
  }

  export function findExistingDocument(uri: vscode.Uri) {
    const baseUriString = uriStringWithoutFragment(uri);
    const possibleDoc = vscode.workspace.textDocuments.find(document => uriStringWithoutFragment(document.uri) === baseUriString);
    return possibleDoc;
  }

  /**
   * We convert member to lowercase as members are case insensitive.
   */
  function uriStringWithoutFragment(uri: vscode.Uri) {
    // To lowercase because the URI path is case-insensitive
    const baseUri = uri.scheme + `:` + uri.path;
    const isCaseSensitive = (uri.scheme === `streamfile` && /^\/QOpenSys\//i.test(uri.path));
    return (isCaseSensitive ? baseUri : baseUri.toLowerCase());
  }

  /**
   * Given the uri of a member or other resource, find all
   * (if any) open tabs where that resource is being edited.
  */
  export function findUriTabs(uriToFind: vscode.Uri): vscode.Tab[] {
    let resourceTabs: vscode.Tab[] = [];
    for (const group of vscode.window.tabGroups.all) {
      group.tabs.filter(tab =>
        (tab.input instanceof vscode.TabInputText)
        && areEquivalentUris(tab.input.uri, uriToFind)
      ).forEach(tab => {
        resourceTabs.push(tab);
      });
    }
    return resourceTabs;
  }

  /**
   * Fixes an SQL statement to make it compatible with db2 CLI program QZDFMDB2.
   * - Changes `@clCommand` statements into Call `QSYS2.QCMDEX('clCommand')` procedure calls
   * - Makes sure each comment (`--`) starts on a new line
   * @param statement the statement to fix
   * @returns statement compatible with QZDFMDB2
   */
  export function fixSQL(statement: string, removeComments = false): string {
    let statements = statement.split("\n").map(line => {
      if (line.startsWith('@')) {
        //- Escape all '
        //- Remove any trailing ;
        //- Put the command in a Call QSYS2.QCMDEXC statement
        line = `Call QSYS2.QCMDEXC('${line.substring(1, line.endsWith(";") ? line.length - 1 : undefined).replaceAll("'", "''")}');`;
      }

      //Make each comment start on a new line
      return line.replaceAll("--", "\n--");
    }).join(`\n`);

    if (removeComments) {
      statements = statements.split(`\n`).filter(l => !l.trim().startsWith(`--`)).join(`\n`);
    }

    return statements;
  }

  export function generateTooltipHtmlTable(header: string, rows: Record<string, any>) {
    return `<table>`
      .concat(`${header ? `<thead>${header}</thead>` : ``}`)
      .concat(`${Object.entries(rows).filter(([key, value]) => value !== undefined).map(([key, value]) => `<tr><td>${t(key)}:</td><td>&nbsp;${value}</td></tr>`).join(``)}`)
      .concat(`</table>`);
  }

  export function fixWindowsPath(path: string) {
    if (process.platform === `win32` && path[0] === `/`) {
      //Issue with getFile not working propertly on Windows
      //when there was a / at the start.
      return path.substring(1);
    } else {
      return path;
    }
  }

  const activeContexts: Map<string, number> = new Map;
  /**
   * Runs a function while a context value is set to true.
   * 
   * If multiple callers call this function with the same context, only the last one returning will unset the context value.
   * 
   * @param context the context value that will be set to `true` during `task` execution
   * @param task the function to run while the context value is `true`
   */
  export async function withContext<T>(context: string, task: () => Promise<T>) {
    try {
      let stack = activeContexts.get(context);
      if (stack === undefined) {
        await vscode.commands.executeCommand(`setContext`, context, true);
        activeContexts.set(context, 0);
      }
      else {
        stack++;
        activeContexts.set(context, stack);
      }
      return await task();
    }
    finally {
      let stack = activeContexts.get(context);
      if (stack !== undefined) {
        if (stack) {
          stack--;
          activeContexts.set(context, stack);
        }
        else {
          await vscode.commands.executeCommand(`setContext`, context, undefined);
          activeContexts.delete(context);
        }
      }
    }
  }
}