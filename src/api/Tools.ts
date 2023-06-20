import { API, GitExtension } from "./import/git";
import vscode from "vscode";
import path from "path"

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

    let data = output.split(`\n`);

    let headers: DB2Headers[];

    let SQLSTATE: string;

    const rows: DB2Row[] = [];

    data.forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed.length === 0 && iiErrorMessage) iiErrorMessage = false;
      if (trimmed.length === 0 || index === data.length - 1) return;
      if (trimmed === `DB2>`) return;
      if (trimmed.startsWith(`DB20`)) return; // Notice messages
      if (trimmed === `?>`) return;

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

  export function makeid() {
    let text = `O_`;
    const possible =
      `ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789`;

    for (let i = 0; i < 8; i++)
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
  export function qualifyPath(library: string, object: string, member: string, iasp?: string) {
    const path =
      (iasp && iasp.length > 0 ? `/${iasp}` : ``) + `/QSYS.lib/${library}.lib/${object}.file/${member}.mbr`;
    return path;
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

  export function sleep(ms:number) {
    return new Promise(resolve => setTimeout(resolve, ms));
 }
}