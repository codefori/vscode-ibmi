import assert from "assert";
import { TestSuite } from ".";
import { GetNewLibl } from "../components/getNewLibl";
import { SqlToCsv } from "../components/sqlToCsv";
import { instance } from "../instantiate";
import { GetMemberInfo } from "../components/getMemberInfo";

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
    // {
    //   name: `SQL to CSV wrap`, test: async () => {
    //     const connection = instance.getConnection()!;
    //     const config = instance.getConfig()!;
    //     const component = connection.getComponent<SqlToCsv>(`SqlToCsv`);

    //     assert.ok(component);

    //     const lines = [
    //       `Hello world`,
    //       `àáãÄÜö£øß`
    //     ].join(`\n`);

    //     const tempLib = config.tempLibrary;
    //     const file = `TEST273`;

    //     const statement = `SELECT * FROM ${tempLib}.${tempLib}_${file}_THEMEMBER`;
    //     const wrapped = component.wrap(statement);
    //     assert.ok(wrapped.newStatements[0].startsWith(`CALL ${tempLib}.SQL_TO_CSV('${statement}'`));
    //     assert.ok(wrapped.outStmf.startsWith(config.tempDir));
    //   }
    // },
    {
      name: `Check getMemberInfo`, test: async () => {
        const connection = instance.getConnection();
        const component = connection?.getComponent<GetMemberInfo>(`GetMemberInfo`)!;

        assert.ok(component);

        const memberInfoA = await component.getMemberInfo(`QSYSINC`, `H`, `MATH` );
        assert.ok(memberInfoA);
        assert.strictEqual(memberInfoA?.library === `QSYSINC`, true);
        assert.strictEqual(memberInfoA?.file === `H`, true);
        assert.strictEqual(memberInfoA?.name === `MATH`, true);
        assert.strictEqual(memberInfoA?.extension === `C`, true);
        assert.strictEqual(memberInfoA?.text === `STANDARD HEADER FILE MATH`, true);

        const memberInfoB = await component.getMemberInfo(`QSYSINC`, `H`, `MEMORY` );
        assert.ok(memberInfoB);
        assert.strictEqual(memberInfoB?.library === `QSYSINC`, true);
        assert.strictEqual(memberInfoB?.file === `H`, true);
        assert.strictEqual(memberInfoB?.name === `MEMORY`, true);
        assert.strictEqual(memberInfoB?.extension === `CPP`, true);
        assert.strictEqual(memberInfoB?.text === `C++ HEADER`, true);

        const memberInfoC = await component.getMemberInfo(`QSYSINC`, `H`, `OH_NONO` );
        assert.ok(!memberInfoC);
      }
    },
  ]
};
