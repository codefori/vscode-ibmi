import vscode from "vscode";
import { TestCase, TestSuite } from ".";

export class TestSuitesTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem>{
    private readonly emitter: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter();
    readonly onDidChangeTreeData: vscode.Event<void | vscode.TreeItem | vscode.TreeItem[] | null | undefined> = this.emitter.event;

    constructor(readonly testSuites: TestSuite[]) {

    }

    refresh(element?: TestSuiteItem) {
        this.emitter.fire(element);
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element;
    }

    getChildren(element?: TestSuiteItem): vscode.ProviderResult<vscode.TreeItem[]> {
        if (element) {
            return element.getChilren();
        }
        else {
            return this.testSuites.sort((ts1, ts2) => ts1.name.localeCompare(ts2.name)).map(ts => new TestSuiteItem(ts));
        }
    }
}

class TestSuiteItem extends vscode.TreeItem {
    constructor(readonly testSuite: TestSuite) {
        super(testSuite.name, vscode.TreeItemCollapsibleState.Expanded);
        this.description = `${this.testSuite.tests.filter(tc => tc.status === "pass").length}/${this.testSuite.tests.length}`;
        let color;
        if (this.testSuite.tests.some(tc => tc.status === "failed")) {
            color = "testing.iconFailed";
        }
        else if (this.testSuite.tests.some(tc => !tc.status)) {
            color = "testing.iconQueued";
        }
        else {
            color = "testing.iconPassed";
        }
        this.iconPath = new vscode.ThemeIcon("beaker", new vscode.ThemeColor(color));
    }

    getChilren() {
        return this.testSuite.tests.map(tc => new TestCaseItem(tc));
    }
}

class TestCaseItem extends vscode.TreeItem {
    constructor(readonly testCase: TestCase) {
        super(testCase.name, vscode.TreeItemCollapsibleState.None);
        let icon;
        let color;
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
        this.iconPath = new vscode.ThemeIcon(icon, new vscode.ThemeColor(color));
        this.tooltip = testCase.failure;
    }
}