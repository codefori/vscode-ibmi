import path from "path";
import vscode, { l10n } from "vscode";
import IBMi from "./IBMi";
import { Tools } from "./Tools";
import { SharedSnippet } from "./types";

const SNIPPETS_DIRECTORY = `/etc/vscode/snippets`;
const GLOBAL_SNIPPETS = `global`;
const LISTING_TTL = 30000;

const NEW_FILE_CONTENT = [
  `{`,
  `\t// Place your shared snippets here. Each snippet is defined under a snippet name`,
  `\t// and has a "prefix", a "body" and an optional "description".`,
  `\t// See https://code.visualstudio.com/docs/editing/userdefinedsnippets`,
  `\t// Example:`,
  `\t// "Print to console": {`,
  `\t// \t"prefix": "log",`,
  `\t// \t"body": [`,
  `\t// \t\t"console.log('$1');",`,
  `\t// \t\t"$2"`,
  `\t// \t],`,
  `\t// \t"description": "Log output to console"`,
  `\t// }`,
  `}`
].join(`\n`);

export type NamedSharedSnippet = SharedSnippet & {
  name: string
};

export type SharedSnippetsFile = {
  path: string
  languageId?: string
  snippets: NamedSharedSnippet[]
};

type CachedFile = {
  modified?: number
  file: SharedSnippetsFile
};

type Cache = {
  listedAt: number
  files: Map<string, CachedFile>
};

const cache = new WeakMap<IBMi, Cache>();

/**
 * Manages the shared snippets files, stored in the /etc/vscode/snippets IFS folder using the same
 * layout as https://code.visualstudio.com/docs/editing/userdefinedsnippets
 */
export namespace SharedSnippets {

  export function getFilePath(languageId?: string) {
    return path.posix.join(SNIPPETS_DIRECTORY, `${languageId || GLOBAL_SNIPPETS}.json`);
  }

  export function getLanguageId(filePath: string) {
    const basename = path.posix.basename(filePath, `.json`);
    return basename === GLOBAL_SNIPPETS ? undefined : basename;
  }

  export function isSnippetsFile(filePath: string) {
    return path.posix.dirname(filePath) === SNIPPETS_DIRECTORY && filePath.toLocaleLowerCase().endsWith(`.json`);
  }

  /** Dropping a single file keeps the others cached: only that one gets read again. */
  export function invalidate(connection: IBMi, filePath?: string) {
    const cached = cache.get(connection);
    if (filePath && cached) {
      cached.files.delete(filePath);
      cached.listedAt = 0; //the folder must be listed again to read the dropped file back
    }
    else {
      cache.delete(connection);
    }
  }

  /** Only the files that changed since the last listing are read again. */
  export async function getSnippetsFiles(connection: IBMi, options?: { forceReload?: boolean }): Promise<SharedSnippetsFile[]> {
    const cached = cache.get(connection);
    if (!options?.forceReload && cached && cached.listedAt + LISTING_TTL >= Date.now()) {
      return toFiles(cached);
    }

    const content = connection.getContent();
    const files = new Map<string, CachedFile>();

    if (await content.testStreamFile(SNIPPETS_DIRECTORY, `d`)) {
      for (const found of await content.getFileList(SNIPPETS_DIRECTORY)) {
        if (found.type === `streamfile` && isSnippetsFile(found.path)) {
          const modified = found.modified?.getTime();
          const previous = cached?.files.get(found.path);
          if (previous && modified !== undefined && previous.modified === modified) {
            files.set(found.path, previous);
          }
          else {
            files.set(found.path, { modified, file: await read(connection, found.path) });
          }
        }
      }
    }

    const newCache = { listedAt: Date.now(), files };
    cache.set(connection, newCache);
    return toFiles(newCache);
  }

  export async function createSnippetsFile(connection: IBMi, languageId?: string) {
    const filePath = getFilePath(languageId);
    const content = connection.getContent();

    if (!await content.testStreamFile(filePath, `e`)) {
      const escapedDirectory = Tools.escapePath(SNIPPETS_DIRECTORY, true);

      // Everyone reads, the owner writes; same as /etc/vscode/settings.json. Sys admins can fine tune afterwards.
      if (!await content.testStreamFile(SNIPPETS_DIRECTORY, `d`)) {
        const directory = await connection.sendCommand({ command: `mkdir -p "${escapedDirectory}" && chmod 755 "${escapedDirectory}"` });
        if (directory.code !== 0) {
          throw new Error(l10n.t("Could not create the shared snippets folder {0}; you may not be allowed to write into {1}. ({2})", SNIPPETS_DIRECTORY, path.posix.dirname(SNIPPETS_DIRECTORY), directory.stderr.trim()));
        }
      }
      else if (!await content.testStreamFile(SNIPPETS_DIRECTORY, `w`)) {
        throw new Error(l10n.t("You are not allowed to create files into {0}; ask your system administrator to grant you write access to this folder.", SNIPPETS_DIRECTORY));
      }

      try {
        await content.createStreamFile(filePath);
        await content.writeStreamfileRaw(filePath, NEW_FILE_CONTENT, `utf8`);
      }
      catch (error: any) {
        throw new Error(l10n.t("Could not create the shared snippets file {0}. ({1})", filePath, String(error.message || error).trim()));
      }

      await connection.sendCommand({ command: `chmod 644 "${Tools.escapePath(filePath, true)}"` });
      invalidate(connection, filePath);
    }
    else if (!await content.testStreamFile(filePath, `w`)) {
      vscode.window.showWarningMessage(l10n.t("You are not allowed to write into {0}: the file will open as read only.", filePath));
    }

    return filePath;
  }

  /**
   * Where and what to insert to add a snippet to a snippets file. It goes after the last snippet,
   * so the rest of the file - comments and formatting included - stays untouched.
   */
  export function buildInsertion(fileContent: string, name: string, snippet: SharedSnippet) {
    const existing = Object.keys(parseJsonWithComments(fileContent));
    if (existing.some(existingName => existingName.toLocaleUpperCase() === name.toLocaleUpperCase())) {
      throw new Error(l10n.t("This name is already used by another shared snippet"));
    }

    const snippets = findSnippetsObject(fileContent);
    if (!snippets) {
      throw new Error(l10n.t("No snippets object found in the file."));
    }

    const entry = JSON.stringify({ [name]: snippet }, undefined, `\t`)
      .split(`\n`)
      .slice(1, -1) //the wrapping braces are the file's own
      .join(`\n`);

    if (existing.length) {
      //Right after the last snippet, so the separating comma never lands after a trailing comment
      const offset = snippets.lastEntryEnd;
      return {
        offset,
        text: `${fileContent[offset - 1] === `,` ? `` : `,`}\n${entry}`
      };
    }
    else {
      //Nothing but comments in there: the snippet goes last, right before the closing brace
      const offset = snippets.close;
      return {
        offset,
        text: `${/(^|\n)[ \t]*$/.test(fileContent.substring(0, offset)) ? `` : `\n`}${entry}\n`
      };
    }
  }

  /** Where the snippets object closes, along with where its last entry ends - i.e. before any trailing comment. */
  function findSnippetsObject(content: string) {
    let open = -1;
    let depth = 0;
    let lastEntryEnd = -1;

    for (let i = 0; i < content.length; i++) {
      const current = content[i];
      const next = content[i + 1];

      if (current === `/` && next === `/`) {
        while (i < content.length && content[i] !== `\n`) {
          i++;
        }
        continue;
      }
      else if (current === `/` && next === `*`) {
        i += 2;
        while (i < content.length && !(content[i] === `*` && content[i + 1] === `/`)) {
          i++;
        }
        i++;
        continue;
      }
      else if (/\s/.test(current)) {
        continue;
      }

      if (open < 0) {
        if (current !== `{`) {
          return undefined; //anything but a comment before the snippets object
        }
        open = i;
        depth = 1;
      }
      else if (current === `"`) {
        while (++i < content.length) {
          if (content[i] === `\\`) {
            i++;
          }
          else if (content[i] === `"`) {
            break;
          }
        }
      }
      else if (current === `{` || current === `[`) {
        depth++;
      }
      else if (current === `}` || current === `]`) {
        if (--depth === 0) {
          return { close: i, lastEntryEnd };
        }
      }

      lastEntryEnd = i + 1;
    }

    return undefined;
  }

  async function read(connection: IBMi, filePath: string): Promise<SharedSnippetsFile> {
    const snippets: NamedSharedSnippet[] = [];

    try {
      const raw = await connection.getContent().downloadStreamfileRaw(filePath);
      const parsed = parseJsonWithComments(raw.toString(`utf8`));

      // Maybe one day replace this with real schema validation
      if (parsed && typeof parsed === `object` && !Array.isArray(parsed)) {
        for (const [name, snippet] of Object.entries<any>(parsed)) {
          if (snippet && typeof snippet === `object` && (typeof snippet.body === `string` || Array.isArray(snippet.body))) {
            snippets.push({ ...snippet, name });
          }
          else {
            throw new Error(l10n.t("Invalid shared snippet '{0}'.", name));
          }
        }
      }
    } catch (error: any) {
      vscode.window.showErrorMessage(l10n.t("Error parsing {0}: {1}", filePath, error.message));
    }

    return { path: filePath, languageId: getLanguageId(filePath), snippets };
  }

  function toFiles(cached: Cache) {
    return [...cached.files.values()].map(entry => entry.file);
  }

  /** VS Code allows comments and trailing commas in snippets files, and its own template is made of comments. */
  function parseJsonWithComments(content: string) {
    let json = ``;
    let pendingComma = false;

    const append = (text: string) => {
      if (pendingComma) {
        pendingComma = false;
        if (!text.startsWith(`}`) && !text.startsWith(`]`)) {
          json += `,`;
        }
      }
      json += text;
    };

    for (let i = 0; i < content.length; i++) {
      const current = content[i];
      const next = content[i + 1];

      if (current === `"`) {
        let string = current;
        while (++i < content.length) {
          string += content[i];
          if (content[i] === `\\`) {
            string += content[++i];
          }
          else if (content[i] === `"`) {
            break;
          }
        }
        append(string);
      }
      else if (current === `/` && next === `/`) {
        while (i < content.length && content[i] !== `\n`) {
          i++;
        }
      }
      else if (current === `/` && next === `*`) {
        i += 2;
        while (i < content.length && !(content[i] === `*` && content[i + 1] === `/`)) {
          i++;
        }
        i++;
      }
      else if (current === `,`) {
        pendingComma = true; //only kept if something other than the end of an object or an array follows
      }
      else if (!/\s/.test(current)) {
        append(current);
      }
    }

    return json ? JSON.parse(json) : {};
  }
}
