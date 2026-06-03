"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectWithFixture = exports.initialise = void 0;
const process_1 = require("process");
const vscode_1 = __importDefault(require("vscode"));
const instantiate_1 = require("../instantiate");
const action_1 = require("./action");
const content_1 = require("./content");
const deployTools_1 = require("./deployTools");
const encoding_1 = require("./encoding");
const storage_1 = require("./storage");
const testCasesTree_1 = require("./testCasesTree");
const tools_1 = require("./tools");
const search_1 = require("./search");
const suites = [
    action_1.ActionSuite,
    content_1.ContentSuite,
    deployTools_1.DeployToolsSuite,
    tools_1.ToolsSuite,
    storage_1.StorageSuite,
    encoding_1.EncodingSuite,
    search_1.SearchSuite
];
;
// https://www.ibm.com/docs/en/i/7.5?topic=information-language-identifiers-associated-default-ccsids
const TestConnectionFixtures = [
    { name: `American`, user: { CCSID: 37, CNTRYID: `US`, LANGID: `ENU` } },
    { name: `American (CCSID *SYSVAL)`, user: { CCSID: '*SYSVAL', CNTRYID: `US`, LANGID: `ENU` } },
    { name: `French`, user: { CCSID: 297, CNTRYID: `FR`, LANGID: `FRA` } },
    { name: `Spanish`, user: { CCSID: 284, CNTRYID: `ES`, LANGID: `ESP` } },
    { name: `Spanish (CCSID *SYSVAL)`, user: { CCSID: '*SYSVAL', CNTRYID: `ES`, LANGID: `ESP` } },
    { name: `Danish`, user: { CCSID: 277, CNTRYID: `DK`, LANGID: `DAN` } }
];
let configuringFixture = false;
let lastChosenFixture;
const testingEnabled = process_1.env.base_testing === `true`;
const testSuitesSimultaneously = process_1.env.simultaneous === `true`;
const testIndividually = process_1.env.individual === `true`;
const testSpecific = process_1.env.specific;
let testSuitesTreeProvider;
function initialise(context) {
    if (testingEnabled) {
        vscode_1.default.commands.executeCommand(`setContext`, `code-for-ibmi:testing`, true);
        if (!testIndividually) {
            instantiate_1.instance.subscribe(context, 'connected', 'Run tests', () => configuringFixture ? console.log(`Not running tests as configuring fixture`) : runTests(testSuitesSimultaneously));
        }
        instantiate_1.instance.subscribe(context, 'disconnected', 'Reset tests', resetTests);
        testSuitesTreeProvider = new testCasesTree_1.TestSuitesTreeProvider(suites);
        context.subscriptions.push(vscode_1.default.window.createTreeView("testingView", { treeDataProvider: testSuitesTreeProvider, showCollapseAll: true }), vscode_1.default.commands.registerCommand(`code-for-ibmi.testing.specific`, (suiteName, testName) => {
            if (suiteName && testName) {
                const suite = suites.find(suite => suite.name === suiteName);
                if (suite) {
                    const testCase = suite.tests.find(testCase => testCase.name === testName);
                    if (testCase) {
                        if (suite.before) {
                            suite.before().then(() => runTest(testCase));
                        }
                        else {
                            runTest(testCase);
                        }
                    }
                }
            }
        }), vscode_1.default.commands.registerCommand(`code-for-ibmi.testing.connectWithFixture`, connectWithFixture));
    }
}
exports.initialise = initialise;
async function connectWithFixture(server) {
    if (server) {
        const connectionName = server.name;
        const chosenFixture = await vscode_1.default.window.showQuickPick(TestConnectionFixtures.map(f => ({ label: f.name, description: Object.values(f.user).join(`, `) })), { title: vscode_1.default.l10n.t(`Select connection fixture`) });
        if (chosenFixture) {
            const fixture = TestConnectionFixtures.find(f => f.name === chosenFixture.label);
            if (fixture) {
                configuringFixture = true;
                const error = await setupUserFixture(connectionName, fixture);
                if (error) {
                    vscode_1.default.window.showErrorMessage(`Failed to setup connection fixture: ${error}`);
                }
                else {
                    lastChosenFixture = fixture;
                    vscode_1.default.window.showInformationMessage(`Successfully setup connection fixture for ${chosenFixture.label}`);
                    vscode_1.default.commands.executeCommand(`code-for-ibmi.connectTo`, connectionName, true);
                    configuringFixture = false;
                }
            }
        }
    }
}
exports.connectWithFixture = connectWithFixture;
async function setupUserFixture(connectionName, fixture) {
    let error;
    await vscode_1.default.commands.executeCommand(`code-for-ibmi.connectTo`, connectionName, true);
    let connection = instantiate_1.instance.getConnection();
    if (!connection) {
        configuringFixture = false;
        return `Failed to connect to ${connectionName}`;
    }
    const user = connection.currentUser;
    fixture.user.USRPRF = user.toUpperCase();
    const changeUserCommand = connection.getContent().toCl(`CHGUSRPRF`, fixture.user);
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
    vscode_1.default.commands.executeCommand(`code-for-ibmi.disconnect`);
    return error;
}
async function runTests(simultaneously) {
    let nonConcurrentSuites = [];
    let concurrentSuites = [];
    for (const suite of suites) {
        if (testSpecific) {
            if (!suite.name.toLowerCase().includes(testSpecific.toLowerCase())) {
                continue;
            }
        }
        const runner = async () => testSuiteRunner(suite, true);
        if (suite.notConcurrent) {
            nonConcurrentSuites.push(runner);
        }
        else {
            concurrentSuites.push(runner);
        }
    }
    if (simultaneously) {
        await Promise.all(concurrentSuites.map(async (suite) => suite()));
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
async function testSuiteRunner(suite, withGap) {
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
    catch (error) {
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
            catch (error) {
                console.log(error);
                suite.failure = `${error.message ? error.message : error}`;
            }
        }
        testSuitesTreeProvider.refresh(suite);
    }
}
;
async function runTest(test) {
    const connection = instantiate_1.instance.getConnection();
    if (connection) {
        console.log(`Running ${test.name}`);
        test.status = "running";
        testSuitesTreeProvider.refresh(test);
        const start = +(new Date());
        try {
            await test.test();
            test.status = "pass";
        }
        catch (error) {
            console.log(error);
            test.status = "failed";
            test.failure = `${error.message ? error.message : error}`;
        }
        finally {
            test.duration = +(new Date()) - start;
            testSuitesTreeProvider.refresh(test);
        }
    }
    else {
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
//# sourceMappingURL=index.js.map