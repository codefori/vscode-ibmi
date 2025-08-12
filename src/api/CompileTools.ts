
import IBMi from './IBMi';
import { Tools } from './Tools';
import { CommandResult, RemoteCommand, StandardIO } from './types';
import { Variables } from './variables';

export interface ILELibrarySettings {
  currentLibrary: string;
  libraryList: string[];
}

export namespace CompileTools {
  export const NEWLINE = `\r\n`;
  export const DID_NOT_RUN = -123;

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
      const variables = new Variables(connection, options.env);

      const ileSetup: ILELibrarySettings = {
        currentLibrary: variables.get(`&CURLIB`) || config.currentLibrary,
        libraryList: variables.get(`&LIBL`)?.split(` `) || config.libraryList,
      };
      // Remove any duplicates from the library list
      ileSetup.libraryList = ileSetup.libraryList.filter(Tools.distinct);

      const libraryList = buildLibraryList(ileSetup);
      variables.set(`&LIBLS`, libraryList.join(` `));

      let commandString = variables.expand(options.command);

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
            commandResult = await connection.sendCommand({
              command: commands.join(` && `),
              directory: cwd,
              env: variables.toPaseVariables(),
              ...callbacks
            });
            break;

          case `qsh`:
            commandResult = await connection.sendQsh({
              command: [
                ...options.noLibList ? [] : buildLiblistCommands(connection, ileSetup),
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
                ...options.noLibList ? [] : buildLiblistCommands(connection, ileSetup),
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
