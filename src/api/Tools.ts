
import os from "os";
import path from "path";
import { EditorPath, IBMiMessage, IBMiMessages, QsysPath } from './types';

export namespace Tools {
  export class SqlError extends Error {
    public sqlstate: string = "0";
    constructor(message: string) {
      super(message);
    }
  }

  export interface DB2Row extends Record<string, string | number | null> { }

  export function bufferToUx(input: string) {
    const hexString = Array.from(input)
      .map(char => char.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase())
      .join('');
    return `UX'${hexString}'`;
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
  export function qualifyPath(library: string, object: string, member?: string, iasp?: string, noEscape?: boolean) {
    [library, object] = Tools.sanitizeObjNamesForPase([library, object]);
    member = member ? Tools.sanitizeObjNamesForPase([member])[0] : undefined;
    iasp = iasp ? Tools.sanitizeObjNamesForPase([iasp])[0] : undefined;

    const libraryPath = library === `QSYS` ? `QSYS.LIB` : `QSYS.LIB/${library}.LIB`;
    const filePath = object ? `${object}.FILE` : '';
    const memberPath = member ? `/${member}.MBR` : '';
    const fullPath = `${libraryPath}/${filePath}${memberPath}`;

    const result = (iasp && iasp.length > 0 ? `/${iasp}` : ``) + `/${noEscape ? fullPath : Tools.escapePath(fullPath)}`;
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
  export function escapePath(Path: string, alreadyQuoted = false): string {
    if (alreadyQuoted) {
      return Path.replace(/"|\$|\\/g, matched => `\\`.concat(matched));
    } else {
      return Path.replace(/'|"|\$|&|\\| /g, matched => `\\`.concat(matched));
    }
  }

  export function distinct(value: any, index: number, array: any[]) {
    return array.indexOf(value) === index;
  }

  export function capitalize(text: string) {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  export function sanitizeObjNamesForPase(libraries: string[]): string[] {
    return libraries
      .map(library => {
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
    const parts = path.split('/').filter(Boolean);
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

  export function fileToPath(file: EditorPath): string {
    if (typeof file === "string") {
      return Tools.fixWindowsPath(file);
    }
    else {
      return file.fsPath;
    }
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

  /**
   * Converts a timestamp from the attr command (in the form `Thu Dec 21 21:47:02 2023`) into a Date object
   * @param timestamp an attr timestamp string
   * @returns a Date object
   */
  export function parseAttrDate(timestamp: string) {
    const parts = /^([\w]{3}) ([\w]{3}) +([\d]+) ([\d]+:[\d]+:[\d]+) ([\d]+)$/.exec(timestamp);
    if (parts) {
      return Date.parse(`${parts[3].padStart(2, "0")} ${parts[2]} ${parts[5]} ${parts[4]} GMT`);
    }
    return 0;
  }
  
  /**
   * Transforms a file path into an OS agnostic path.
   * - Replaces full home directory path by ~
   * - Replaces all \ into / on Windows
   * 
   * @param filePath 
   * @returns 
   */
  export function normalizePath(filePath: string) {
    //Test path in lowercase since os.homedir doesn't always has the same case as filePath on Windows
    if(filePath.toLowerCase().startsWith(os.homedir().toLowerCase())){
      filePath = path.join(`~`, filePath.substring(os.homedir().length));
    }
    
    return process.platform === "win32" ? filePath.replaceAll('\\', '/') : filePath;
  }

  /**
   * Transforms a normalized path into an OS specific path.
   * - Replaces ~ with the current home directory
   * - Changes all / to \ on Windows
   * @param path 
   * @returns 
   */
  export function resolvePath(path: string) {
    path = path.replace("~", os.homedir());
    return process.platform === "win32" ? path.replaceAll('/', '\\') : path;
  }
}