import vscode, { l10n } from "vscode";
import IBMi from "./IBMi";
import { SharedTemplate } from "./types";

const INDEX_FILE = `/etc/vscode/Code4iRepo.json`;

// One connection can only have one set of shared templates loaded at a time;
// used so the dynamic CompletionItemProvider doesn't hit the IFS on every keystroke.
const cache = new WeakMap<IBMi, SharedTemplate[]>();

/**
 * Reads and writes the shared, server-side snippet index stored at
 * {@link INDEX_FILE}, in a shape close to VS Code's own user snippets
 * (name/prefix/description/body), so any connected user can share
 * dynamically-loaded snippets without bundling anything in the extension.
 */
export namespace SharedTemplateTools {
  export function getIndexFile() {
    return INDEX_FILE;
  }

  export function getBody(template: SharedTemplate) {
    return template.body.join(`\n`);
  }

  export async function getTemplates(connection: IBMi, options?: { forceReload?: boolean }): Promise<SharedTemplate[]> {
    if (!options?.forceReload && cache.has(connection)) {
      return cache.get(connection)!;
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
            if (typeof entry.name === `string` && typeof entry.prefix === `string` && Array.isArray(entry.body)) {
              templates.push({
                name: entry.name,
                prefix: entry.prefix,
                description: typeof entry.description === `string` ? entry.description : ``,
                body: entry.body.map((line: any) => String(line)),
                extensions: Array.isArray(entry.extensions) && entry.extensions.length ? entry.extensions : [`GLOBAL`]
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
    cache.set(connection, templates);
    return templates;
  }

  export async function createTemplate(connection: IBMi, template: SharedTemplate) {
    const templates = await getTemplates(connection);
    templates.push(template);
    await writeIndex(connection, templates);
  }

  export async function updateTemplate(connection: IBMi, template: SharedTemplate, options?: { newName?: string, newPrefix?: string, newDescription?: string, newBody?: string[], delete?: boolean }) {
    const templates = await getTemplates(connection);
    const index = templates.findIndex(t => t.name === template.name);
    if (index < 0) {
      throw new Error(l10n.t("Cannot find shared template {0} for update.", template.name));
    }

    if (options?.delete) {
      templates.splice(index, 1);
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
      if (options?.newBody !== undefined) {
        templates[index].body = options.newBody;
      }
    }

    await writeIndex(connection, templates);
  }

  async function writeIndex(connection: IBMi, templates: SharedTemplate[]) {
    await connection.getContent().writeStreamfileRaw(INDEX_FILE, JSON.stringify(templates, undefined, 2), `utf8`);
    cache.set(connection, [...templates].sort((t1, t2) => t1.name.localeCompare(t2.name)));
  }
}
