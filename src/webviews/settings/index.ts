import vscode from "vscode";
import { ConnectionConfiguration, ConnectionManager, GlobalConfiguration } from "../../api/Configuration";
import { ComplexTab, CustomUI, Section } from "../../api/CustomUI";
import { GlobalStorage } from '../../api/Storage';
import { Tools } from "../../api/Tools";
import { isManaged } from "../../api/debug";
import * as certificates from "../../api/debug/certificates";
import { isSEPSupported } from "../../api/debug/server";
import { instance } from "../../instantiate";
import { t } from "../../locale";
import { ConnectionData, Server } from '../../typings';

const EDITING_CONTEXT = `code-for-ibmi:editingConnection`;

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

type LoginSettings = ConnectionData & {
  buttons?: 'submitButton'
}

export class SettingsUI {
  static init(context: vscode.ExtensionContext) {

    context.subscriptions.push(
      vscode.commands.registerCommand(`code-for-ibmi.showAdditionalSettings`, async (server?: Server, tab?: string) => {
        const connectionSettings = GlobalConfiguration.get<ConnectionConfiguration.Parameters[]>(`connectionSettings`);
        const connection = instance.getConnection();
        const passwordAuthorisedExtensions = instance.getStorage()?.getAuthorisedExtensions() || [];

        let config: ConnectionConfiguration.Parameters;

        if (connectionSettings && server) {
          config = await ConnectionConfiguration.load(server.name);

        } else {
          config = instance.getConfig()!;
          if (connection && config) {
            // Reload config to initialize any new config parameters.
            config = await ConnectionConfiguration.load(config.name);
          } else {
            vscode.window.showErrorMessage(`No connection is active.`);
            return;
          }
        }

        const restartFields = [`showDescInLibList`, `tempDir`, `debugCertDirectory`];
        let restart = false;

        const featuresTab = new Section();
        featuresTab
          .addCheckbox(`quickConnect`, `Quick Connect`, `When enabled, server settings from previous connection will be used, resulting in much quicker connection. If server settings are changed, right-click the connection in Connection Browser and select <code>Connect and Reload Server Settings</code> to refresh the cache.`, config.quickConnect)
          .addCheckbox(`showDescInLibList`, `Show description of libraries in User Library List view`, `When enabled, library text and attribute will be shown in User Library List. It is recommended to also enable SQL for this.`, config.showDescInLibList)
          .addCheckbox(`showHiddenFiles`, `Show hidden files and directories in IFS browser.`, `When disabled, hidden files and directories (i.e. names starting with '.') will not be shown in the IFS browser, except for special config files.`, config.showHiddenFiles)
          .addCheckbox(`autoSortIFSShortcuts`, `Sort IFS shortcuts automatically`, `Automatically sort the shortcuts in IFS browser when shortcut is added or removed.`, config.autoSortIFSShortcuts)
          .addCheckbox(`autoConvertIFSccsid`, `Support EBCDIC streamfiles`, `Enable converting EBCDIC to UTF-8 when opening streamfiles. When disabled, assumes all streamfiles are in UTF8. When enabled, will open streamfiles regardless of encoding. May slow down open and save operations.<br><br>You can find supported CCSIDs with <code>/usr/bin/iconv -l</code>`, config.autoConvertIFSccsid)
          .addHorizontalRule()
          .addCheckbox(`autoSaveBeforeAction`, `Auto Save for Actions`, `When current editor has unsaved changes, automatically save it before running an action.`, config.autoSaveBeforeAction)
          .addInput(`hideCompileErrors`, `Errors to ignore`, `A comma delimited list of errors to be hidden from the result of an Action in the EVFEVENT file. Useful for codes like <code>RNF5409</code>.`, { default: config.hideCompileErrors.join(`, `) })

        const tempDataTab = new Section();
        tempDataTab
          .addInput(`tempLibrary`, `Temporary library`, `Temporary library. Cannot be QTEMP.`, { default: config.tempLibrary, minlength: 1, maxlength: 10 })
          .addInput(`tempDir`, `Temporary IFS directory`, `Directory that will be used to write temporary files to. User must be authorized to create new files in this directory.`, { default: config.tempDir, minlength: 1 })
          .addCheckbox(`autoClearTempData`, `Clear temporary data automatically`, `Automatically clear temporary data in the chosen temporary library when it's done with and on startup. Deletes all <code>*FILE</code> objects that start with <code>O_</code> in the chosen temporary library.`, config.autoClearTempData);

        const sourceTab = new Section();
        sourceTab
          .addInput(`sourceASP`, `Source ASP`, `If source files live within a specific ASP, please specify it here. Leave blank otherwise. You can ignore this if you have access to <code>QSYS2.ASP_INFO</code> as Code for IBM i will fetch ASP information automatically.`, { default: config.sourceASP })
          .addInput(`sourceFileCCSID`, `Source file CCSID`, `The CCSID of source files on your system. You should only change this setting from <code>*FILE</code> if you have a source file that is 65535 - otherwise use <code>*FILE</code>. Note that this config is used to fetch all members. If you have any source files using 65535, you have bigger problems.`, { default: config.sourceFileCCSID, minlength: 1, maxlength: 5 })
          .addHorizontalRule()
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
          .addHorizontalRule()
          .addSelect(`defaultDeploymentMethod`, `Default Deployment Method`, [
            {
              selected: config.defaultDeploymentMethod === undefined || config.defaultDeploymentMethod === ``,
              value: ``,
              description: `No Default`,
              text: `No default Deploy method`,
            },
            {
              selected: config.defaultDeploymentMethod === `compare`,
              value: `compare`,
              description: `Compare`,
              text: `Synchronizes using MD5 hash comparison`,
            },
            {
              selected: config.defaultDeploymentMethod === `changed`,
              value: `changed`,
              description: `Changes`,
              text: `Changes detected since last upload.`,
            },
            {
              selected: config.defaultDeploymentMethod === `unstaged`,
              value: `unstaged`,
              description: `Working Changes`,
              text: `Unstaged changes in Git`,
            },
            {
              selected: config.defaultDeploymentMethod === `staged`,
              value: `staged`,
              description: `Staged Changes`,
              text: `Staged changes in Git`,
            },
            {
              selected: config.defaultDeploymentMethod === `all`,
              value: `all`,
              description: `All`,
              text: `Every file in the local workspace`,
            }
          ], `Set your Default Deployment Method. This is used when deploying from the local workspace to the server.`)
          .addHorizontalRule()
          .addCheckbox(`readOnlyMode`, `Read only mode`, `When enabled, source members and IFS files will always be opened in read-only mode.`, config.readOnlyMode)
          .addInput(`protectedPaths`, `Protected paths`, `A comma separated list of libraries and/or IFS directories whose members will always be opened in read-only mode. (Example: <code>QGPL, /home/QSECOFR, MYLIB, /QIBM</code>)`, { default: config.protectedPaths.join(`, `) });

        const terminalsTab = new Section();
        if (connection && connection.remoteFeatures.tn5250) {
          terminalsTab
            .addSelect(`encodingFor5250`, `5250 encoding`, [{
              selected: config.encodingFor5250 === `default`,
              value: `default`,
              description: `Default`,
              text: `Default`,
            }, ...ENCODINGS.map(encoding => ({
              selected: config!.encodingFor5250 === encoding,
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
                selected: config!.terminalFor5250 === terminal.key,
                value: terminal.key,
                description: terminal.key,
                text: terminal.text,
              }))
            ], `The terminal type for the 5250 emulator.`)
            .addCheckbox(`setDeviceNameFor5250`, `Set Device Name for 5250`, `When enabled, the user will be able to enter a device name before the terminal starts.`, config.setDeviceNameFor5250)
            .addInput(`connectringStringFor5250`, `Connection string for 5250`, `Default is <code>localhost</code>. A common SSL string is <code>ssl:localhost 992</code>`, { default: config.connectringStringFor5250 });
        } else if (connection) {
          terminalsTab.addParagraph('Enable 5250 emulation to change these settings');
        } else {
          terminalsTab.addParagraph('Connect to the server to see these settings.');
        }

        const debuggerTab = new Section();
        if (connection && connection.remoteFeatures[`startDebugService.sh`]) {
          debuggerTab.addParagraph(`The following values have been read from the debug service configuration.`);
          const debugServiceConfig: Map<string, string> = new Map()
            .set("Debug port", config.debugPort);

          if (await isSEPSupported()) {
            debugServiceConfig.set("SEP debug port", config.debugSepPort)
          }
          debuggerTab.addParagraph(`<ul>${Array.from(debugServiceConfig.entries()).map(([label, value]) => `<li><code>${label}</code>: ${value}</li>`).join("")}</ul>`);

          debuggerTab.addCheckbox(`debugUpdateProductionFiles`, `Update production files`, `Determines whether the job being debugged can update objects in production (<code>*PROD</code>) libraries.`, config.debugUpdateProductionFiles)
            .addCheckbox(`debugEnableDebugTracing`, `Debug trace`, `Tells the debug service to send more data to the client. Only useful for debugging issues in the service. Not recommended for general debugging.`, config.debugEnableDebugTracing);

          if (!isManaged()) {
            debuggerTab
              .addHorizontalRule()
              .addCheckbox(`debugIsSecure`, `Debug securely`, `Tells the debug service to authenticate by server and client certificates. Ensure that the client certificate is imported when enabled.`, config.debugIsSecure);
            if (await certificates.remoteCertificatesExists()) {
              let localCertificateIssue;
              try {
                await certificates.checkClientCertificate(connection);
              }
              catch (error) {
                localCertificateIssue = `${String(error)}. Debugging securely will not function correctly.`;
              }
              debuggerTab.addParagraph(`<b>${localCertificateIssue || "Client certificate for service has been imported and matches remote certificate."}</b>`)
                .addParagraph(`To debug securely, Visual Studio Code needs access to a certificate to connect to the Debug Service. Each server can have unique certificates. This client certificate should exist at <code>${certificates.getLocalCertPath(connection)}</code>`);
              if (!localCertificateIssue) {
                debuggerTab.addButtons({ id: `import`, label: `Download client certificate` })
              }
            }
            else {
              debuggerTab.addParagraph(`The service certificate doesn't exist or is incomplete; it must be generated before the debug service can be started.`)
                .addButtons({ id: `generate`, label: `Generate service certificate` })
            }
          }
        } else if (connection) {
          debuggerTab.addParagraph('Enable the debug service to change these settings');
        } else {
          debuggerTab.addParagraph('Connect to the server to see these settings.');
        }

        let tabs: ComplexTab[] = [
          { label: `Features`, fields: featuresTab.fields },
          { label: `Source Code`, fields: sourceTab.fields },
          { label: `Terminals`, fields: terminalsTab.fields },
          { label: `Debugger`, fields: debuggerTab.fields },
          { label: `Temporary Data`, fields: tempDataTab.fields },
        ];

        const ui = new CustomUI();

        if (passwordAuthorisedExtensions.length) {
          const passwordAuthTab = new Section();

          passwordAuthTab
            .addParagraph(`The following extensions are authorized to use the password for this connection.`)
            .addParagraph(`<ul>${passwordAuthorisedExtensions.map(authExtension => `<li>✅ <code>${authExtension.displayName || authExtension.id}</code> - since ${new Date(authExtension.since).toDateString()} - last access on ${new Date(authExtension.lastAccess).toDateString()}</li>`).join(``)}</ul>`)
            .addButtons({ id: `clearAllowedExts`, label: `Clear list` })

          tabs.push({ label: `Extension Auth`, fields: passwordAuthTab.fields });
        }

        const defaultTab = tabs.findIndex(t => t.label === tab);

        // If `tab` is provided, we can open directory to a specific tab.. pretty cool
        ui.addComplexTabs(tabs, (defaultTab >= 0 ? defaultTab : undefined))
          .addHorizontalRule()
          .addButtons({ id: `save`, label: `Save settings`, requiresValidation: true });

        await Tools.withContext(EDITING_CONTEXT, async () => {
          const page = await ui.loadPage<any>(`Settings: ${config.name}`);
          if (page) {
            page.panel.dispose();

            if (page.data) {
              const data = page.data;
              const button = data.buttons;

              switch (button) {
                case `import`:
                  vscode.commands.executeCommand(`code-for-ibmi.debug.setup.local`);
                  break;

                case `generate`:
                  vscode.commands.executeCommand(`code-for-ibmi.debug.setup.remote`);
                  break;

                case `clearAllowedExts`:
                  instance.getStorage()?.revokeAllExtensionAuthorisations();
                  break;

                default:
                  const data = page.data;
                  for (const key in data) {

                    //In case we need to play with the data
                    switch (key) {
                      case `sourceASP`:
                        if (data[key].trim() === ``) data[key] = null;
                        break;
                      case `hideCompileErrors`:
                        data[key] = String(data[key]).split(`,`)
                          .map(item => item.toUpperCase().trim())
                          .filter(item => item !== ``)
                          .filter(Tools.distinct);
                        break;
                      case `protectedPaths`:
                        data[key] = String(data[key]).split(`,`)
                          .map(item => item.trim())
                          .map(item => item.startsWith('/') ? item : connection?.upperCaseName(item) || item.toUpperCase())
                          .filter(item => item !== ``)
                          .filter(Tools.distinct);
                        break;
                    }
                  }

                  if (restartFields.some(item => data[item] && data[item] !== config[item])) {
                    restart = true;
                  }

                  const reloadBrowsers = config.protectedPaths.join(",") !== data.protectedPaths.join(",");
                  const removeCachedSettings = (!data.quickConnect && data.quickConnect !== config.quickConnect);

                  Object.assign(config, data);
                  await instance.setConfig(config);
                  if (removeCachedSettings)
                    GlobalStorage.get().deleteServerSettingsCache(config.name);

                  if (connection) {
                    if (restart) {
                      vscode.window.showInformationMessage(`Some settings require a restart to take effect. Reload workspace now?`, `Reload`, `No`)
                        .then(async (value) => {
                          if (value === `Reload`) {
                            await vscode.commands.executeCommand(`workbench.action.reloadWindow`);
                          }
                        });
                    }
                    else if (reloadBrowsers) {
                      vscode.commands.executeCommand("code-for-ibmi.refreshIFSBrowser");
                      vscode.commands.executeCommand("code-for-ibmi.refreshObjectBrowser");
                    }
                  }

                  //Refresh connection browser if not connected
                  else {
                    vscode.commands.executeCommand(`code-for-ibmi.refreshConnections`);
                  }
                  break;
              }
            }
          }
        })
      }),

      vscode.commands.registerCommand(`code-for-ibmi.showLoginSettings`, async (server?: Server) => {
        if (server) {
          const name = server.name;

          const connection = ConnectionManager.getByName(name);
          if (connection) {
            const storedPassword = await ConnectionManager.getStoredPassword(context, name);
            let { data: stored, index } = connection;

            const ui = new CustomUI()
              .addInput(`host`, t(`login.host`), undefined, { default: stored.host, minlength: 1 })
              .addInput(`port`, t(`login.port`), undefined, { default: String(stored.port), minlength: 1, maxlength: 5, regexTest: `^\\d+$` })
              .addInput(`username`, t(`username`), undefined, { default: stored.username, minlength: 1 })
              .addParagraph(t(`login.authDecision`))
              .addPassword(`password`, `${t(`password`)}${storedPassword ? ` (${t(`stored`)})` : ``}`, t(`login.password.label`))
              .addFile(`privateKeyPath`, `${t(`privateKey`)}${stored.privateKeyPath ? ` (${t(`current`)}: ${stored.privateKeyPath})` : ``}`, t(`login.privateKey.label`) + ' ' + t(`login.privateKey.support`))
              .addButtons(
                { id: `submitButton`, label: t(`save`), requiresValidation: true },
                { id: `removeAuth`, label: t(`login.removeAuth`) }
              );

            await Tools.withContext(EDITING_CONTEXT, async () => {
              const page = await ui.loadPage<LoginSettings>(t(`login.title.edit`, name));
              if (page && page.data) {
                page.panel.dispose();

                const data = page.data;
                const chosenButton = data.buttons as "submitButton" | "removeAuth";

                switch (chosenButton) {
                  case `removeAuth`:
                    await ConnectionManager.deleteStoredPassword(context, name);
                    data.privateKeyPath = undefined;
                    vscode.window.showInformationMessage(t(`login.authRemoved`, name));
                    break;

                  default:
                    if (data.password) {
                      delete data.privateKeyPath;
                      if (data.password !== storedPassword) {
                        // New password was entered, so store the password
                        // and remove the private key path from the data
                        await ConnectionManager.setStoredPassword(context, name, data.password);
                        vscode.window.showInformationMessage(t(`login.password.updated`, name));
                      }
                    } else if (data.privateKeyPath?.trim()) {
                      // If no password was entered, but a keypath exists
                      // then remove the password from the data and
                      // use the keypath instead
                      await ConnectionManager.deleteStoredPassword(context, name);
                      vscode.window.showInformationMessage(t(`login.privateKey.updated`, name));
                    }
                    else{
                      delete data.privateKeyPath;
                    }
                    break;
                }

                //Fix values before assigning the data
                data.port = Number(data.port);
                delete data.password;
                delete data.buttons;

                stored = Object.assign(stored, data);
                await ConnectionManager.updateByIndex(index, stored);
                GlobalStorage.get().deleteServerSettingsCache(server.name);
                vscode.commands.executeCommand(`code-for-ibmi.refreshConnections`);
              }
            });
          }
        }
      })
    )
  }
}