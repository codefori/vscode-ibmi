import assert from "assert";
import { randomInt } from "crypto";
import { posix } from "path";
import tmp from 'tmp';
import util, { TextDecoder } from 'util';
import { RelativePattern, Uri, workspace} from "vscode";
import { TestSuite } from ".";
import { Tools } from "../api/Tools";
import { getMemberUri } from "../filesystems/qsys/QSysFs";
import { instance } from "../instantiate";
import { CommandResult } from "../typings";
import { ConfigFile } from "../api/config/configFile";
import IBMi from "../api/IBMi";

interface TestConfig {
  strings: [];
}

async function deleteFile(connection: IBMi, thePath: string) {
  if (thePath.startsWith(`/`)) {
    await connection.sendCommand({command: `rm -f ${thePath}`});
  } else if (workspace.workspaceFolders) {
    const ws = workspace.workspaceFolders[0];
    if (ws) {
      const relativeSearch = new RelativePattern(ws, `**/${thePath}`);
      const configFiles = await workspace.findFiles(relativeSearch, null, 1);
      if (configFiles.length > 0) {
        workspace.fs.delete(configFiles[0])
      }
    }
  }
}

function getTestConfigFile(connection: IBMi): ConfigFile<TestConfig> {
  const TestConfig = new ConfigFile<TestConfig>(connection, `testing`, {strings: []});

  TestConfig.hasServerFile = true;
  TestConfig.mergeArrays = true;
  TestConfig.validateAndCleanInPlace = (loadedConfig) => {
    if (loadedConfig.strings) {
      const hasNonString = loadedConfig.strings.some((str: unknown) => typeof str !== `string`);
      if (hasNonString) {
        throw new Error(`All strings must be strings.`);
      }
    } else {
      throw new Error(`Strings array is required.`);
    }

    return loadedConfig;
  };

  return TestConfig;
}

export const ConfigFileSuite: TestSuite = {
  name: `Config API tests`,
  before: async () => {
    const workspaceFolder = workspace.workspaceFolders ? workspace.workspaceFolders[0] : undefined;
    assert.ok(workspaceFolder, "No workspace folder to work with");

    const connection = instance.getConnection();

    await connection?.sendCommand({command: `mkdir -p /etc/.vscode`});
  },

  tests: [
    {
      name: `Test no configs exist`, test: async () => {
        const connection = instance.getConnection()!;
        const testConfig = getTestConfigFile(connection);
        const configs = testConfig.getPaths();

        await Promise.all([deleteFile(connection, configs.workspace), deleteFile(connection, configs.server)]);

        assert.strictEqual(testConfig.getState().server, `not_loaded`)
        await testConfig.loadFromServer();
        assert.strictEqual(testConfig.getState().server, `no_exist`)

        const baseValue = await testConfig.get(workspace.workspaceFolders![0]);
        assert.deepStrictEqual(baseValue, {strings: []});
      },
    },
    {
      name: `Test server config`, test: async () => {
        const connection = instance.getConnection()!;
        const testConfig = getTestConfigFile(connection);
        const configs = testConfig.getPaths();

        await Promise.all([deleteFile(connection, configs.workspace), deleteFile(connection, configs.server)]);

        const validContent = {strings: [`hello`, `world`]};

        await connection.getContent().writeStreamfileRaw(configs.server, Buffer.from(JSON.stringify(validContent)), `utf8`);

        assert.strictEqual(testConfig.getState().server, `not_loaded`)
        await testConfig.loadFromServer();
        assert.strictEqual(testConfig.getState().server, `ok`)

        const baseValue = await testConfig.get(workspace.workspaceFolders![0]);
        assert.deepStrictEqual(baseValue, validContent);
      },
    },
    {
      name: `Test server config validation`, test: async () => {
        const connection = instance.getConnection()!;
        const testConfig = getTestConfigFile(connection);
        const configs = testConfig.getPaths();

        await Promise.all([deleteFile(connection, configs.workspace), deleteFile(connection, configs.server)]);

        const validContent = {strings: [`hello`, 5]};

        await connection.getContent().writeStreamfileRaw(configs.server, Buffer.from(JSON.stringify(validContent)), `utf8`);

        assert.strictEqual(testConfig.getState().server, `not_loaded`)
        await testConfig.loadFromServer();
        assert.strictEqual(testConfig.getState().server, `invalid`)

        const baseValue = await testConfig.get();
        assert.deepStrictEqual(baseValue, {strings: []});
      },
    },
    {
      name: `Test workspace config`, test: async () => {
        const connection = instance.getConnection()!;
        const testConfig = getTestConfigFile(connection);
        const configs = testConfig.getPaths();

        await Promise.all([deleteFile(connection, configs.workspace), deleteFile(connection, configs.server)]);

        const ws = workspace.workspaceFolders![0]!;
        const validContent = {strings: [`hello`, `mars`]};

        const localFile = Uri.joinPath(ws.uri, configs.workspace);
        await workspace.fs.writeFile(localFile, Buffer.from(JSON.stringify(validContent)));

        assert.strictEqual(testConfig.getState().server, `not_loaded`);
        await testConfig.loadFromServer();
        assert.strictEqual(testConfig.getState().server, `no_exist`);

        const baseValue = await testConfig.get(ws);
        assert.deepStrictEqual(baseValue, validContent);
      },
    },
    {
      name: `Test config merges`, test: async () => {
        const connection = instance.getConnection()!;
        const testConfig = getTestConfigFile(connection);
        const configs = testConfig.getPaths();

        await Promise.all([deleteFile(connection, configs.workspace), deleteFile(connection, configs.server)]);

        const ws = workspace.workspaceFolders![0]!;
        const workspaceConfig = {strings: [`hello`, `mars`]};
        const serverConfig = {strings: [`hello`, `world`]};

        const localFile = Uri.joinPath(ws.uri, configs.workspace);
        await workspace.fs.writeFile(localFile, Buffer.from(JSON.stringify(workspaceConfig)));

        await connection.getContent().writeStreamfileRaw(configs.server, Buffer.from(JSON.stringify(serverConfig)), `utf8`);

        assert.strictEqual(testConfig.getState().server, `not_loaded`);
        await testConfig.loadFromServer();
        assert.strictEqual(testConfig.getState().server, `ok`);

        const baseValue = await testConfig.get(ws);
        assert.deepStrictEqual(baseValue, {strings: [...workspaceConfig.strings, ...serverConfig.strings]});

        const secondRead = await testConfig.get(ws);
        assert.deepStrictEqual(secondRead, {strings: [...workspaceConfig.strings, ...serverConfig.strings]});
        
        testConfig.mergeArrays = false;

        // After merge arrays is disabled, the workspace config takes precedence over the server config

        const afterMergeA = await testConfig.get(ws);
        assert.deepStrictEqual(afterMergeA, workspaceConfig);

        // But if we delete the workspace config, the server config will be used

        await workspace.fs.delete(localFile);

        const afterMergeB = await testConfig.get(ws);
        assert.deepStrictEqual(afterMergeB, serverConfig);
      },
    },
  ]
};
