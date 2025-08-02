import path from "path";
import IBMi from "../IBMi";
import { CopyToImport } from "../components/copyToImport";
import { CustomQSh } from "../components/cqsh";
import { GetMemberInfo } from "../components/getMemberInfo";
import { GetNewLibl } from "../components/getNewLibl";
import { extensionComponentRegistry } from "../components/manager";
import { CodeForIStorage } from "../configuration/storage/CodeForIStorage";
import { ConnectionData } from "../types";
import { CustomCLI } from "./components/customCli";
import { JsonConfig, JsonStorage } from "./testConfigSetup";

export const testStorage = new JsonStorage();
const testConfig = new JsonConfig();

export const CONNECTION_TIMEOUT = process.env.VITE_CONNECTION_TIMEOUT ? parseInt(process.env.VITE_CONNECTION_TIMEOUT) : 25000;

if (!process.env.VITE_SERVER || !process.env.VITE_DB_USER || !process.env.VITE_DB_PASS) {
  const messages = [
    ``,
    `Please set the environment variables:`,
    `\tVITE_SERVER`,
    `\tVITE_DB_USER`,
    `\tVITE_DB_PASS`,
    `\tVITE_DB_PORT`,
    ``,
    `If you're a developer, make a copy of .env.sample,`,
    `rename it to .env, and set the values.`,
    ``,
  ];

  console.log(messages.join(`\n`));

  process.exit(1);
}

const ENV_CREDS = {
  host: process.env.VITE_SERVER,
  username: process.env.VITE_DB_USER,
  password: process.env.VITE_DB_PASS,
  port: parseInt(process.env.VITE_DB_PORT || `22`),
  tempLibrary: process.env.VITE_TEMP_LIB || 'ILEDITOR'
}

export async function newConnection(reloadSettings?: boolean) {
  const virtualStorage = testStorage;

  IBMi.GlobalStorage = new CodeForIStorage(virtualStorage);
  IBMi.connectionManager.configMethod = testConfig;

  await testStorage.load();
  await testConfig.load();

  const conn = new IBMi();

  const customQsh = new CustomQSh();
  const cqshPath = path.join(__dirname, `..`, `components`, `cqsh`, `cqsh`);
  customQsh.setLocalAssetPath(cqshPath);

  const testingId = `testing`;
  extensionComponentRegistry.registerComponent(testingId, customQsh);
  extensionComponentRegistry.registerComponent(testingId, new GetNewLibl());
  extensionComponentRegistry.registerComponent(testingId, new GetMemberInfo());
  extensionComponentRegistry.registerComponent(testingId, new CopyToImport());

  extensionComponentRegistry.registerComponent(testingId, new CustomCLI());

  const creds: ConnectionData = {
    ...ENV_CREDS,
    name: `${ENV_CREDS.host}_${ENV_CREDS.username}_test`
  };

  // Override this so not to spam the console.
  conn.appendOutput = (data) => { };

  const result = await conn.connect(
    creds,
    {
      callbacks: {
        message: (type: string, message: string) => {
          // console.log(`${type.padEnd(10)} ${message}`);
        },
        progress: ({ message }) => {
          // console.log(`PROGRESS: ${message}`);
        },
        uiErrorHandler: async (connection, code, data) => {
          console.log(`Connection warning: ${code}: ${JSON.stringify(data)}`);
          return false;
        },
      },
      reloadServerSettings: reloadSettings,
      reconnecting: false,
    }
  );

  if (reloadSettings) {
    const config = conn.getConfig();
    if (config.tempLibrary !== ENV_CREDS.tempLibrary) {
      config.tempLibrary = ENV_CREDS.tempLibrary;
      await IBMi.connectionManager.update(config);
    }
  }

  if (!result.success) {
    throw new Error(`Failed to connect to IBMi`);
  }

  return conn;
}

export async function disposeConnection(conn?: IBMi) {
  if (!conn) {
    return;
  }

  await Promise.all([
    conn.dispose(),
    testStorage.save(),
    testConfig.save()]);
}