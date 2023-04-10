import { env } from "process";
import { instance } from "../instantiate";
import { ConnectionSuite } from "./connection";
import { ContentSuite } from "./content";

const suites = [
  {name: `Connection tests`, tests: ConnectionSuite},
  {name: `Content tests`, tests: ContentSuite}
]

export type TestSuite = TestCase[];

export interface TestCase {
  name: string,
  test: () => Promise<void>
}

export function initialise() {
  if (env.testing === `true`) {
    instance.onEvent(`connected`, runTests);
  }
}

async function runTests() {
  for (const suite of suites) {
    console.log(`Running suite ${suite.name} (${suite.tests.length})`);
    console.log();
    for (const test of suite.tests) {
      console.log(`\tRunning ${test.name}`);
      await test.test();
    }
  }
}