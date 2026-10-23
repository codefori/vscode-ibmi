import vscode, { l10n } from "vscode";
import { ConfigConflictError, ConfigFileUpdateStep } from "../api/configuration/configFile";

export type ServerSaveUI = {
  /** What to do if the user rather gets the latest changes; refreshes the Environment view (and the server files) by default */
  onReload?: () => Promise<void>
  /** Where to report the progress; a notification is shown if not set */
  progress?: vscode.Progress<{ message?: string }>
};

export type ServerSave = {
  /** Title of the progress notification */
  title: string
  /** Path of the server file being written */
  filePath: string
  /** Explains the choice the user has to make when the entry was changed by someone else */
  conflictDetail: string
  /**
   * Writes the change to the server file
   * @param force `true` when the user chose to overwrite the changes made by someone else
   */
  write: (force: boolean, onProgress: (step: ConfigFileUpdateStep) => void) => Promise<void>
};

function describeSaveStep(step: ConfigFileUpdateStep, filePath: string) {
  switch (step) {
    case `access`: return l10n.t("Checking access to {0}...", filePath);
    case `read`: return l10n.t("Reading the latest content of {0}...", filePath);
    case `upload`: return l10n.t("Uploading the new content...");
    case `verify`: return l10n.t("Verifying the uploaded content...");
    case `write`: return l10n.t("Writing {0}...", filePath);
    case `check`: return l10n.t("Checking {0}...", filePath);
  }
}

/**
 * Writes a change to a server file (in /etc/vscode); if the entry was changed on the server by someone else in the meantime,
 * the user decides whether to overwrite those changes or to reload them.
 * @returns `true` if the change was saved
 * @throws any error other than a {@link ConfigConflictError}
 */
export async function saveToServer(save: ServerSave, ui: ServerSaveUI = {}, force = false): Promise<boolean> {
  const progress = ui.progress;
  if (!progress) {
    // Writing a server file takes several round trips to the server: show what is going on
    return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: save.title }, progress => saveToServer(save, { ...ui, progress }, force));
  }

  try {
    await save.write(force, step => progress.report({ message: describeSaveStep(step, save.filePath) }));
    return true;
  } catch (error: any) {
    if (!(error instanceof ConfigConflictError)) {
      throw error;
    }

    const overwrite = l10n.t("Overwrite");
    const reload = l10n.t("Reload");
    const choice = await vscode.window.showWarningMessage(error.message, { modal: true, detail: save.conflictDetail }, overwrite, reload);
    if (choice === overwrite) {
      return saveToServer(save, ui, true);
    } else if (choice === reload) {
      progress.report({ message: l10n.t("Reloading {0}...", save.filePath) });
      if (ui.onReload) {
        await ui.onReload();
      } else {
        await vscode.commands.executeCommand("code-for-ibmi.environment.refresh");
      }
    }

    return false;
  }
}
