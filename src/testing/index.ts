import { env } from "process";
import vscode from "vscode";
import { instance } from "../instantiate";
import { ConnectionSuite } from "./connection";
import { ContentSuite } from "./content";
import { DeployToolsSuite } from "./deployTools";
import { ILEErrorSuite } from "./ileErrors";
import { TestSuitesTreeProvider } from "./testCasesTree";
import { ToolsSuite } from "./tools";
import { ActionSuite } from "./action";

const suites: TestSuite[] = [
  ActionSuite,
  ConnectionSuite,
  ContentSuite,
  DeployToolsSuite,
  ToolsSuite,
  ILEErrorSuite
]

export type TestSuite = {
  name: string
  tests: TestCase[]
  before?: () => Promise<void>
  after?: () => Promise<void>
  failure?: string
  status?: "running" | "done"
}

export interface TestCase {
  name: string,
  status?: "running" | "failed" | "pass"
  failure?: string
  test: () => Promise<void>
  duration?: number
}

let testSuitesTreeProvider: TestSuitesTreeProvider;
export function initialise(context: vscode.ExtensionContext) {
  if (env.testing === `true`) {
    vscode.commands.executeCommand(`setContext`, `code-for-ibmi:testing`, true);
    instance.onEvent(`connected`, runTests);
    instance.onEvent(`disconnected`, resetTests);
    testSuitesTreeProvider = new TestSuitesTreeProvider(suites);
    context.subscriptions.push(
      vscode.window.createTreeView("testingView", { treeDataProvider: testSuitesTreeProvider, showCollapseAll: true }),
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
    try {
      suite.status = "running";
      testSuitesTreeProvider.refresh(suite);
      if (suite.before) {
        console.log(`Pre-processing suite ${suite.name}`);
        await suite.before();
      }

      console.log(`Running suite ${suite.name} (${suite.tests.length})`);
      console.log();
      for (const test of suite.tests) {
        await runTest(test);
      }
    }
    catch (error: any) {
      console.log(error);
      suite.failure = `${error.message ? error.message : error}`;
    }
    finally {
      suite.status = "done";
      testSuitesTreeProvider.refresh(suite);
      if (suite.after) {
        console.log();
        console.log(`Post-processing suite ${suite.name}`);
        try {
          await suite.after();
        }
        catch (error: any) {
          console.log(error);
          suite.failure = `${error.message ? error.message : error}`;
        }
      }
      testSuitesTreeProvider.refresh(suite);
    }
  }
}

async function runTest(test: TestCase) {
  console.log(`\tRunning ${test.name}`);
  test.status = "running";
  testSuitesTreeProvider.refresh(test);
  const start = +(new Date());
  try {
    await test.test();
    test.status = "pass";
  }

  catch (error: any) {
    console.log(error);
    test.status = "failed";
    test.failure = `${error.message ? error.message : error}`;
  }
  finally {
    test.duration = +(new Date()) - start;
    testSuitesTreeProvider.refresh(test);
  }
}

function resetTests() {
  suites.flatMap(ts => ts.tests).forEach(tc => {
    tc.status = undefined;
    tc.failure = undefined;
  });
}