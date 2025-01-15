import assert from "assert";
import IBMi from "../IBMi";
import { ENV_CREDS } from "./env";
import { getConnection, setConnection } from "./state";
import { afterAll, beforeAll, expect } from "vitest";
import { CodeForIStorage, ConnectionStorage, VirtualStorage } from "../configuration/Storage";
import { VirtualConfig } from "../configuration/Config";

beforeAll(async () => {
  const virtualStorage = new VirtualStorage();

  IBMi.GlobalStorage = new CodeForIStorage(virtualStorage);
  IBMi.connectionManager.configMethod = new VirtualConfig();

  const conn = new IBMi();

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
        console.log(`UI ERROR: ${code}: ${data}`);
        return false;
      },
    }
  );

  expect(result).toBeDefined();
  expect(result.success).toBeTruthy();

  setConnection(conn);
}, 25000);

afterAll(async () => {
  const conn = getConnection();

  if (conn) {
    await conn.dispose();
  } else {
    assert.fail(`Connection was not set`);
  }
})