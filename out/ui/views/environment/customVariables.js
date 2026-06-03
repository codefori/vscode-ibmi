"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CustomVariableItem = exports.CustomVariablesNode = exports.CustomVariables = void 0;
const vscode_1 = __importStar(require("vscode"));
const IBMi_1 = __importDefault(require("../../../api/IBMi"));
const instantiate_1 = require("../../../instantiate");
const Tools_1 = require("../../Tools");
const environmentItem_1 = require("./environmentItem");
var CustomVariables;
(function (CustomVariables) {
    function getAll() {
        return instantiate_1.instance.getConnection()?.getConfig().customVariables || [];
    }
    CustomVariables.getAll = getAll;
    function validateName(name, names) {
        name = sanitizeVariableName(name);
        if (!name) {
            return vscode_1.l10n.t('Name cannot be empty');
        }
        else if (Tools_1.VscodeTools.includesCaseInsensitive(names, name)) {
            return vscode_1.l10n.t("Custom variable {0} already exists", name);
        }
    }
    CustomVariables.validateName = validateName;
    function sanitizeVariableName(name) {
        return name.replace(/ /g, '_').replace(/&/g, '').toUpperCase();
    }
    async function update(targetVariable, options) {
        const config = instantiate_1.instance.getConnection()?.getConfig();
        if (config) {
            targetVariable.name = sanitizeVariableName(targetVariable.name);
            const variables = config.customVariables;
            const index = variables.findIndex(v => v.name === targetVariable.name);
            if (options?.delete) {
                if (index < 0) {
                    throw new Error(vscode_1.l10n.t("Custom variable {0} not found for deletion.", targetVariable.name));
                }
                variables.splice(index, 1);
            }
            else {
                const variable = { name: sanitizeVariableName(options?.newName || targetVariable.name), value: targetVariable.value };
                variables[index < 0 ? variables.length : index] = variable;
            }
            await IBMi_1.default.connectionManager.update(config);
        }
    }
    CustomVariables.update = update;
})(CustomVariables = exports.CustomVariables || (exports.CustomVariables = {}));
class CustomVariablesNode extends environmentItem_1.EnvironmentItem {
    constructor() {
        super(vscode_1.l10n.t("Custom Variables"), { icon: "variable-group", state: vscode_1.default.TreeItemCollapsibleState.Collapsed });
        this.contextValue = `customVariablesNode`;
    }
    getChildren() {
        return CustomVariables.getAll().map(customVariable => new CustomVariableItem(this, customVariable));
    }
}
exports.CustomVariablesNode = CustomVariablesNode;
class CustomVariableItem extends environmentItem_1.EnvironmentItem {
    customVariable;
    constructor(parent, customVariable) {
        super(customVariable.name, { parent, icon: "symbol-variable" });
        this.customVariable = customVariable;
        this.contextValue = `customVariableItem`;
        this.description = customVariable.value;
        this.command = {
            title: "Change value",
            command: "code-for-ibmi.environment.variable.edit",
            arguments: [this.customVariable]
        };
    }
}
exports.CustomVariableItem = CustomVariableItem;
//# sourceMappingURL=customVariables.js.map