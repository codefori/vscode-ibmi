import vscode from "vscode";
import { TestCase, TestSuite } from ".";
import { CoverageCollection, CoverageCollector } from "./coverage";

class CoolTreeItem extends vscode.TreeItem {
    constructor(readonly label: string, readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None) {
        super(label, collapsibleState);
    }

    getChildren?(): Thenable<CoolTreeItem[]>;
}

export class TestSuitesTreeProvider implements vscode.TreeDataProvider<CoolTreeItem>{
    private readonly emitter: vscode.EventEmitter<CoolTreeItem | undefined | null | void> = new vscode.EventEmitter();
    readonly onDidChangeTreeData: vscode.Event<void | CoolTreeItem | CoolTreeItem[] | null | undefined> = this.emitter.event;

    constructor(readonly testSuites: TestSuite[], readonly coverageCollection: CoverageCollection) {}

    refresh(element?: CoolTreeItem|TestSuite) {
        this.emitter.fire();
    }

    getTreeItem(element: CoolTreeItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element;
    }

    getChildren(element?: CoolTreeItem): vscode.ProviderResult<CoolTreeItem[]> {
        if (element && element.getChildren) {
            return element.getChildren();
        } else {
            return [
                new CoverageListItem(this.coverageCollection),
                new TestSuitesItem(this.testSuites)
            ]
        }
    }
}

class CoverageListItem extends CoolTreeItem {
    constructor(readonly coverages: CoverageCollection) {
        super("Coverage", vscode.TreeItemCollapsibleState.Expanded);
    }

    async getChildren() {
        return this.coverages.get().map(collector => new CoverageCollectionItem(collector));
    }
}

class CoverageCollectionItem extends CoolTreeItem {
    constructor(readonly collector: CoverageCollector<any>) {
        super(collector.getName(), vscode.TreeItemCollapsibleState.Collapsed);
        const percentage = collector.getPercentCoverage();
        this.description = `${percentage}% covered`;

        if (percentage <= 1) {
            this.iconPath = new vscode.ThemeIcon("circle-slash");
        } else if (percentage < 100) {
            this.iconPath = new vscode.ThemeIcon("warning");
        } else {
            this.iconPath = new vscode.ThemeIcon("pass", new vscode.ThemeColor("testing.iconPassed"));
        }
    }

    async getChildren() {
        const coverage = this.collector.getCoverage();
        return Object.keys(coverage).map(method => new CoverageMethodCountItem(method, coverage[method]));
    }
}

class CoverageMethodCountItem extends CoolTreeItem {
    constructor(readonly method: string, readonly count: number) {
        super(method, vscode.TreeItemCollapsibleState.None);
        this.description = `${count}`;

        if (count > 0) {
            this.iconPath = new vscode.ThemeIcon("pass", new vscode.ThemeColor("testing.iconPassed"));
        } else {
            this.iconPath = new vscode.ThemeIcon("symbol-method");
        }
    }
}

class TestSuitesItem extends CoolTreeItem {
    constructor(readonly testSuites: TestSuite[]) {
        super("Test Suites", vscode.TreeItemCollapsibleState.Expanded);
    }

    async getChildren() {
        return this.testSuites.map(suite => new TestSuiteItem(suite));
    }
}

class TestSuiteItem extends CoolTreeItem {
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

    async getChildren() {
        return this.testSuite.tests.map(tc => new TestCaseItem(this.testSuite, tc));
    }
}

class TestCaseItem extends CoolTreeItem {
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