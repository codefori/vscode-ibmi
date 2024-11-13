import assert from "assert";
import { TestSuite } from ".";
import { getJavaHome } from "../api/debug/config";
import { instance } from "../instantiate";

export const DebugSuite: TestSuite = {
  name: `Debug engine tests`,
  tests: [
    {
      name: "Check Java versions", test: async () => {
        const connection = instance.getConnection()!;
        if(connection.remoteFeatures.jdk80){
          const jdk8 = getJavaHome(connection, '8');
          assert.strictEqual(jdk8, connection.remoteFeatures.jdk80);
        }

        if(connection.remoteFeatures.jdk11){
          const jdk11 = getJavaHome(connection, '11');
          assert.strictEqual(jdk11, connection.remoteFeatures.jdk11);
        }

        if(connection.remoteFeatures.jdk17){
          const jdk11 = getJavaHome(connection, '17');
          assert.strictEqual(jdk11, connection.remoteFeatures.jdk17);
        }

        assert.throws(() => getJavaHome(connection, '666'));
      }
    }
  ]
}