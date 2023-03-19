const vscode = require(`vscode`);

const { CustomUI, Section } = require(`../../api/CustomUI`);

const { GlobalConfiguration, ConnectionConfiguration } = require(`../../api/Configuration`);
let { instance } = require(`../../instantiate`);

const ENCODINGS = [`37`, `256`, `273`, `277`, `278`, `280`, `284`, `285`, `297`, `500`, `871`, `870`, `905`, `880`, `420`, `875`, `424`, `1026`, `290`, `win37`, `win256`, `win273`, `win277`, `win278`, `win280`, `win284`, `win285`, `win297`, `win500`, `win871`, `win870`, `win905`, `win880`, `win420`, `win875`, `win424`, `win1026`];

const TERMINAL_TYPES = [
  { key: `IBM-3179-2`, text: `IBM-3179-2 (24x80 monochrome)` },
  { key: `IBM-3180-2`, text: `IBM-3180-2 (27x132 monochrome)` },
  { key: `IBM-3196-A1`, text: `IBM-3196-A1 (24x80 monochrome)` },
  { key: `IBM-3477-FC`, text: `IBM-3477-FC (27x132 color)` },
  { key: `IBM-3477-FG`, text: `IBM-3477-FG (27x132 monochrome)` },
  { key: `IBM-5251-11`, text: `IBM-5251-11 (24x80 monochrome)` },
  { key: `IBM-5291-1`, text: `IBM-5291-1 (24x80 monochrome)` },
  { key: `IBM-5292-2`, text: `IBM-5292-2 (24x80 color)` },
];

module.exports = class SettingsUI {

  /**
   * Called to log in to an IBM i
   * @param {vscode.ExtensionContext} context
   */
  static init(context) {

    context.subscriptions.push(
      vscode.commands.registerCommand(`code-for-ibmi.showAdditionalSettings`, async (/** @type {Server} */ server) => {
        const connectionSettings = GlobalConfiguration.get(`connectionSettings`);
        const connection = instance.getConnection();

        let name;
        let existingConfigIndex;
        /** @type {ConnectionConfiguration.Parameters} */
        let config;

        if (server) {
          name = server.name;
          existingConfigIndex = connectionSettings.findIndex(connection => connection.name === name);

          if (existingConfigIndex >= 0) {
            config = connectionSettings[existingConfigIndex];
          } else {
            vscode.window.showErrorMessage(`Connection ${name} not found`);
            return;
          }

        } else {
          if (connection) {
            config = instance.getConfig();
            name = config.name;
          } else {
            vscode.window.showErrorMessage(`No connection is active.`);
            return;
          }
        }

        const restartFields = [`enableSQL`, `showDescInLibList`, `enableSourceDates`, `sourceDateMode`, `tempDir`];
        let restart = false;

        const featuresTab = new Section();
        featuresTab
          .addCheckbox(`enableSQL`, `Enable SQL`, `Must be enabled to make the use of SQL and is enabled by default. If you find SQL isn't working for some reason, disable this. If your QCCSID is 65535, it is recommend SQL is disabled. When disabled, will use import files where possible.`, config.enableSQL)
          .addCheckbox(`showDescInLibList`, `Show description of libraries in User Library List view`, `When enabled, library text and attribute will be shown in User Library List. It is recommended to also enable SQL for this.`, config.showDescInLibList)
          .addCheckbox(`autoConvertIFSccsid`, `Support EBCDIC streamfiles`, `Enable converting EBCDIC to UTF-8 when opening streamfiles. When disabled, assumes all streamfiles are in UTF8. When enabled, will open streamfiles regardless of encoding. May slow down open and save operations.<br><br>You can find supported CCSIDs with <code>/usr/bin/iconv -l</code>`, config.autoConvertIFSccsid)
          .addInput(`hideCompileErrors`, `Errors to ignore`, `A comma delimited list of errors to be hidden from the result of an Action in the EVFEVENT file. Useful for codes like <code>RNF5409</code>.`, { default: config.hideCompileErrors.join(`, `) })
          .addCheckbox(`autoSaveBeforeAction`, `Auto Save for Actions`, `When current editor has unsaved changes, automatically save it before running an action.`, config.autoSaveBeforeAction)

        const tempDataTab = new Section();
        tempDataTab
          .addInput(`tempLibrary`, `Temporary library`, `Temporary library. Cannot be QTEMP.`, { default: config.tempLibrary })
          .addInput(`tempDir`, `Temporary IFS directory`, `Directory that will be used to write temporary files to. User must be authorized to create new files in this directory.`, { default: config.tempDir })
          .addCheckbox(`autoClearTempData`, `Clear temporary data automatically`, `Automatically clear temporary data in the chosen temporary library when it's done with and on startup. Deletes all <code>*FILE</code> objects that start with <code>O_</code> in the chosen temporary library.`, config.autoClearTempData)
          .addCheckbox(`autoSortIFSShortcuts`, `Sort IFS shortcuts automatically`, `Automatically sort the shortcuts in IFS browser when shortcut is added or removed.`, config.autoSortIFSShortcuts);
        
        const sourceTab = new Section();
        sourceTab
          .addInput(`sourceASP`, `Source ASP`, `If source files live within a specific ASP, please specify it here. Leave blank otherwise. You can ignore this if you have access to <code>QSYS2.ASP_INFO</code> as Code for IBM i will fetch ASP information automatically.`, { default: config.sourceASP })
          .addInput(`sourceFileCCSID`, `Source file CCSID`, `The CCSID of source files on your system. You should only change this setting from <code>*FILE</code> if you have a source file that is 65535 - otherwise use <code>*FILE</code>. Note that this config is used to fetch all members. If you have any source files using 65535, you have bigger problems.`, { default: config.sourceFileCCSID })
          .addCheckbox(`enableSourceDates`, `Enable Source Dates`, `When enabled, source dates will be retained and updated when editing source members. Requires restart when changed.`, config.enableSourceDates)
          .addSelect(`sourceDateMode`, `Source date tracking mode`, [
            {
              selected: config.sourceDateMode === `edit`,
              value: `edit`,
              description: `Edit mode`,
              text: `Tracks changes in a simple manner. When a line is changed, the date is updated. (Default)`,
            },
            {
              selected: config.sourceDateMode === `diff`,
              value: `diff`,
              description: `Diff mode`,
              text: `Track changes using the diff mechanism. Before the document is saved, it is compared to the original state to determine the changed lines. (Test enhancement)`,
            },
          ], `Determine which method should be used to track changes while editing source members.`)
          .addCheckbox(`sourceDateGutter`, `Source Dates in Gutter`, `When enabled, source dates will be displayed in the gutter.`, config.sourceDateGutter)
          .addCheckbox(`readOnlyMode`, `Read only mode`, `When enabled, saving will be disabled for source members and IFS files.`, config.readOnlyMode);

        /** @type {Section} */
        let terminalsTab;

        if (connection && connection.remoteFeatures.tn5250) {
          terminalsTab = new Section();  
          terminalsTab
            .addSelect(`encodingFor5250`, `5250 encoding`, [{
              selected: config.encodingFor5250 === `default`,
              value: `default`,
              description: `Default`,
              text: `Default`,
            }, ...ENCODINGS.map(encoding => ({
              selected: config.encodingFor5250 === encoding,
              value: encoding,
              description: encoding,
              text: encoding,
            }))], `The encoding for the 5250 emulator.`)
            .addSelect(`terminalFor5250`, `5250 Terminal Type`, [
              {
                selected: config.terminalFor5250 === `default`,
                value: `default`,
                description: `Default`,
                text: `Default`,
              },
              ...TERMINAL_TYPES.map(terminal => ({
                selected: config.terminalFor5250 === terminal.key,
                value: terminal.key,
                description: terminal.key,
                text: terminal.text,
              }))
            ], `The terminal type for the 5250 emulator.`)
            .addCheckbox(`setDeviceNameFor5250`, `Set Device Name for 5250`, `When enabled, the user will be able to enter a device name before the terminal starts.`, config.setDeviceNameFor5250)
            .addInput(`connectringStringFor5250`, `Connection string for 5250`, `Default is <code>localhost</code>. A common SSL string is <code>ssl:localhost 992</code>`, { default: config.connectringStringFor5250 });
        }

        /** @type {Section} */
        let debuggerTab;
        if (connection && connection.remoteFeatures[`startDebugService.sh`]) {
          debuggerTab = new Section();
          debuggerTab
            .addInput(`debugPort`, `Debug port`, `Default secure port is <code>8005</code>. Tells the client which port the debug service is running on.`, {default : config.debugPort})
            .addCheckbox(`debugUpdateProductionFiles`, `Update production files`, `Determines whether the job being debugged can update objects in production (<code>*PROD</code>) libraries.`, config.debugUpdateProductionFiles)
            .addCheckbox(`debugEnableDebugTracing`, `Debug trace`, `Tells the debug service to send more data to the client. Only useful for debugging issues in the service. Not recommended for general debugging.`, config.debugEnableDebugTracing)
            .addCheckbox(`debugIsSecure`, `Debug securely`, `Tells the debug service to authenticate by server and client certificates. Ensure that the client certificate is imported when enabled.`, config.debugIsSecure)
        }

        let tabs = [
          {label: `Features`, fields: featuresTab.fields},
          {label: `Source Code`, fields: sourceTab.fields},
          terminalsTab ? {label: `Terminals`, fields: terminalsTab.fields} : undefined,
          debuggerTab ? {label: `Debugger`, fields: debuggerTab.fields} : undefined,
          {label: `Temporary Data`, fields: tempDataTab.fields},
        ].filter(tab => tab !== undefined);

        const ui = new CustomUI();

        ui.addComplexTabs(tabs)
          .addHorizontalRule()
          .addButtons({ id: `save`, label:`Save settings` });

        const page = await ui.loadPage(`Settings: ${name}`);
        if (page && page.data) {
          page.panel.dispose();

          const data = page.data;
          for (const key in data) {

            //In case we need to play with the data
            switch (key) {
            case `sourceASP`:
              if (data[key].trim() === ``) data[key] = null;
              break;
            case `hideCompileErrors`:
              data[key] = data[key].split(`,`).map(item => item.trim().toUpperCase()).filter(item => item !== ``);
              break;
            }

            //Refresh connection browser if not connected
            if(!instance.getConnection()){
              vscode.commands.executeCommand(`code-for-ibmi.refreshConnections`);
            }
          }

          if (server) {
            if (existingConfigIndex >= 0) {
              config = {
                ...config,
                ...data,
              };

              connectionSettings[existingConfigIndex] = config;
              await GlobalConfiguration.set(`connectionSettings`, connectionSettings);
            }
          } else {
            if (connection) {
              if (restartFields.some(item => data[item] !== config[item])) {
                restart = true;
              }

              Object.assign(config, data);
              await ConnectionConfiguration.update(config);
            }
          }

          if (restart) {
            vscode.window.showInformationMessage(`Some settings require a restart to take effect. Reload workspace now?`, `Reload`, `No`)
              .then(async (value) => {
                if (value === `Reload`) {
                  await vscode.commands.executeCommand(`workbench.action.reloadWindow`);
                }
              });
          }
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.showLoginSettings`, async (/** @type {Server} */ server) => {
        if (server) {
          const connections = GlobalConfiguration.get(`connections`);
          const name = server.name;

          const connectionIdx = connections.findIndex(item => item.name === name);
          let connection = connections[connectionIdx];

          const page = await new CustomUI()
            .addInput(`host`, `Host or IP Address`, null, { default: connection.host })
            .addInput(`port`, `Port (SSH)`, null, { default: String(connection.port) })
            .addInput(`username`, `Username`, null, { default: connection.username })
            .addParagraph(`Only provide either the password or a private key - not both.`)
            .addPassword(`password`, `Password`, `Only provide a password if you want to update an existing one or set a new one.`)
            .addFile(`privateKey`, `Private Key${connection.privateKey ? ` (current: ${connection.privateKey})` : ``}`, `Only provide a private key if you want to update from the existing one or set one.`)
            .addButtons({id: `submitButton`, label:`Save`})
            .loadPage(`Login Settings: ${name}`);
            
          if (page && page.data) {
            page.panel.dispose();

            const data = page.data;
            data.port = Number(data.port);
            if (data.privateKey === ``) data.privateKey = connection.privateKey;

            if (data.password && !data.privateKey) {
              context.secrets.delete(`${name}_password`);
              context.secrets.store(`${name}_password`, `${data.password}`);
              data.privateKey = ``;
            };

            delete data.password;

            connection = {
              ...connection,
              ...data
            };

            connections[connectionIdx] = connection;
            await GlobalConfiguration.set(`connections`, connections);            
          }
        }
      })
    )


  }

}