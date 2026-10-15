import { l10n } from "vscode";
import { instance } from "../instantiate";
import { VscodeTools } from "../ui/Tools";
import IBMi from "./IBMi";
import { ObjectFilters } from "./types";

export function validateFilterName(name: string, names: string[]) {
  if (!name) {
    return l10n.t('Name cannot be empty');
  }
  else if (VscodeTools.includesCaseInsensitive(names, name)) {
    return l10n.t("Object Filter {0} already exists", name);
  }
}

export async function updateObjectFilter(filter: ObjectFilters, options?: { newName?: string, delete?: boolean }) {
  const config = instance.getConnection()?.getConfig();
  if (config) {
    const filters = config.objectFilters;
    const index = filters.findIndex(f => f.name === filter.name);

    if (options?.delete) {
      if (index < 0) {
        throw new Error(l10n.t("Object Filter {0} not found for deletion.", filter.name));
      }
      filters.splice(index, 1);
    }
    else {
      filter.name = options?.newName || filter.name;
      filters[index < 0 ? filters.length : index] = filter;
    }

    await IBMi.connectionManager.update(config);
  }
}

export function getObjectFilters() {
  const config = instance.getConnection()?.getConfig();
  if (config) {
    return config.objectFilters.filter(filter => Boolean(filter.name));
  }
  else {
    throw new Error(l10n.t("Not connected to an IBM i"));
  }
}

export function getObjectFilter(filterName: string) {
  return getObjectFilters().filter(f => f.name === filterName).at(0);
}

export function cloneObjectFilter(from: ObjectFilters, newName: string): ObjectFilters {
  return Object.assign({}, { ...from, name: newName });
}