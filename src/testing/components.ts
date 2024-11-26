import assert from "assert";
import { TestSuite } from ".";
import { Tools } from "../api/Tools";
import { GetMemberInfo } from "../components/getMemberInfo";
import { GetNewLibl } from "../components/getNewLibl";
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
        const component = connection.getComponent<GetNewLibl>(GetNewLibl);

        if (component) {
          const newLibl = await component.getLibraryListFromCommand(`CHGLIBL CURLIB(SYSTOOLS)`);

          assert.strictEqual(newLibl?.currentLibrary, `SYSTOOLS`);

        } else {
          assert.fail(`Component not installed`);
        }
      },
    },
    {
      name: `Check getMemberInfo`, test: async () => {
        const connection = instance.getConnection();
        const component = connection?.getComponent<GetMemberInfo>(GetMemberInfo)!;

        assert.ok(component);

        const memberInfoA = await component.getMemberInfo(`QSYSINC`, `H`, `MATH`);
        assert.ok(memberInfoA);
        assert.strictEqual(memberInfoA?.library === `QSYSINC`, true);
        assert.strictEqual(memberInfoA?.file === `H`, true);
        assert.strictEqual(memberInfoA?.name === `MATH`, true);
        assert.strictEqual(memberInfoA?.extension === `C`, true);
        assert.strictEqual(memberInfoA?.text === `STANDARD HEADER FILE MATH`, true);

        const memberInfoB = await component.getMemberInfo(`QSYSINC`, `H`, `MEMORY`);
        assert.ok(memberInfoB);
        assert.strictEqual(memberInfoB?.library === `QSYSINC`, true);
        assert.strictEqual(memberInfoB?.file === `H`, true);
        assert.strictEqual(memberInfoB?.name === `MEMORY`, true);
        assert.strictEqual(memberInfoB?.extension === `CPP`, true);
        assert.strictEqual(memberInfoB?.text === `C++ HEADER`, true);

        try{
          await component.getMemberInfo(`QSYSINC`, `H`, `OH_NONO`)
        }
        catch(error: any){
          assert.ok(error instanceof Tools.SqlError);
          assert.strictEqual(error.sqlstate, "38501");
        }
      }
    },
  ]
};
