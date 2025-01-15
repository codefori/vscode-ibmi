import assert from "assert";
import IBMi from "../IBMi";
import { ENV_CREDS } from "./env";
import { setConnection } from "./state";
import { vi } from "vitest";

export default async function setup() {
  // vi.mock(import(`vscode`), async (importOriginal) => {
  //   return {}
  // });

  const conn = new IBMi();

  const result = await conn.connect(
    {
      host: ENV_CREDS.host!,
      name: `testsystem`,
      username: ENV_CREDS.user!,
      password: ENV_CREDS.password!,
      port: ENV_CREDS.port
    },
    {
      message: (type: string, message: string) => {
        console.log(`${type.padEnd(10)} ${message}`);
      },
      progress: ({message}) => {
        console.log(`PROGRESS: ${message}`);
      },
      uiErrorHandler: async (connection, code, data) => {
        console.log(`UI ERROR: ${code}: ${data}`);
        return false;
      },
    }
  );

  assert.ok(result.success);

  setConnection(conn);
}
