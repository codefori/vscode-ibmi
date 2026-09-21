import { ConnectionData } from "../../types";
import IBMi, { ConnectionErrorCode } from "../../IBMi";
import { extensionComponentRegistry } from "../../components/manager";
import { Mapepire } from "../../components/mapepire";
import { CodeForIStorage } from "../../configuration/storage/CodeForIStorage";
import { JsonConfig, JsonStorage } from "./json";
import { TestEnv } from "./env";
import path from "path";
import { readdirSync } from "fs";
import { CustomCLI } from "../components/customCli";

export const envVars = TestEnv.getEnvironmentVariables();
const testStorage = new JsonStorage();
const testConfig = new JsonConfig();

export async function newConnection(reloadSettings?: boolean) {
  // Setup credentials
  const credentials: ConnectionData = {
    name: `${envVars.VITE_DB_USER}@${envVars.VITE_SERVER}_test`,
    host: envVars.VITE_SERVER,
    username: envVars.VITE_DB_USER,
    port: envVars.VITE_DB_PORT,
    password: envVars.VITE_DB_PASS,
    privateKeyPath: envVars.VITE_PRIVATE_KEY_PATH,
    passphrase: envVars.VITE_PASSPHRASE
  };

  // Setup Code4i virtual storage and config
  IBMi.GlobalStorage = new CodeForIStorage(testStorage);
  IBMi.connectionManager.configMethod = testConfig;

  // Override temp library and IASP in Code4i config if set
  const tempLib = envVars.VITE_TEMP_LIB;
  const iasp = envVars.VITE_IASP;
  const config = await IBMi.connectionManager.load(credentials.name);
  let updateConfig = false;
  if (config.tempLibrary !== tempLib) {
    config.tempLibrary = tempLib;
    updateConfig = true;
  }
  if (config.iasp !== iasp) {
    config.iasp = iasp;
    updateConfig = true;
  }
  if (updateConfig) {
    await IBMi.connectionManager.update(config);
  }

  // Setup components
  const mapepireDistDir = path.join(__dirname, `..`, `..`, `..`, `..`, `dist`);
  const mapepireJarFileName = readdirSync(mapepireDistDir).find(file => /^mapepire-server-.+\.jar$/.test(file));
  if (!mapepireJarFileName) {
    throw new Error(`Failed to locate Mapepire Server JAR file in ${mapepireDistDir}`);
  }
  const mapepire = new Mapepire(mapepireDistDir, async () => envVars.VITE_DB_PASS);
  const testingId = `testing`;
  extensionComponentRegistry.registerComponent(testingId, mapepire);
  extensionComponentRegistry.registerComponent(testingId, new CustomCLI());
  const componentId = `toBeDeleted`;
  extensionComponentRegistry.registerComponent(testingId, new CustomCLI(componentId));
  extensionComponentRegistry.disableComponent(testingId, componentId);

  // Connect to IBM i
  const connection = new IBMi();
  connection.appendOutput = async (data: string) => { };
  const result = await connection.connect(
    credentials,
    {
      callbacks: {
        message: (type: string, message: string) => {
          // console.log(`${type.padEnd(10)} ${message}`);
        },
        progress: ({ message }: { message: string }) => {
          // console.log(`PROGRESS: ${message}`);
        },
        inputBox: async (prompt: string, placeHolder: string, ignoreFocusOut: boolean) => {
          // console.log(`PROMPT: ${prompt}`);
          // console.log(`PLACEHOLDER: ${placeHolder}`);
          // console.log(`IGNORE FOCUS OUT: ${ignoreFocusOut}`);
          return undefined;
        },
        uiErrorHandler: async (connection: IBMi, error: ConnectionErrorCode, data?: any) => {
          console.log(`Connection warning: ${error}: ${JSON.stringify(data)}`);
          return false;
        },
      },
      reloadServerSettings: reloadSettings,
      reconnecting: false
    }
  );
  if (!result.success) {
    throw new Error(`Failed to connect to IBM i${result.error ? `: ${result.error}` : '!'}`);
  }

  return connection;
}

export async function disposeConnection(connection?: IBMi) {
  if (connection) {
    await connection.disconnect();
    testStorage.save();
    testConfig.save();
  }
}