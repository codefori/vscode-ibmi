import { InputBoxOptions, window } from "vscode";

export type CommandPrompter = (commandToPrompt: string) => Promise<string | undefined> | string | undefined;

let registeredRegistration: { prompter: CommandPrompter } | undefined;

export function registerCommandPrompter(prompter: CommandPrompter): { dispose: () => void } {
    const registration = { prompter };
    registeredRegistration = registration;
    let disposed = false;

    return {
        dispose: () => {
            if (!disposed && registeredRegistration === registration) {
                registeredRegistration = undefined;
            }
            disposed = true;
        }
    };
}

export async function promptCommand(commandToPrompt: string, options?: InputBoxOptions): Promise<string | undefined> {
    if (registeredRegistration) {
        return registeredRegistration.prompter(commandToPrompt);
    }

    return window.showInputBox({ ...options, value: commandToPrompt });
}