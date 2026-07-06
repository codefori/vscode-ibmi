import vscode from "vscode";
import { Tools } from "../../api/Tools";
import { instance } from "../../instantiate";
import { FrontendTables } from "../../ui/frontendTables";

const vscodeElements = require(`@vscode-elements/elements/dist/bundled`);

interface JoblogEntry {
  msgid: string;
  msgtext: string;
  msgtext2: string;
  severity: number;
  fromProgram: string;
  msgFile: string;
  timestamp: string;
}

/**
 * Displays the job log for a given job in a webview panel.
 */
export namespace JobLogUI {
  /** Auto-refresh interval in milliseconds. */
  const AUTO_REFRESH_INTERVAL = 30000;

  interface PanelState {
    panel: vscode.WebviewPanel;
    /** Whether auto-refresh is currently enabled for this panel. */
    autoRefresh: boolean;
    /** Active auto-refresh timer, if any. */
    timer?: NodeJS.Timeout;
  }

  const activePanels = new Map<string, PanelState>();

  export function init(context: vscode.ExtensionContext) {
    context.subscriptions.push(
      vscode.commands.registerCommand(`code-for-ibmi.showJobLog`, async (jobName?: string) => {
        const connection = instance.getConnection();
        if (!connection) {
          vscode.window.showErrorMessage(vscode.l10n.t("Not connected to IBM i"));
          return;
        }

        if (!jobName) {
          const currentJob = await connection.runSQL(`select JOB_NAME as JOBNAME from table(qsys2.active_job_info(job_name_filter => '*', detailed_info => 'NONE'))`);

          jobName = await vscode.window.showInputBox({
            placeHolder: vscode.l10n.t("000000/USER/MYJOB"),
            title: vscode.l10n.t("Enter job name (number/user/name)"),
            value: currentJob.length ? String(currentJob[0].JOBNAME) : undefined,
            validateInput: (value) => {
              if (value.split(`/`).length !== 3) {
                return vscode.l10n.t("Job name must be in format: number/user/name");
              }
            }
          });
        }

        if (jobName) {
          await openJobLog(jobName);
        }
      })
    );
  }

  async function fetchJoblog(jobName: string): Promise<JoblogEntry[]> {
    const connection = instance.getConnection();
    if (!connection) {
      return [];
    }

    const rows = await connection.runSQL(
      `SELECT MESSAGE_ID,
         MESSAGE_TEXT,
         MESSAGE_SECOND_LEVEL_TEXT,
         SEVERITY,
         FROM_LIBRARY CONCAT '/' CONCAT FROM_PROGRAM AS FROM_PROGRAM,
         MESSAGE_LIBRARY CONCAT '/' CONCAT MESSAGE_FILE AS MESSAGE_FILE,
         TO_CHAR(MESSAGE_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS') AS MESSAGE_TIMESTAMP
       FROM TABLE(QSYS2.JOBLOG_INFO('${jobName}'))
       ORDER BY ORDINAL_POSITION DESC`
    );

    return rows.map((row: Tools.DB2Row): JoblogEntry => ({
      msgid: String(row.MESSAGE_ID),
      msgtext: String(row.MESSAGE_TEXT),
      msgtext2: String(row.MESSAGE_SECOND_LEVEL_TEXT),
      severity: Number(row.SEVERITY),
      fromProgram: String(row.FROM_PROGRAM),
      msgFile: String(row.MESSAGE_FILE),
      timestamp: String(row.MESSAGE_TIMESTAMP)
    }));
  }

  async function openJobLog(jobName: string) {
    const existing = activePanels.get(jobName);
    if (existing) {
      existing.panel.reveal();
      await render(existing.panel, jobName);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      `jobLogView`,
      vscode.l10n.t("Job Log: {0}", jobName),
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    const state: PanelState = { panel, autoRefresh: false };
    activePanels.set(jobName, state);

    panel.onDidDispose(() => {
      stopAutoRefresh(state);
      activePanels.delete(jobName);
    });

    panel.webview.onDidReceiveMessage(async (message: { command?: string }) => {
      switch (message?.command) {
        case `refresh`:
          await render(panel, jobName);
          break;
        case `toggleAutoRefresh`:
          state.autoRefresh = !state.autoRefresh;
          if (state.autoRefresh) {
            startAutoRefresh(state, jobName);
          } else {
            stopAutoRefresh(state);
          }
          await render(panel, jobName);
          break;
      }
    });

    await render(panel, jobName);
  }

  function startAutoRefresh(state: PanelState, jobName: string) {
    stopAutoRefresh(state);
    state.timer = setInterval(async () => {
      try {
        await render(state.panel, jobName);
      } catch (error) {
        console.error(`Job log auto-refresh error:`, error);
      }
    }, AUTO_REFRESH_INTERVAL);
  }

  function stopAutoRefresh(state: PanelState) {
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = undefined;
    }
  }

  async function render(panel: vscode.WebviewPanel, jobName: string) {
    const joblog = await fetchJoblog(jobName);
    const autoRefresh = activePanels.get(jobName)?.autoRefresh ?? false;
    const lastUpdated = new Date().toLocaleTimeString();

    const columns: FrontendTables.FastTableColumn<JoblogEntry>[] = [
      { title: vscode.l10n.t("MSGID"), width: "0.7fr", getValue: e => e.msgid },
      { title: vscode.l10n.t("Message"), width: "2fr", getValue: e => e.msgtext },
      { title: vscode.l10n.t("Second Level"), width: "0.3fr", getValue: e => e.msgtext2.replaceAll(`&N`, `\n`).replaceAll(`&B`, `\n\t`).replaceAll(`&P`, `\n\t`), collapsible: true },
      { title: vscode.l10n.t("Sev."), width: "0.3fr", getValue: e => String(e.severity) },
      { title: vscode.l10n.t("From Program"), width: "1.5fr", getValue: e => e.fromProgram },
      { title: vscode.l10n.t("Timestamp"), width: "1.2fr", getValue: e => e.timestamp }
    ];

    const body = FrontendTables.generateFastTable({
      title: vscode.l10n.t("Job Log"),
      subtitle: vscode.l10n.t("Job {0} - Total messages: {1}", jobName, String(joblog.length)),
      columns,
      data: joblog,
      stickyHeader: true,
      emptyMessage: vscode.l10n.t("No job log messages found.")
    });

    panel.webview.html = /*html*/`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${vscode.l10n.t("Job Log: {0}", jobName)}</title>
      <script type="module">${vscodeElements}</script>
      <style>
        .joblog-toolbar {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 20px;
          border-bottom: 1px solid var(--vscode-panel-border);
        }
        .joblog-toolbar .last-updated {
          margin-left: auto;
          color: var(--vscode-descriptionForeground);
          font-size: 0.9em;
        }
      </style>
    </head>
    <body>
      <div class="joblog-toolbar">
        <vscode-button id="joblog-refresh-btn" appearance="primary">
          ${vscode.l10n.t("Refresh")}
        </vscode-button>
        <vscode-button id="joblog-autorefresh-btn" appearance="${autoRefresh ? `primary` : `secondary`}">
          ${autoRefresh
            ? vscode.l10n.t("Auto-refresh: ON ({0}s)", String(AUTO_REFRESH_INTERVAL / 1000))
            : vscode.l10n.t("Auto-refresh: OFF")}
        </vscode-button>
        <span class="last-updated">${vscode.l10n.t("Last updated: {0}", lastUpdated)}</span>
      </div>
      ${body}
      <script>
        const vscode = acquireVsCodeApi();
        document.getElementById('joblog-refresh-btn')?.addEventListener('click', () => {
          vscode.postMessage({ command: 'refresh' });
        });
        document.getElementById('joblog-autorefresh-btn')?.addEventListener('click', () => {
          vscode.postMessage({ command: 'toggleAutoRefresh' });
        });
      </script>
    </body>
    </html>`;
  }
}
