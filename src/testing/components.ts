import assert from "assert";
import { TestSuite } from ".";
import { GetNewLibl } from "../components/getNewLibl";
import { SqlToCsv } from "../components/sqlToCsv";
import { instance } from "../instantiate";

export const ComponentSuite: TestSuite = {
  name: `Component tests`,
  before: async () => {
    const config = instance.getConfig()!;
    assert.ok(config.enableSourceDates, `Source dates must be enabled for this test.`);
  },

  tests: [
    {
      name: `Get new libl`, test: async () => {
        const connection = instance.getConnection()!
        const component = connection.getComponent<GetNewLibl>(`GetNewLibl`);

        if (component) {
          const newLibl = await component.getLibraryListFromCommand(`CHGLIBL CURLIB(SYSTOOLS)`);

          assert.strictEqual(newLibl?.currentLibrary, `SYSTOOLS`);

        } else {
          assert.fail(`Component not installed`);
        }
      },
    },
    {
      name: `SQL to CSV wrap`, test: async () => {
        const connection = instance.getConnection()!;
        const config = instance.getConfig()!;
        const component = connection.getComponent<SqlToCsv>(`SqlToCsv`);

        assert.ok(component);

        const lines = [
          `Hello world`,
          `àáãÄÜö£øß`
        ].join(`\n`);

        const tempLib = config.tempLibrary;
        const file = `TEST273`;

        const statement = `SELECT * FROM ${tempLib}.${tempLib}_${file}_THEMEMBER`;
        const wrapped = component.wrap(statement);
        assert.ok(wrapped.newStatement.startsWith(`CALL ${tempLib}.SQL_TO_CSV('${statement}'`));
        assert.ok(wrapped.outStmf.startsWith(config.tempDir));
      }
    }
  ]
};
