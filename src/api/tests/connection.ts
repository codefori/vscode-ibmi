import path from "path";
import IBMi from "../IBMi";
import { extensionComponentRegistry } from "../components/manager";
import { Mapepire } from "../components/mapepire";
import { CodeForIStorage } from "../configuration/storage/CodeForIStorage";
import { ConnectionData } from "../types";
import { CustomCLI } from "./components/customCli";
import { JSONConfig, JsonStorage } from "./testConfigSetup";

export const testStorage = new JsonStorage();
const testConfig = new JSONConfig();

export const CONNECTION_TIMEOUT = process.env.VITE_CONNECTION_TIMEOUT ? parseInt(process.env.VITE_CONNECTION_TIMEOUT) : 25000;

if (!process.env.VITE_SERVER || !process.env.VITE_DB_USER) {
  const messages = [
    ``,
    `Please set the environment variables:`,
    `\tVITE_SERVER`,
    `\tVITE_DB_USER`,
    `\tVITE_DB_PASS (or VITE_PRIVATE_KEY_PATH for SSH key authentication)`,
    `\tVITE_DB_PORT`,
    ``,
    `If you're a developer, make a copy of .env.sample,`,
    `rename it to .env, and set the values.`,
    ``,
  ];

  console.log(messages.join(`\n`));

  process.exit(1);
}

// Validate that either password or private key is provided
if (!process.env.VITE_DB_PASS && !process.env.VITE_PRIVATE_KEY_PATH) {
  const messages = [
    ``,
    `Authentication error: You must provide either:`,
    `\tVITE_DB_PASS (for password authentication)`,
    `\tOR`,
    `\tVITE_PRIVATE_KEY_PATH (for SSH key authentication)`,
    ``,
  ];

  console.log(messages.join(`\n`));

  process.exit(1);
}

const ENV_CREDS = {
  host: process.env.VITE_SERVER,
  username: process.env.VITE_DB_USER,
  password: process.env.VITE_DB_PASS,
  privateKeyPath: process.env.VITE_PRIVATE_KEY_PATH,
  passphrase: process.env.VITE_PASSPHRASE,
  port: parseInt(process.env.VITE_DB_PORT || `22`),
  tempLibrary: process.env.VITE_TEMP_LIB || 'ILEDITOR'
}

export async function newConnection(reloadSettings?: boolean) {
  const virtualStorage = testStorage;

  IBMi.GlobalStorage = new CodeForIStorage(virtualStorage);
  IBMi.connectionManager.configMethod = testConfig;

  const conn = new IBMi();

  const mapepire = new Mapepire(path.join(__dirname, `..`, `..`, `..`, `dist`));

  const testingId = `testing`;
  extensionComponentRegistry.registerComponent(testingId, mapepire);
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
        inputBox: async (prompt: string, placeHolder: string, ignoreFocusOut: boolean) => {
          // console.log(`PROMPT: ${prompt}`);
          // console.log(`PLACEHOLDER: ${placeHolder}`);
          // console.log(`IGNORE FOCUS OUT: ${ignoreFocusOut}`);
          return undefined;
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

  if (!result.success) {
    throw new Error(`Failed to connect to IBMi${result.error ? `: ${result.error}` : '!'}`);
  }

  if (reloadSettings) {
    const config = conn.getConfig();
    if (config.tempLibrary !== ENV_CREDS.tempLibrary) {
      config.tempLibrary = ENV_CREDS.tempLibrary;
      await IBMi.connectionManager.update(config);
    }
  }

  return conn;
}

export async function disposeConnection(connection?: IBMi) {
  if (connection) {
    await connection.disconnect();
    testStorage.save();
    testConfig.save();
  }
}