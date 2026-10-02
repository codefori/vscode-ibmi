import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile } from '../../configuration/config/types';

vi.mock('vscode', () => ({
  l10n: {
    t: (message: string, ...args: unknown[]) => message.replace(/\{(\d+)\}/g, (_, index) => String(args[Number(index)]))
  }
}));

import { activateLibraryListPreset, createLibraryListPreset, deleteLibraryListPreset, ensureLibraryListPresets, renameLibraryListPreset } from '../../libraryListPresets';

const defaults = {
  currentLibrary: 'DEFAULT',
  libraryList: ['QGPL']
};

function profile(overrides: Partial<ConnectionProfile> = {}): ConnectionProfile {
  return {
    name: 'Test profile',
    homeDirectory: '.',
    libraryList: [],
    objectFilters: [],
    ifsShortcuts: [],
    customVariables: [],
    ...overrides
  };
}

describe('library list presets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('migrates an empty profile to a default preset using its existing library list', () => {
    const config = profile({ currentLibrary: 'CURLIB', libraryList: ['DEVLIB'] });

    const presets = ensureLibraryListPresets(config, defaults);

    expect(presets).toEqual([{ name: 'Default', currentLibrary: 'CURLIB', libraryList: ['DEVLIB'] }]);
    expect(config.activeLibraryListPreset).toBe('Default');
  });

  it('creates and activates a preset with the supplied defaults', () => {
    const config = profile();
    ensureLibraryListPresets(config, defaults);

    createLibraryListPreset(config, 'Development', defaults);

    expect(config.activeLibraryListPreset).toBe('Development');
    expect(config.currentLibrary).toBe('DEFAULT');
    expect(config.libraryList).toEqual(['QGPL']);
    expect(config.libraryListPresets).toContainEqual({ name: 'Development', currentLibrary: 'DEFAULT', libraryList: ['QGPL'] });
  });

  it('activates a preset and copies its libraries into the profile', () => {
    const config = profile({
      currentLibrary: 'OLDLIB',
      libraryList: ['OLDLIST'],
      activeLibraryListPreset: 'Default',
      libraryListPresets: [
        { name: 'Default', currentLibrary: 'DEFAULT', libraryList: ['QGPL'] },
        { name: 'Test', currentLibrary: 'TESTLIB', libraryList: ['TESTA', 'TESTB'] }
      ]
    });

    activateLibraryListPreset(config, 'Test');

    expect(config.activeLibraryListPreset).toBe('Test');
    expect(config.currentLibrary).toBe('TESTLIB');
    expect(config.libraryList).toEqual(['TESTA', 'TESTB']);
  });

  it('renames the active preset and rejects a duplicate name', () => {
    const config = profile({
      activeLibraryListPreset: 'Default',
      libraryListPresets: [
        { name: 'Default', libraryList: [] },
        { name: 'Test', libraryList: [] }
      ]
    });

    renameLibraryListPreset(config, config.libraryListPresets![0], 'Main');

    expect(config.activeLibraryListPreset).toBe('Main');
    expect(config.libraryListPresets![0].name).toBe('Main');
    expect(() => renameLibraryListPreset(config, config.libraryListPresets![0], 'Test')).toThrow('A library list named Test already exists.');
  });

  it('deletes an inactive preset even when the tree node holds an older object reference', () => {
    const stalePreset = { name: 'Test', libraryList: ['TESTLIB'] };
    const config = profile({
      activeLibraryListPreset: 'Default',
      libraryListPresets: [
        { name: 'Default', libraryList: [] },
        { name: 'Test', libraryList: ['TESTLIB'] }
      ]
    });

    deleteLibraryListPreset(config, stalePreset);

    expect(config.libraryListPresets).toEqual([{ name: 'Default', libraryList: [] }]);
  });

  it('does not delete the only preset or the active preset', () => {
    const onlyPreset = { name: 'Default', libraryList: [] };
    const singleConfig = profile({ activeLibraryListPreset: 'Default', libraryListPresets: [onlyPreset] });
    const activeConfig = profile({
      activeLibraryListPreset: 'Default',
      libraryListPresets: [onlyPreset, { name: 'Test', libraryList: [] }]
    });

    expect(() => deleteLibraryListPreset(singleConfig, onlyPreset)).toThrow('At least one library list must remain.');
    expect(() => deleteLibraryListPreset(activeConfig, onlyPreset)).toThrow('The active library list cannot be deleted.');
  });
});