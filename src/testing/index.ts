import { env } from "process";
import vscode from "vscode";
import { instance } from "../instantiate";
import { ActionSuite } from "./suites/action";
import { ComponentSuite } from "./suites/components";
import { ConnectionSuite } from "./suites/connection";
import { ContentSuite } from "./suites/content";
import { DeployToolsSuite } from "./suites/deployTools";
import { EncodingSuite } from "./suites/encoding";
import { FilterSuite } from "./suites/filter";
import { ILEErrorSuite } from "./suites/ileErrors";
import { SearchSuite } from "./suites/search";
import { StorageSuite } from "./suites/storage";
import { TestSuitesTreeProvider } from "./testCasesTree";
import { ToolsSuite } from "./suites/tools";
import { formatLog, parseOutput } from "./outputTools";

const suites: TestSuite[] = [
  ActionSuite,
  ConnectionSuite,
  ContentSuite,
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
      }),
      vscode.commands.registerCommand(`code-for-ibmi.testing.parseOutput`, async () => {
        const input = await vscode.env.clipboard.readText();

        const logs = parseOutput(input);

        const newDoc = logs.map(log => formatLog(log)).join(`\n\n`);

        const doc = await vscode.workspace.openTextDocument({ content: newDoc, language: `plaintext` });
        await vscode.window.showTextDocument(doc);
      }),
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