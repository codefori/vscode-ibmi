import vscode from "vscode";
import { env } from "process";
import { instance } from "../instantiate";
import { ConnectionSuite } from "./connection";
import { ContentSuite } from "./content";
import { ToolsSuite } from "./tools";
import { TestSuitesTreeProvider } from "./testCasesTree";

const suites : TestSuite[] = [
  ConnectionSuite,
  ContentSuite,
  ToolsSuite
]

export type TestSuite = {
  name: string
  tests: TestCase[]
}

export interface TestCase {
  name: string,
  status?: "running" | "failed" | "pass"
  failure?: string
  test: () => Promise<void>
}

let testSuitesTreeProvider : TestSuitesTreeProvider;
export function initialise(context: vscode.ExtensionContext) {
  if (env.testing === `true`) {
    vscode.commands.executeCommand(`setContext`, `code-for-ibmi:testing`, true);
    instance.onEvent(`connected`, runTests);
    instance.onEvent(`disconnected`, resetTests);
    testSuitesTreeProvider = new TestSuitesTreeProvider(suites);

    context.subscriptions.push(
      vscode.window.registerTreeDataProvider("testingView", testSuitesTreeProvider),
      vscode.commands.registerCommand(`code-for-ibmi.testing.specific`, (suiteName: string, testName: string) => {
        if (suiteName && testName) {
          const suite = suites.find(suite => suite.name === suiteName);

          if (suite) {
            const testCase = suite.tests.find(testCase => testCase.name === testName);

            if (testCase) {
              runTest(testCase);
            }
          }
        }
      })
    );
  }
}

async function runTests() {
  for (const suite of suites) {
    console.log(`Running suite ${suite.name} (${suite.tests.length})`);
    console.log();
    for (const test of suite.tests) {      
      await runTest(test);
    }
  }  
}

async function runTest(test: TestCase) {
  console.log(`\tRunning ${test.name}`);
  test.status = "running";
  testSuitesTreeProvider.refresh();

  try {
    await test.test();
    test.status = "pass";
  }

  catch (error: any){
    console.log(error);
    test.status = "failed";
    test.failure = error.message;
  }

  finally {
    testSuitesTreeProvider.refresh();
  }
}

function resetTests(){
  suites.flatMap(ts => ts.tests).forEach(tc => {
    tc.status = undefined;
    tc.failure = undefined;
  });
}