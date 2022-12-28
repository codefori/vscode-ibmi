const vscode = require(`vscode`);
const {ConnectionConfiguration} = require(`../../api/Configuration`);
const {CustomUI, Field} = require(`../../api/CustomUI`);

let {instance} = require(`../../instantiate`);

module.exports = class FiltersUI {

  /**
   * @param {string} name
   */
  static async init(name, copy = false) {
    /** @type {ConnectionConfiguration.Parameters} */
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

      if (copy) {
        filter = {
          name: `${name} - copy`,
          library: filter.library,
          object: filter.object,
          types: [...filter.types],
          member: filter.member,
        }
        existingConfigIndex = -1;
        name = ``;
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
    
    const ui = new CustomUI();
    ui.addInput(`name`, `Filter name`, `The filter name should be unique.`, {default: filter.name});
    ui.addInput(`library`, `Library`, `Library name. Cannot be generic name with an asterisk.`, {default: filter.library});
    ui.addInput(`object`, `Object`, `Object name. Can be generic name with an asterisk. For example: <code>*</code>, or <code>Q*</code>.`, {default: filter.object});
    ui.addInput(`types`, `Object type filter`, `A comma delimited list of object types. For example <code>*ALL</code>, or <code>*PGM, *SRVPGM</code>. <code>*SRCPF</code> is a special type which will return only source files.`, {default: filter.types.join(`, `)});
    ui.addInput(`member`, `Member`, `Member name. Can be multi-generic value. Examples: <code>*CL</code> or <code>CL*ABC*</code>. A single <code>*</code> will return all members.`, {default: filter.member});
    ui.addInput(`memberType`, `Member type`, `Member type. Can be multi-generic value. Examples: <code>RPG*</code> or <code>SQL*LE</code>. A single <code>*</code> will return all member types.`, {default: filter.memberType || `*`});
    ui.addField(new Field(`submit`, `save`, `Save settings`));

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
        }
      } else {
        existingConfigIndex = objectFilters.findIndex(cFilter => cFilter.name === data.name);

        if (existingConfigIndex >= 0) {
          data.name = `${data.name.trim()} (2)`;
        }

        objectFilters.push(data);        
      }

      config.objectFilters = objectFilters;
      await ConnectionConfiguration.update(config);
    }


  }

}