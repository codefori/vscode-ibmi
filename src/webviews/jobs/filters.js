const vscode = require(`vscode`);

const {CustomUI, Field} = require(`../../api/CustomUI`);

let instance = require(`../../Instance`);

module.exports = class JobFiltersUI {

  /**
   * @param {string} name
   */
  static async init(name) {
    const config = instance.getConfig();
    const jobFilters = config.jobFilters;

    let existingConfigIndex;
    let filter;

    if (name) {
      // If a name is provided, then find the existing filter
      existingConfigIndex = jobFilters.findIndex(filter => filter.nameFilter === name);

      if (existingConfigIndex >= 0) {
        filter = jobFilters[existingConfigIndex];
      } else {
        vscode.window.showErrorMessage(`Filter ${name} not found`);
        return;
      }

    } else {

      const globalData = vscode.workspace.getConfiguration(`code-for-ibmi`);
      let connections = globalData.get(`connections`);
      // const index = connections.findIndex(conn => conn.name === this.name);

      // Otherwise, set the default values
      filter = {
        nameFilter: `Job filter ${jobFilters.length + 1}`,
        jobNameFilter: `*`,
        jobUserFilter: `*`,
        jobNumberFilter: `*`,
        profileFilter: `*`,
        subsystemFilter: `*`,
      }
    }

    let ui = new CustomUI();
    let field;

    field = new Field(`input`, `nameFilter`, `Filter name`);
    field.default = filter.nameFilter;
    field.description = `The filter name should be unique.`
    ui.addField(field);

    field = new Field(`input`, `jobNameFilter`, `Job name`);
    field.default = filter.jobNameFilter || `*`;
    field.description = `Specify the name of the job. Can be generic name with an asterisk. For example: <code>*</code>, or <code>Q*</code>.`;
    ui.addField(field);

    field = new Field(`input`, `jobUserFilter`, `Job user`);
    field.default = filter.jobUserFilter || `*`;
    field.description = `Specify the name of the user profile under which the job is started. Can be generic name with an asterisk. For example: <code>*</code>, or <code>Q*</code>.`;
    ui.addField(field);

    field = new Field(`input`, `jobNumberFilter`, `Job number`);
    field.default = filter.jobNumberFilter || `*`;
    field.description = `Specify the job number assigned by the system. Can be an asterisk or a number. For example: <code>*</code>, or <code>123456</code>.`;
    ui.addField(field);

    field = new Field(`input`, `profileFilter`, `Profile`);
    field.default = filter.profileFilter || `*`;
    field.description = `Specify the name of the current user profile under which the job is run. Can be generic name with an asterisk. For example: <code>*</code>, or <code>Q*</code>.`;
    ui.addField(field);

    field = new Field(`input`, `subsystemFilter`, `Subsystem`);
    field.default = filter.subsystemFilter || `*`;
    field.description = `Specify the name of the subsystem where the job is running. Can be generic name with an asterisk. For example: <code>*</code>, or <code>Q*</code>.`;
    ui.addField(field);

    field = new Field(`submit`, `save`, `Save settings`);
    ui.addField(field);

    let {panel, data} = await ui.loadPage(`Filter: ${name || `New`}`);

    if (data) {
      panel.dispose();

      for (const key in data) {

        //In case we need to play with the data
        switch (key) {
        case `nameFilter`:
          data[key] = data[key].trim();
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

          jobFilters[existingConfigIndex] = filter;
          await config.set(`jobFilters`, jobFilters);
        }
      } else {
        existingConfigIndex = jobFilters.findIndex(cFilter => cFilter.nameFilter === data.name);

        if (existingConfigIndex >= 0) {
          data.name = `${data.name.trim()} (2)`;
        }

        jobFilters.push(data);
        await config.set(`jobFilters`, jobFilters);
      }
    }


  }

}