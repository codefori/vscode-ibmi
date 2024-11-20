import { env } from "process";
import vscode, { commands } from "vscode";
import path from "path";
import fs from "fs";
import { instance } from "../instantiate";
import { ActionSuite } from "./action";
import { ComponentSuite } from "./components";
import { ConnectionSuite } from "./connection";
import { ContentSuite } from "./content";
import { DebugSuite } from "./debug";
import { DeployToolsSuite } from "./deployTools";
import { EncodingSuite } from "./encoding";
import { FilterSuite } from "./filter";
import { ILEErrorSuite } from "./ileErrors";
import { SearchSuite } from "./search";
import { StorageSuite } from "./storage";
import { TestSuitesTreeProvider } from "./testCasesTree";
import { ToolsSuite } from "./tools";

const suites: TestSuite[] = [
  ActionSuite,
  ConnectionSuite,
  ContentSuite,
  DebugSuite,
  DeployToolsSuite,
  ToolsSuite,
  ILEErrorSuite,
  FilterSuite,
  SearchSuite,
  StorageSuite,
  EncodingSuite,
  ComponentSuite
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

const testingEnabled = env.testing === `true`;
const testIndividually = env.individual === `true`;
const report_and_exit = env.report_and_exit !== undefined ? env.report_and_exit : undefined;

let testSuitesTreeProvider: TestSuitesTreeProvider;
export function initialise(context: vscode.ExtensionContext) {
  if (testingEnabled) {
    vscode.commands.executeCommand(`setContext`, `code-for-ibmi:testing`, true);

    if (!testIndividually) {
      instance.subscribe(context, 'connected', 'Run tests', runTests);
    }

    instance.subscribe(context, 'disconnected', 'Reset tests', resetTests);
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
  const connection = instance.getConnection()!;

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

  if (report_and_exit) {
    const connectionDetail = {
      system: connection.currentConnectionName,
      user: connection.currentConnectionName,
      ccsids: connection.getCcsids(),
      variants: connection.variantChars
    };

    const contents = {
      connection: connectionDetail,
      suites,
    }
    fs.writeFileSync(report_and_exit, JSON.stringify(contents));
    console.log(`vscode-ibmi test report written to ${report_and_exit}`);
    commands.executeCommand(`workbench.action.closeWindow`);
  }
}

async function runTest(test: TestCase) {
  const connection = instance.getConnection();

  console.log(`\tRunning ${test.name}`);
  test.status = "running";
  testSuitesTreeProvider.refresh(test);
  const start = +(new Date());
  try {
    connection!.enableSQL = true;

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