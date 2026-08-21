import path from "path";
import vscode, { l10n } from "vscode";
import IBMi from "./IBMi";
import { Tools } from "./Tools";
import { CacheItem, SharedTemplate } from "./types";

const REPO_DIR = `/etc/vscode/Code4iRepo`;
const INDEX_FILE = `/etc/vscode/Code4iRepo.json`;
const INDEX_CACHE_TTL = 30000; // 30 seconds, so external edits to the index still show up eventually

// per-connection, so the completion provider isn't hitting the IFS on every keystroke
const indexCache = new WeakMap<IBMi, CacheItem<SharedTemplate[]>>();
const contentCache = new WeakMap<IBMi, Map<string, string>>();

/**
 * Manages the shared template repository 
 */
export namespace SharedTemplateTools {
  export function getIndexFile() {
    return INDEX_FILE;
  }

  export function getTemplatePath(template: SharedTemplate) {
    return path.posix.join(REPO_DIR, template.file);
  }

  export async function getTemplates(connection: IBMi, options?: { forceReload?: boolean }): Promise<SharedTemplate[]> {
    const cached = indexCache.get(connection);
    if (!options?.forceReload && cached && (!cached.createdAt || cached.createdAt + INDEX_CACHE_TTL >= Date.now())) {
      return cached.value;
    }

    const templates: SharedTemplate[] = [];
    const content = connection.getContent();

    if (await content.testStreamFile(INDEX_FILE, "r")) {
      try {
        const raw = await content.downloadStreamfileRaw(INDEX_FILE);
        const parsed = JSON.parse(raw.toString("utf8"));

        // Maybe one day replace this with real schema validation
        if (Array.isArray(parsed)) {
          parsed.forEach((entry, index) => {
            if (typeof entry.name === `string` && typeof entry.file === `string` && typeof entry.prefix === `string`) {
              templates.push({
                name: entry.name,
                prefix: entry.prefix,
                description: typeof entry.description === `string` ? entry.description : ``,
                file: entry.file,
                extensions: Array.isArray(entry.extensions) && entry.extensions.length ? entry.extensions.map(String)
                  : typeof entry.extension === `string` ? [entry.extension] // old single-extension entries
                    : [path.posix.extname(entry.file).substring(1)]
              });
            } else {
              throw new Error(l10n.t("Invalid shared template defined at index {0}.", String(index)));
            }
          });
        }
      } catch (e: any) {
        vscode.window.showErrorMessage(l10n.t("Error parsing {0}: {1}", INDEX_FILE, e.message));
      }
    }

    templates.sort((t1, t2) => t1.name.localeCompare(t2.name));
    indexCache.set(connection, { value: templates, createdAt: Date.now() });
    return templates;
  }

  export async function createTemplate(connection: IBMi, template: SharedTemplate, content: string) {
    await checkRepo(connection);
    const templates = await getTemplates(connection);
    await connection.getContent().writeStreamfileRaw(getTemplatePath(template), content, `utf8`);
    templates.push(template);
    await writeIndex(connection, templates);
    setCachedContent(connection, template, content);
  }

  export async function updateTemplate(connection: IBMi, template: SharedTemplate, options?: { newName?: string, newPrefix?: string, newDescription?: string, newExtensions?: string[], delete?: boolean }) {
    const templates = await getTemplates(connection);
    const index = templates.findIndex(t => t.file === template.file);
    if (index < 0) {
      throw new Error(l10n.t("Cannot find shared template {0} for update.", template.name));
    }

    if (options?.delete) {
      templates.splice(index, 1);
      await connection.sendCommand({ command: `rm -f ${Tools.escapePath(getTemplatePath(template))}` });
      contentCache.get(connection)?.delete(template.file);
    } else {
      if (options?.newName !== undefined) {
        templates[index].name = options.newName;
      }
      if (options?.newPrefix !== undefined) {
        templates[index].prefix = options.newPrefix;
      }
      if (options?.newDescription !== undefined) {
        templates[index].description = options.newDescription;
      }
      if (options?.newExtensions !== undefined) {
        templates[index].extensions = options.newExtensions;
      }
    }

    await writeIndex(connection, templates);
  }

  export async function getTemplateContent(connection: IBMi, template: SharedTemplate, options?: { forceReload?: boolean }): Promise<string> {
    const cache = contentCache.get(connection);
    if (!options?.forceReload && cache?.has(template.file)) {
      return cache.get(template.file)!;
    }

    const raw = await connection.getContent().downloadStreamfileRaw(getTemplatePath(template));
    const text = raw.toString(`utf8`);
    setCachedContent(connection, template, text);
    return text;
  }

  /** e.g. ("i hate spaces", "rpgle") -> "i_hate_spaces.rpgle" */
  export function sanitizeFileName(name: string, extension: string): string {
    // no spaces on the IFS, ever! underscores only, sysadmin's orders
    const base = name.trim().toLocaleLowerCase().replace(/\s+/g, `_`).replace(/[^a-z0-9_]+/g, ``).replace(/^_+|_+$/g, ``) || `template`;
    const ext = extension.trim().replace(/^\.+/, ``).toLocaleLowerCase() || `txt`;
    return `${base}.${ext}`;
  }

  function setCachedContent(connection: IBMi, template: SharedTemplate, content: string) {
    let cache = contentCache.get(connection);
    if (!cache) {
      cache = new Map();
      contentCache.set(connection, cache);
    }
    cache.set(template.file, content);
  }

  async function checkRepo(connection: IBMi) {
    const content = connection.getContent();
    if (!await content.testStreamFile(REPO_DIR, "d")) {
      await connection.sendCommand({ command: `mkdir -p ${Tools.escapePath(REPO_DIR)}` });
    }
    if (!await content.testStreamFile(INDEX_FILE, "r")) {
      await writeIndex(connection, []);
    }
  }

  async function writeIndex(connection: IBMi, templates: SharedTemplate[]) {
    await connection.getContent().writeStreamfileRaw(INDEX_FILE, JSON.stringify(templates, undefined, 2), `utf8`);
    const sorted = [...templates].sort((t1, t2) => t1.name.localeCompare(t2.name));
    indexCache.set(connection, { value: sorted, createdAt: Date.now() });
  }
}
