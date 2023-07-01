import vscode from "vscode";
import { TestCase, TestSuite } from ".";

type TestObject = TestSuite | TestCase;

export class TestSuitesTreeProvider implements vscode.TreeDataProvider<TestObject>{
    private readonly emitter: vscode.EventEmitter<TestObject | undefined | null | void> = new vscode.EventEmitter();
    readonly onDidChangeTreeData: vscode.Event<void | TestObject | TestObject[] | null | undefined> = this.emitter.event;

    constructor(readonly testSuites: TestSuite[]) {

    }

    refresh(element?: TestObject) {
        this.emitter.fire(element);
    }

    getTreeItem(element: TestObject): vscode.TreeItem | Thenable<vscode.TreeItem> {
        if("tests" in element){
            return new TestSuiteItem(element);
        }
        else{
            return new TestCaseItem(this.testSuites.find(ts => ts.tests.includes(element))!, element);
        }
    }

    getChildren(element?: TestObject): vscode.ProviderResult<TestObject[]> {
        if (element && "tests" in element) {
            return element.tests;
        }
        else {
            return this.testSuites.sort((ts1, ts2) => ts1.name.localeCompare(ts2.name));
        }
    }
}

class TestSuiteItem extends vscode.TreeItem {
    constructor(readonly testSuite: TestSuite) {
        super(testSuite.name, vscode.TreeItemCollapsibleState.Expanded);
        this.description = `${this.testSuite.tests.filter(tc => tc.status === "pass").length}/${this.testSuite.tests.length}`;

        let color;
        if (this.testSuite.failure || this.testSuite.tests.some(tc => tc.status === "failed")) {
            color = "testing.iconFailed";
        }
        else if (this.testSuite.tests.some(tc => !tc.status)) {
            color = "testing.iconQueued";
        }
        else {
            color = "testing.iconPassed";
        }
        this.iconPath = new vscode.ThemeIcon(testSuite.status === "running" ? "gear~spin" : "beaker", new vscode.ThemeColor(color));
        this.tooltip = this.testSuite.failure;
    }
}

class TestCaseItem extends vscode.TreeItem {
    constructor(readonly testSuite: TestSuite, readonly testCase: TestCase) {
        super(testCase.name, vscode.TreeItemCollapsibleState.None);
        let icon;
        let color;
        if (!testCase.status && this.testSuite.failure) {
            color = "disabledForeground";
            icon = "circle-slash";
        }
        else {
            switch (testCase.status) {
                case "running":
                    color = "testing.runAction";
                    icon = "gear~spin";
                    break;
                case "failed":
                    color = "testing.iconFailed";
                    icon = "close";
                    break;
                case "pass":
                    color = "testing.iconPassed";
                    icon = "pass";
                    break;
                default:
                    color = "testing.iconQueued";
                    icon = "watch";
            }
        }
        this.iconPath = new vscode.ThemeIcon(icon, new vscode.ThemeColor(color));

        if (testCase.duration) {
            this.tooltip = `Duration: ${testCase.duration} millisecond(s)`;
        }

        if (testCase.failure) {
            this.tooltip = new vscode.MarkdownString(['```', testCase.failure, '```'].join(`\n`));
        }

        if (testCase.status !== `running`) {
            this.command = {
                command: `code-for-ibmi.testing.specific`,
                arguments: [this.testSuite.name, testCase.name],
                title: `Re-run test`
            };
        }
    }
}