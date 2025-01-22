import IBMi from "../IBMi";
import { CodeForIStorage } from "../configuration/storage/CodeForIStorage";
import { CustomQSh } from "../components/cqsh";
import path from "path";
import { CopyToImport } from "../components/copyToImport";
import { GetMemberInfo } from "../components/getMemberInfo";
import { GetNewLibl } from "../components/getNewLibl";
import { extensionComponentRegistry } from "../components/manager";
import { JsonConfig, JsonStorage } from "./testConfigSetup";

export const testStorage = new JsonStorage();
const testConfig = new JsonConfig();

export const CONNECTION_TIMEOUT = process.env.VITE_CONNECTION_TIMEOUT ? parseInt(process.env.VITE_CONNECTION_TIMEOUT) : 25000;

const ENV_CREDS = {
  host: process.env.VITE_SERVER || `localhost`,
  user: process.env.VITE_DB_USER,
  password: process.env.VITE_DB_PASS,
  port: parseInt(process.env.VITE_DB_PORT || `22`)
}

export async function newConnection() {
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

  const creds = {
    host: ENV_CREDS.host!,
    name: `testsystem`,
    username: ENV_CREDS.user!,
    password: ENV_CREDS.password!,
    port: ENV_CREDS.port
  };

  // Override this so not to spam the console.
  conn.appendOutput = (data) => {};

  const result = await conn.connect(
    creds,
    {
      message: (type: string, message: string) => {
        // console.log(`${type.padEnd(10)} ${message}`);
      },
      progress: ({message}) => {
        // console.log(`PROGRESS: ${message}`);
      },
      uiErrorHandler: async (connection, code, data) => {
        console.log(`Connection warning: ${code}: ${JSON.stringify(data)}`);
        return false;
      },
    }
  );

  if (!result.success) {
    throw new Error(`Failed to connect to IBMi`);
  }

  return conn;
}

export function disposeConnection(conn?: IBMi) {
  if (!conn) {
    return;
  }

  conn.dispose();
  testStorage.save();
  testConfig.save();
}