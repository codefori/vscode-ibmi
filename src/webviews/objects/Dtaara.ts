import vscode from "vscode";
import { CustomUI, Field } from "../../api/CustomUI";

import { instance } from "../../Instance";

export async function editDataArea(object: IBMiObject) {
    const connection = instance.getConnection();
    const content = instance.getContent();
    if (connection && content) {
        const library = object.library.toUpperCase();
        const name = object.name.toUpperCase();
        const [dtaara] = await content.runSQL(
            `Select DATA_AREA_TYPE, LENGTH, DECIMAL_POSITIONS, DATA_AREA_VALUE
            From QSYS2.DATA_AREA_INFO
            Where DATA_AREA_LIBRARY = '${library}' And DATA_AREA_NAME = '${name}'
            Fetch first row only`
        );

        const currentValue = dtaara.DATA_AREA_VALUE?.toString();
        const type = dtaara.DATA_AREA_TYPE!.toString();
        const length = Number(dtaara.LENGTH!);
        const decimalPosition = Number(dtaara.DECIMAL_POSITIONS || 0);

        const ui = new CustomUI(vscode.ViewColumn.One);

        ui.addField(new Field("paragraph", "",
            `<b>Type: </b>${type}<br />
        ${type !== "*LGL" ? `<b>Length: </b>${length}<br />` : ''}
         ${type === "*DEC" ? `<b>Decimal position: </b>${decimalPosition}<br />` : ''}
        `));
        ui.addField(new Field("hr"));

        let valueField;
        switch (type) {
            case `*LGL`:
                valueField = new Field(`checkbox`, `value`, `Logical value`);
                valueField.default = (currentValue === `1` ? `checked` : ``);
                break;

            case `*DEC`:
                valueField = new Field(`number`, `value`, `Decimal value`);
                valueField.max = (Math.pow(10, length) - 1) / (decimalPosition ? Math.pow(10, decimalPosition) : 1);
                valueField.min = valueField.max * -1;
                valueField.default = currentValue || "0";
                break;

            default:
                valueField = new Field(`input`, `value`, `Character value`);
                valueField.multiline = true;
                valueField.default = currentValue || ``;
                valueField.maxLength = Number(length);
        }
        ui.addField(valueField);

        const buttons = new Field(`buttons`);
        buttons.items = [
            {
                id: `update`,
                label: `Update`,
            }
        ];
        ui.addField(buttons);

        const { panel, data } = await ui.loadPage(`Data area: ${library}/${name}`);
        if (data) {
            panel.dispose();
            let value : string | number | boolean;
            try {
                switch (type) {
                    case `*DEC`:
                        value = Number(data.value);
                        break;

                    case `*LGL`:
                        value = `'${data.value ? '1' : '0'}'`;
                        break;

                    default:
                        value = `'${data.value}'`.replace(/\s/g, " ");
                }
                await connection.remoteCommand(`CHGDTAARA DTAARA(${library}/${name}) VALUE(${value})`);
            }
            catch (e) {
                vscode.window.showErrorMessage(`${e}`);
            }
        }
    } else {
        vscode.window.showErrorMessage(`Please connect to an IBM i.`);
    }
}