
import IBMi from './IBMi';
import { Tools } from './Tools';
import { Variable, RemoteCommand, CommandResult, StandardIO } from './types';

export interface ILELibrarySettings {
  currentLibrary: string;
  libraryList: string[];
}

export namespace CompileTools {
  export const NEWLINE = `\r\n`;
  export const DID_NOT_RUN = -123;

  function expandVariables(variables: Variable) {
    for (const key in variables) {
      for (const key2 in variables) {
        if (key !== key2) { // Do not expand one self
          variables[key] = variables[key].replace(new RegExp(key2, `g`), variables[key2]);
        }
      }
    }
  }

  function expandCommand(inputValue: string, variables: Variable) {
    for (const key in variables) {
      if (variables[key]) {
        inputValue = inputValue.replace(new RegExp(key, `g`), variables[key]);
      }
    };

    return inputValue;
  }

  function applyDefaultVariables(connection: IBMi, variables: Variable) {
    const config = connection.getConfig();
    variables[`&BUILDLIB`] = variables[`CURLIB`] || config.currentLibrary;
    if (!variables[`&CURLIB`]) variables[`&CURLIB`] = config.currentLibrary;
    if (!variables[`\\*CURLIB`]) variables[`\\*CURLIB`] = config.currentLibrary;
    variables[`&USERNAME`] = connection.currentUser;
    variables[`{usrprf}`] = connection.currentUser;
    variables[`&HOST`] = connection.currentHost;
    variables[`{host}`] = connection.currentHost;
    variables[`&HOME`] = config.homeDirectory;
    variables[`&WORKDIR`] = config.homeDirectory;

    for (const variable of config.customVariables) {
      variables[`&${variable.name.toUpperCase()}`] = variable.value;
    }
  }

  interface RunCommandEvents {
    writeEvent?: (content: string) => void;
    commandConfirm?: (command: string) => Promise<string>;
  }

  /**
   * Execute a command
   */
  export async function runCommand(connection: IBMi, options: RemoteCommand, events: RunCommandEvents = {}): Promise<CommandResult> {
    const config = connection.getConfig();
    if (config && connection) {
      const cwd = options.cwd;
      const variables = options.env || {};

      applyDefaultVariables(connection, variables);
      expandVariables(variables);

      const ileSetup: ILELibrarySettings = {
        currentLibrary: variables[`&CURLIB`] || config.currentLibrary,
        libraryList: variables[`&LIBL`]?.split(` `) || config.libraryList,
      };
      // Remove any duplicates from the library list
      ileSetup.libraryList = ileSetup.libraryList.filter(Tools.distinct);

      const libraryList = buildLibraryList(ileSetup);
      variables[`&LIBLS`] = libraryList.join(` `);

      let commandString = expandCommand(
        options.command,
        variables
      );

      if (events.commandConfirm) {
        commandString = await events.commandConfirm(commandString);
      }

      if (commandString) {
        const commands = commandString.split(`\n`).filter(command => command.trim().length > 0);

        if (events.writeEvent) {
          if (options.environment === `ile` && !options.noLibList) {
            events.writeEvent(`Current library: ` + ileSetup.currentLibrary + NEWLINE);
            events.writeEvent(`Library list: ` + ileSetup.libraryList.join(` `) + NEWLINE);
          }
          if (options.cwd) {
            events.writeEvent(`Working directory: ` + options.cwd + NEWLINE);
          }
          events.writeEvent(`Commands:\n${commands.map(command => `\t${command}\n`).join(``)}` + NEWLINE);
        }

        const callbacks: StandardIO = events.writeEvent ? {
          onStdout: (data) => {
            events.writeEvent!(data.toString().replaceAll(`\n`, NEWLINE));
          },
          onStderr: (data) => {
            events.writeEvent!(data.toString().replaceAll(`\n`, NEWLINE));
          }
        } : {};

        let commandResult;
        switch (options.environment) {
          case `pase`:
            // We build environment variables for the environment to be ready
            const paseVars: Variable = {};

            // Append any variables passed into the API
            Object.entries(variables).forEach(([key, value]) => {
              if ((/^[A-Za-z\&]/i).test(key)) {
                paseVars[key.startsWith('&') ? key.substring(1) : key] = value;
              }
            });

            commandResult = await connection.sendCommand({
              command: commands.join(` && `),
              directory: cwd,
              env: paseVars,
              ...callbacks
            });
            break;

          case `qsh`:
            commandResult = await connection.sendQsh({
              command: [
                ...options.noLibList? [] : buildLiblistCommands(connection, ileSetup),
                ...commands,
              ].join(` && `),
              directory: cwd,
              ...callbacks
            });
            break;

          case `ile`:
          default:
            // escape $ and # in commands
            commandResult = await connection.sendQsh({
              command: [
                ...options.noLibList? [] : buildLiblistCommands(connection, ileSetup),
                ...commands.map(command =>
                  `${`system "${IBMi.escapeForShell(command)}"`}`,
                )
              ].join(` && `),
              directory: cwd,
              ...callbacks
            });
            break;
        }

        commandResult.command = commandString;
        return commandResult;
        
      } else {
        return {
          code: DID_NOT_RUN,
          command: options.command,
          stdout: ``,
          stderr: `Command execution failed. (No command)`,
        };
      }
    }
    else {
      throw new Error("Please connect to an IBM i");
    }
  }

  function buildLibraryList(config: ILELibrarySettings): string[] {
    //We have to reverse it because `liblist -a` adds the next item to the top always 
    return config.libraryList.slice(0).reverse();
  }

  function buildLiblistCommands(connection: IBMi, config: ILELibrarySettings): string[] {
    return [
      `liblist -d ${IBMi.escapeForShell(Tools.sanitizeObjNamesForPase(connection.defaultUserLibraries).join(` `))}`,
      `liblist -c ${IBMi.escapeForShell(Tools.sanitizeObjNamesForPase([config.currentLibrary])[0])}`,
      `liblist -a ${IBMi.escapeForShell(Tools.sanitizeObjNamesForPase(buildLibraryList(config)).join(` `))}`
    ];
  }
}
