import { l10n } from "vscode";
import IBMi from "./IBMi";
import { ConnectionConfig, ConnectionProfile, LibraryListPreset } from "./configuration/config/types";

const DEFAULT_PRESET_NAME = l10n.t(`Default`);

export interface LibraryListDefaults {
  currentLibrary?: string
  libraryList: string[]
}

export function ensureLibraryListPresets(config: ConnectionProfile, defaults: LibraryListDefaults): LibraryListPreset[] {
  config.libraryListPresets ||= [];

  if (config.libraryListPresets.length === 0) {
    config.libraryListPresets = [{
      name: DEFAULT_PRESET_NAME,
      currentLibrary: config.currentLibrary ?? defaults.currentLibrary,
      libraryList: config.libraryList.length ? [...config.libraryList] : [...defaults.libraryList]
    }];
  }

  if (!config.activeLibraryListPreset || !findLibraryListPreset(config, config.activeLibraryListPreset)) {
    config.activeLibraryListPreset = config.libraryListPresets[0].name;
  }

  return config.libraryListPresets;
}

export function findLibraryListPreset(config: ConnectionProfile, name: string) {
  return config.libraryListPresets.find(preset => preset.name.localeCompare(name, undefined, { sensitivity: `accent` }) === 0);
}

export function createLibraryListPreset(config: ConnectionProfile, name: string, defaults: LibraryListDefaults) {
  validatePresetName(config, name);

  const preset: LibraryListPreset = {
    name: name.trim(),
    currentLibrary: defaults.currentLibrary,
    libraryList: [...defaults.libraryList]
  };

  config.libraryListPresets.push(preset);
  activateLibraryListPreset(config, preset.name);
  return preset;
}

export function renameLibraryListPreset(config: ConnectionProfile, preset: LibraryListPreset, name: string) {
  validatePresetName(config, name, preset.name);
  const newName = name.trim();

  if (config.activeLibraryListPreset === preset.name) {
    config.activeLibraryListPreset = newName;
  }

  preset.name = newName;
}

export function deleteLibraryListPreset(config: ConnectionProfile, preset: LibraryListPreset) {
  if (config.libraryListPresets.length === 1) {
    throw new Error(l10n.t(`At least one library list must remain.`));
  }

  if (config.activeLibraryListPreset === preset.name) {
    throw new Error(l10n.t(`The active library list cannot be deleted.`));
  }

  const index = config.libraryListPresets.findIndex(candidate => candidate.name.localeCompare(preset.name, undefined, { sensitivity: `accent` }) === 0);
  if (index < 0) {
    throw new Error(l10n.t(`Library list {0} was not found.`, preset.name));
  }

  config.libraryListPresets.splice(index, 1);
}

export function activateLibraryListPreset(config: ConnectionProfile, name: string) {
  const preset = findLibraryListPreset(config, name);
  if (!preset) {
    throw new Error(l10n.t(`Library list {0} was not found.`, name));
  }

  config.activeLibraryListPreset = preset.name;
  config.currentLibrary = preset.currentLibrary;
  config.libraryList = [...preset.libraryList];
  return preset;
}

export function saveActiveLibraryListPreset(config: ConnectionProfile) {
  const preset = config.activeLibraryListPreset && findLibraryListPreset(config, config.activeLibraryListPreset);
  if (preset) {
    preset.currentLibrary = config.currentLibrary;
    preset.libraryList = [...config.libraryList];
  }
}

export async function persistLibraryListPresets(config: ConnectionConfig) {
  await IBMi.connectionManager.update(config);
}

function validatePresetName(config: ConnectionProfile, name: string, currentName?: string) {
  const newName = name.trim();
  if (!newName) {
    throw new Error(l10n.t(`Library list name cannot be empty.`));
  }

  const existingPreset = findLibraryListPreset(config, newName);
  if (existingPreset && existingPreset.name !== currentName) {
    throw new Error(l10n.t(`A library list named {0} already exists.`, newName));
  }
}