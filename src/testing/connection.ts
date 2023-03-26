import assert from "assert";
import { TestSuite } from ".";
import { instance } from "../instantiate";

export const ConnectionSuite: TestSuite = [
  {name: `Send pase command`, test: async () => {
    const connection = instance.getConnection();

    const result = await connection?.sendCommand({
      command: `echo "Hello world"`,
    });

    assert.strictEqual(result?.code, 0);
    assert.strictEqual(result?.stdout, `Hello world`);
  }}
];
