import assert from "assert";
import { TestSuite } from ".";
import { instance } from "../instantiate";

export const ConnectionSuite: TestSuite = [
  {name: `Test sendCommand`, test: async () => {
    const connection = instance.getConnection();

    const result = await connection?.sendCommand({
      command: `echo "Hello world"`,
    });

    assert.strictEqual(result?.code, 0);
    assert.strictEqual(result?.stdout, `Hello world`);
  }},

  {name: `Test sendCommand home directory`, test: async () => {
    const connection = instance.getConnection();

    const resultA = await connection?.sendCommand({
      command: `pwd`,
      directory: `/QSYS.LIB`
    });

    assert.strictEqual(resultA?.code, 0);
    assert.strictEqual(resultA?.stdout, `/QSYS.LIB`);

    const resultB = await connection?.sendCommand({
      command: `pwd`,
      directory: `/home`
    });

    assert.strictEqual(resultB?.code, 0);
    assert.strictEqual(resultB?.stdout, `/home`);

    const resultC = await connection?.sendCommand({
      command: `pwd`,
      directory: `/badnaughty`
    });

    assert.notStrictEqual(resultC?.stdout, `/badnaughty`);
  }},

  {name: `Test sendCommand with environment variables`, test: async () => {
    const connection = instance.getConnection();

    const result = await connection?.sendCommand({
      command: `echo "$vara $varB $VARC"`,
      env: {
        vara: `Hello`,
        varB: `world`,
        VARC: `cool`
      }
    });

    assert.strictEqual(result?.code, 0);
    assert.strictEqual(result?.stdout, `Hello world cool`);
  }},
];
