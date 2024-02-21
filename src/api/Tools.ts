import Crypto from 'crypto';
import { readFileSync } from "fs";
import path from "path";
import vscode from "vscode";
import { IBMiMessage, IBMiMessages, QsysPath } from '../typings';
import { API, GitExtension } from "./import/git";
import { t } from "../locale";

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
  export function db2Parse(output: string): DB2Row[] {
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
            let sqlError = new SqlError(`${data[index + 3]} (${SQLSTATE})`);
            sqlError.sqlstate = SQLSTATE;
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

        headers.forEach(header => {
          const strValue = line.substring(header.from, header.from + header.length).trimEnd();

          let realValue: string | number | null = strValue;

          // is value a number?
          if (strValue.startsWith(` `)) {
            const asNumber = Number(strValue.trim());
            if (!isNaN(asNumber)) {
              realValue = asNumber;
            }
          } else if (strValue === `-`) {
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
   * Build the IFS path string to a member
   * @param library
   * @param object
   * @param member
   * @param iasp Optional: an iASP name
   */
  export function qualifyPath(library: string, object: string, member: string, iasp?: string, sanitise?: boolean) {
    library = library.toUpperCase();
    const libraryPath = library === `QSYS` ? `QSYS.LIB` : `QSYS.LIB/${Tools.sanitizeLibraryNames([library]).join(``)}.LIB`;
    const memberPath = `${object.toUpperCase()}.FILE/${member.toUpperCase()}.MBR`
    const memberSubpath = sanitise ? Tools.escapePath(memberPath) : memberPath;

    const result = (iasp && iasp.length > 0 ? `/${iasp}` : ``) + `/${libraryPath}/${memberSubpath}`;
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
   * We do this to find previously opened files with the same path, but different case OR readonly flags.
   * Without this, it's possible for the same document to be opened twice simply due to the readonly flag.
   */
  export function findExistingDocumentUri(uri: vscode.Uri) {
    const baseUriString = uriStringWithoutFragment(uri);
    const possibleDoc = vscode.workspace.textDocuments.find(document => uriStringWithoutFragment(document.uri) === baseUriString);
    return possibleDoc?.uri || uri;
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
   * Fixes an SQL statement to make it compatible with db2 CLI program QZDFMDB2.
   * - Changes `@clCommand` statements into Call `QSYS2.QCMDEX('clCommand')` procedure calls
   * - Makes sure each comment (`--`) starts on a new line
   * @param statement the statement to fix
   * @returns statement compatible with QZDFMDB2
   */
  export function fixSQL(statement: string) {
    return statement.split("\n").map(line => {
      if (line.startsWith('@')) {
        //- Escape all '
        //- Remove any trailing ;
        //- Put the command in a Call QSYS2.QCMDEXC statement
        line = `Call QSYS2.QCMDEXC('${line.substring(1, line.endsWith(";") ? line.length - 1 : undefined).replaceAll("'", "''")}');`;
      }

      //Make each comment start on a new line
      return line.replaceAll("--", "\n--");
    }
    ).join("\n");
  }

  export function generateTooltipHtmlTable(header:string, rows: Record<string, any>){
    return `<table>`
      .concat(`${header ? `<thead>${header}</thead>` : ``}`)
      .concat(`${Object.entries(rows).map(([key, value]) => `<tr><td>${t(key)}:</td><td>&nbsp;${value}</td></tr>`).join(``)}`)
      .concat(`</table>`);
    }
}