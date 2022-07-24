const vscode = require(`vscode`);

const {CustomUI, Field} = require(`../../api/CustomUI`);

let instance = require(`../../Instance`);

module.exports = class FiltersUI {

  /**
   * @param {string} name
   */
  static async init(name) {
    const config = instance.getConfig();
    const objectFilters = config.objectFilters;

    let existingConfigIndex;
    let filter;

    if (name) {
      // If a name is provided, then find the existing filter
      existingConfigIndex = objectFilters.findIndex(filter => filter.name === name);

      if (existingConfigIndex >= 0) {
        filter = objectFilters[existingConfigIndex];
      } else {
        vscode.window.showErrorMessage(`Filter ${name} not found`);
        return;
      }

    } else {
      // Otherwise, set the default values
      filter = {
        name: `Filter ${objectFilters.length + 1}`,
        library: `QGPL`,
        object: `*`,
        types: [`*SRCPF`],
        member: `*`,
      }
    }
    
    let ui = new CustomUI();
    let field;

    field = new Field(`input`, `name`, `Filter name`);
    field.default = filter.name;
    field.description = `The filter name should be unique.`
    ui.addField(field);

    field = new Field(`input`, `library`, `Library`);
    field.default = filter.library;
    field.description = `Library name. Cannot be generic name with an asterisk.`
    ui.addField(field);

    field = new Field(`input`, `object`, `Object`);
    field.default = filter.object;
    field.description = `Object name. Can be generic name with an asterisk. For example: <code>*</code>, or <code>Q*</code>.`;
    ui.addField(field);

    field = new Field(`input`, `types`, `Object type filter`);
    field.default = filter.types.join(`, `);
    field.description = `A comma delimited list of object types. For example <code>*ALL</code>, or <code>*PGM, *SRVPGM</code>. <code>*SRCPF</code> is a special type which will return only source files.`;
    ui.addField(field);

    field = new Field(`input`, `member`, `Member`);
    field.default = filter.member;
    field.description = `Member name. Can be multi-generic value. Examples: <code>*CL</code> or <code>CL*ABC*</code>. A single <code>*</code> will return all members.`;
    ui.addField(field);

    field = new Field(`input`, `memberType`, `Member type`);
    field.default = filter.memberType || `*`;
    field.description = `Member type. Can be multi-generic value. Examples: <code>RPG*</code> or <code>SQL*LE</code>. A single <code>*</code> will return all member types.`;
    ui.addField(field);

    field = new Field(`submit`, `save`, `Save settings`);
    ui.addField(field);

    let {panel, data} = await ui.loadPage(`Filter: ${name || `New`}`);

    if (data) {
      panel.dispose();

      for (const key in data) {

        //In case we need to play with the data
        switch (key) {
        case `name`:
          data[key] = data[key].trim();
          break;
        case `types`:
          data[key] = data[key].split(`,`).map(item => item.trim().toUpperCase()).filter(item => item !== ``);
          break;
        default:
          data[key] = data[key].toUpperCase();
          break;
        }
      }

      if (name) {
        if (existingConfigIndex >= 0) {
          filter = {
            ...filter,
            ...data,
          };

          objectFilters[existingConfigIndex] = filter;
          await config.set(`objectFilters`, objectFilters);
        }
      } else {
        existingConfigIndex = objectFilters.findIndex(cFilter => cFilter.name === data.name);

        if (existingConfigIndex >= 0) {
          data.name = `${data.name.trim()} (2)`;
        }

        objectFilters.push(data);
        await config.set(`objectFilters`, objectFilters);
      }
    }


  }

}