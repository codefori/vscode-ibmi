"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TestSuitesTreeProvider = void 0;
const vscode_1 = __importDefault(require("vscode"));
class TestSuitesTreeProvider {
    testSuites;
    emitter = new vscode_1.default.EventEmitter();
    onDidChangeTreeData = this.emitter.event;
    constructor(testSuites) {
        this.testSuites = testSuites;
    }
    refresh(element) {
        this.emitter.fire(element);
    }
    getTreeItem(element) {
        if ("tests" in element) {
            return new TestSuiteItem(element);
        }
        else {
            return new TestCaseItem(this.testSuites.find(ts => ts.tests.includes(element)), element);
        }
    }
    getChildren(element) {
        if (element && "tests" in element) {
            return element.tests;
        }
        else {
            return this.testSuites.sort((ts1, ts2) => ts1.name.localeCompare(ts2.name));
        }
    }
}
exports.TestSuitesTreeProvider = TestSuitesTreeProvider;
class TestSuiteItem extends vscode_1.default.TreeItem {
    testSuite;
    constructor(testSuite) {
        super(testSuite.name, vscode_1.default.TreeItemCollapsibleState.Expanded);
        this.testSuite = testSuite;
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
        this.iconPath = new vscode_1.default.ThemeIcon(testSuite.status === "running" ? "gear~spin" : "beaker", new vscode_1.default.ThemeColor(color));
        this.tooltip = this.testSuite.failure;
    }
}
class TestCaseItem extends vscode_1.default.TreeItem {
    testSuite;
    testCase;
    constructor(testSuite, testCase) {
        super(testCase.name, vscode_1.default.TreeItemCollapsibleState.None);
        this.testSuite = testSuite;
        this.testCase = testCase;
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
        this.iconPath = new vscode_1.default.ThemeIcon(icon, new vscode_1.default.ThemeColor(color));
        if (testCase.duration) {
            this.tooltip = `Duration: ${testCase.duration} millisecond(s)`;
        }
        if (testCase.failure) {
            this.tooltip = new vscode_1.default.MarkdownString(['```', testCase.failure, '```'].join(`\n`));
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
//# sourceMappingURL=testCasesTree.js.map