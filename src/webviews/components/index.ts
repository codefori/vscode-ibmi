import vscode, { l10n, window } from "vscode";
import { extensionComponentRegistry } from "../../api/components/manager";
import IBMi from "../../api/IBMi";
import { instance } from "../../instantiate";
import { CustomUI, TableColumn, TableRow } from "../CustomUI";

const componentStatus: Record<string, { emoji: string; readableStatus: string }> = {
  NotChecked: { emoji: `❓`, readableStatus: l10n.t(`Not Checked`) },
  NotInstalled: { emoji: `❌`, readableStatus: l10n.t(`Not Installed`) },
  NeedsUpdate: { emoji: `🔄`, readableStatus: l10n.t(`Needs Update`) },
  UpdateAvailable: { emoji: `🆕`, readableStatus: l10n.t(`Update Available`) },
  Installed: { emoji: `✅`, readableStatus: l10n.t(`Installed`) },
  Error: { emoji: `🚨`, readableStatus: l10n.t(`Error`) },
};

type ComponentsPageData = {
  buttons?: `installComponent` | `rescanComponents`
};

export namespace ComponentsUI {
  export function init(context: vscode.ExtensionContext) {
    context.subscriptions.push(
      vscode.commands.registerCommand(`code-for-ibmi.showComponents`, showComponents)
    );
  }

  async function showComponents() {
    const connection = instance.getConnection();
    if (!connection) {
      window.showErrorMessage(l10n.t(`Not connected to IBM i`));
      return;
    }

    const componentManager = connection.getComponentManager();
    const states = componentManager.getComponentStates();
    const tableColumns: TableColumn[] = [
      { label: l10n.t(`Component`) },
      { label: l10n.t(`Type`) },
      { label: l10n.t(`Status`) },
      { label: l10n.t(`Minimum`) },
      { label: l10n.t(`Installed`) },
      { label: l10n.t(`Available`) },
      { label: l10n.t(`Startup Time`) },
    ];

    const ui = new CustomUI();
    extensionComponentRegistry.getComponents().forEach((components, extensionId) => {
      const extension = vscode.extensions.getExtension(extensionId);
      const extensionName = extension?.packageJSON.displayName || extension?.id || l10n.t(`Unnamed extension`);
      const tableRows: TableRow[] = components.map(component => {
        const id = component.getIdentification();
        const state = states.find(c => c.id.name === id.name)?.state;
        const rawStatus = state?.status ?? `Unknown`;
        const { emoji, readableStatus } = componentStatus[rawStatus] ?? { emoji: ``, readableStatus: rawStatus };
        const minVersion = String(id.version);
        const startUpTime = componentManager.getStartUpTime(id.name);
        return {
          cells: [
            emoji ? `${emoji} ${id.name}` : id.name,
            id.userManaged ? l10n.t(`Optional`) : l10n.t(`Required`),
            readableStatus,
            minVersion,
            state?.installedVersion !== undefined ? String(state.installedVersion) : ([`Installed`, `NeedsUpdate`, `UpdateAvailable`].includes(rawStatus) ? minVersion : `-`),
            state?.availableVersion !== undefined ? String(state.availableVersion) : `-`,
            startUpTime !== undefined ? `${startUpTime} ms` : `-`,
          ]
        };
      });
      ui.addHeading(extensionName, 3)
        .addTable(`components-${extensionId}`, ``, tableColumns, tableRows);
    });

    const hasActionable = states.some(c => c.id.userManaged && c.state.status !== `Installed`);
    ui.addButtons(
      hasActionable ? { id: `installComponent`, label: l10n.t(`Install or update components`) } : undefined,
      { id: `rescanComponents`, label: l10n.t(`Re-scan components`) }
    );

    const page = await ui.loadPage<ComponentsPageData>(l10n.t(`Components: {0}`, connection.currentConnectionName));
    if (page) {
      page.panel.dispose();

      switch (page.data?.buttons) {
        case `installComponent`:
          installComponentsQuickPick(connection);
          break;

        case `rescanComponents`:
          await window.withProgress({ title: l10n.t(`Component Re-scan`), location: vscode.ProgressLocation.Notification }, async (progress) => {
            componentManager.clearRegistered();
            await componentManager.startup([], (name, current, total) => {
              progress.report({ message: `${current}/${total} - ${name}`, increment: 100 / total });
            });
          });
          vscode.commands.executeCommand(`code-for-ibmi.showComponents`);
          break;
      }
    }
  }

  function installComponentsQuickPick(connection: IBMi) {
    const components = connection.getComponentManager().getComponentStates();
    const actionable = components.filter(c => c.id.userManaged && c.state.status !== `Installed`);

    if (actionable.length === 0) {
      return;
    }

    const multiple = actionable.length > 1;
    window.showQuickPick(actionable.map(c => {
      const { readableStatus } = componentStatus[c.state.status] ?? { readableStatus: c.state.status };
      return {
        label: c.id.name,
        description: readableStatus,
        id: c.id.name,
        isUpdate: c.state.status === `UpdateAvailable` || c.state.status === `NeedsUpdate`,
      };
    }), {
      title: multiple ? l10n.t(`Install or update components`) : l10n.t(`Install or update component`),
      canPickMany: true,
      placeHolder: multiple ? l10n.t(`Select components to install or update`) : l10n.t(`Select component to install or update`)
    }).then(async result => {
      if (result) {
        window.withProgress({ title: multiple ? l10n.t(`Components`) : l10n.t(`Component`), location: vscode.ProgressLocation.Notification }, async (progress) => {
          for (const item of result) {
            progress.report({ message: item.isUpdate ? l10n.t(`Updating {0}...`, item.label) : l10n.t(`Installing {0}...`, item.label) });
            try {
              await connection.getComponentManager().installComponent(item.id);
            } catch (e) {
              // TODO: handle errors!
            }
          }
        });
      }
    });
  }
}
