import vscode from "vscode";
import { CustomUI, Field } from "../../api/CustomUI";

import { instance } from "../../Instance";

export async function displayCommand(object: IBMiObject) {
    const connection = instance.getConnection();
    const content = instance.getContent();
    if (connection && content) {
        const library = object.library.toUpperCase();
        const name = object.name.toUpperCase();
        try {
            const result = await connection.remoteCommand(`DSPCMD CMD(${library}/${name})`);
            let output;
            if (typeof result === "string") {
                output = result;
            }
            else if ("stdout" in result) {
                output = result.stdout;
            }
            if (output) {
                const parsed = parseOutput(output);
                if (parsed) {
                    parsed.forEach(processDetailValue);

                    const ui = new CustomUI();
                    ui.isForm = false;
                    ui.addField(new Field('custom', "", renderTable(parsed)));
                    ui.loadPage(`Command detail: ${library}/${name}`);
                }
            }
        }
        catch (e) {
            vscode.window.showErrorMessage(`${e}`);
        }
    } else {
        vscode.window.showErrorMessage(`Please connect to an IBM i.`);
    }
}

const DETAIL_REGEX = /^(\s+)([^\.]+)[\. ]*: +([A-Z]+)? +(.*)$/

interface CommandDetail {
    id: string
    label: string
    value: string
}

function parseOutput(output: string): CommandDetail[] {
    const details: CommandDetail[] = [];
    let lines = output.split(/[\r\n]/g);
    lines = lines.slice(4, lines.length - 1);
    let detail;
    for (const line of lines) {
        const result = DETAIL_REGEX.exec(line);

        if (result) {
            const continuation = result[1]?.length > 1;
            const label = result[2]?.trim();
            const id = result[3]?.trim();
            const value = result[4]?.trim();

            if (!continuation && id) {
                detail = {
                    id: id,
                    label: label,
                    value: value
                }
                details.push(detail);
            }
            else if (continuation && detail) {
                detail.value += " " + value;
            }
        }
        else if (detail) {
            detail.value += " " + line.trim();
        }
    }

    //Ugly
    const ccsidLine = lines[lines.length - 2];
    const ccsidLabel = ccsidLine.split(" . . . . .").reverse().pop()?.trim();
    const ccsid = ccsidLine.split(" ").pop()?.trim();
    if (ccsid && !isNaN(Number(ccsid))) {
        details.push({
            id: "CCSID",
            label: ccsidLabel || "Coded character set ID",
            value: ccsid
        });
    }

    return details;
}


/**
 * Process some values if needed, depending on their id
 * @param detail 
 */
function processDetailValue(detail: CommandDetail) {
    const parts = detail.value.split(' ');
    switch (detail.id) {
        case "PGM":
            detail.value = `${parts[1]}/${parts[0]}; State: ${parts[2]}`;
            break;

        case "SRCFILE":
        case "MSGF":
        case "HLPPNLGRP":
        case "HLPPNLGRP":
            detail.value = `${parts[1]}/${parts[0]}`;
            break;

        case "MODE":
        case "ALLOW":
            detail.value = parts.map(p => p.trim()).filter(p => Boolean(p)).join(", ");
            break;
    }
}

function renderTable(details: CommandDetail[]): string {
    return /* html */ `<vscode-table style="height: 100vh" columns='["250px", "100px", "auto"]' zebra bordered resizable>
    <vscode-table-header slot="header">
      <vscode-table-header-cell>Name</vscode-table-header-cell>  
      <vscode-table-header-cell>Property</vscode-table-header-cell>      
      <vscode-table-header-cell>Value</vscode-table-header-cell>
    </vscode-table-header>
    <vscode-table-body slot="body">
      ${details.map(renderRow).join("\n")}      
    </vscode-table-body>
  </vscode-table>`;
}

function renderRow(detail: CommandDetail): string {
    return /* html */ `<vscode-table-row>
      <vscode-table-cell>${detail.label}</vscode-table-cell>  
      <vscode-table-cell>${detail.id}</vscode-table-cell>      
      <vscode-table-cell>${detail.value}</vscode-table-cell>
  </vscode-table-row>`;
}
