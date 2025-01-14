import { env } from "process";
import vscode from "vscode";
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
import { Server } from "../typings";
import { ConfigFileSuite } from "./configFile";

const suites: TestSuite[] = [
  ActionSuite,
  ConfigFileSuite,
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
  notConcurrent?: boolean
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

export interface ConnectionFixture { name: string, user: { [parm: string]: string | number }, commands?: string[] };

// https://www.ibm.com/docs/en/i/7.5?topic=information-language-identifiers-associated-default-ccsids
const TestConnectionFixtures: ConnectionFixture[] = [
  { name: `American`, user: { CCSID: 37, CNTRYID: `US`, LANGID: `ENU` } },
  { name: `American (CCSID *SYSVAL)`, user: { CCSID: '*SYSVAL', CNTRYID: `US`, LANGID: `ENU` } },
  { name: `French`, user: { CCSID: 297, CNTRYID: `FR`, LANGID: `FRA` } },
  { name: `Spanish`, user: { CCSID: 284, CNTRYID: `ES`, LANGID: `ESP` } },
  { name: `Spanish (CCSID *SYSVAL)`, user: { CCSID: '*SYSVAL', CNTRYID: `ES`, LANGID: `ESP` } },
  { name: `Danish`, user: { CCSID: 277, CNTRYID: `DK`, LANGID: `DAN` } }
]

let configuringFixture = false;
let lastChosenFixture: ConnectionFixture;
const testingEnabled = env.base_testing === `true`;
const testSuitesSimultaneously = env.simultaneous === `true`;
const testIndividually = env.individual === `true`;
const testSpecific = env.specific;

let testSuitesTreeProvider: TestSuitesTreeProvider;
export function initialise(context: vscode.ExtensionContext) {
  if (testingEnabled) {
    vscode.commands.executeCommand(`setContext`, `code-for-ibmi:testing`, true);

    if (!testIndividually) {
      instance.subscribe(context, 'connected', 'Run tests', () => configuringFixture ? console.log(`Not running tests as configuring fixture`) : runTests(testSuitesSimultaneously));
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
      vscode.commands.registerCommand(`code-for-ibmi.testing.connectWithFixture`, connectWithFixture),
    );
  }
}

export async function connectWithFixture(server?: Server) {
  if (server) {
    const connectionName = server.name;
    const chosenFixture = await vscode.window.showQuickPick(TestConnectionFixtures.map(f => ({label: f.name, description: Object.values(f.user).join(`, `)})), { title: vscode.l10n.t(`Select connection fixture`) });

    if (chosenFixture) {
      const fixture = TestConnectionFixtures.find(f => f.name === chosenFixture.label);
      if (fixture) {
        configuringFixture = true;
        const error = await setupUserFixture(connectionName, fixture);

        if (error) {
          vscode.window.showErrorMessage(`Failed to setup connection fixture: ${error}`);
        } else {
          lastChosenFixture = fixture;
          vscode.window.showInformationMessage(`Successfully setup connection fixture for ${chosenFixture.label}`);
          vscode.commands.executeCommand(`code-for-ibmi.connectTo`, connectionName, true);
          configuringFixture = false;
        }
      }
    }
  }
}

async function setupUserFixture(connectionName: string, fixture: ConnectionFixture) {
  let error: string | undefined;

  await vscode.commands.executeCommand(`code-for-ibmi.connectTo`, connectionName, true);

  let connection = instance.getConnection();
  if (!connection) {
    configuringFixture = false;
    return `Failed to connect to ${connectionName}`;
  }

  const user = connection.currentUser;
  fixture.user.USRPRF = user.toUpperCase();

  const changeUserCommand = connection.content.toCl(`CHGUSRPRF`, fixture.user);
  const changeResult = await connection.runCommand({ command: changeUserCommand });

  if (changeResult.code > 0) {
    error = changeResult.stderr;
  }

  if (!error && fixture.commands) {
    for (const command of fixture.commands) {
      let commandResult = await connection.runCommand({ command });
      if (commandResult.code > 0) {
        error = commandResult.stderr;
      }
    }
  }

  vscode.commands.executeCommand(`code-for-ibmi.disconnect`);

  return error;
}

async function runTests(simultaneously?: boolean) {
  let nonConcurrentSuites: Function[] = [];
  let concurrentSuites: Function[] = [];

  for (const suite of suites) {
    if (testSpecific) {
      if (!suite.name.toLowerCase().includes(testSpecific.toLowerCase())) {
        continue;
      }
    }

    const runner = async () => testSuiteRunner(suite, true);

    if (suite.notConcurrent) {
      nonConcurrentSuites.push(runner);
    } else {
      concurrentSuites.push(runner);
    }
  }

  if (simultaneously) {
    await Promise.all(concurrentSuites.map(async suite => suite()));
  }

  else {
    for (const suite of concurrentSuites) {
      await suite();
    }
  }

  for (const suite of nonConcurrentSuites) {
    await suite();
  }

  console.log(`All tests completed`);
}

async function testSuiteRunner(suite: TestSuite, withGap?: boolean) {
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
      testSuitesTreeProvider.refresh(suite);

      if (withGap) {
        // Add a little break as to not overload the system
        await new Promise(resolve => setTimeout(resolve, 500));
      }
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
};

async function runTest(test: TestCase) {
  const connection = instance.getConnection();

  if (connection) {
    console.log(`Running ${test.name}`);
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
  } else {
    test.status = undefined;
    test.failure = undefined;
    test.duration = undefined;
  }
}

function resetTests() {
  suites.flatMap(ts => ts.tests).forEach(tc => {
    tc.status = undefined;
    tc.failure = undefined;
  });
}