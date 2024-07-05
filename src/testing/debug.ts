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
          assert.strictEqual(jdk8.javaHome, connection.remoteFeatures.jdk80);
          assert.ok(!jdk8.isOpenJDK);
        }

        if(connection.remoteFeatures.jdk11){
          const jdk11 = getJavaHome(connection, '11');
          assert.strictEqual(jdk11.javaHome, connection.remoteFeatures.jdk11);
          assert.ok(!jdk11.isOpenJDK);
        }
        else if(connection.remoteFeatures.openjdk11){
          const openJDK = getJavaHome(connection, '11');
          assert.strictEqual(openJDK.javaHome, connection.remoteFeatures.openjdk11);
          assert.ok(openJDK.isOpenJDK);
        }
        
        assert.throws(() => getJavaHome(connection, '666'));
      }
    }
  ]
}