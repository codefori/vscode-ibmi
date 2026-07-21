import vscode from "vscode";
import { Tools } from "../../api/Tools";
import { instance } from "../../instantiate";
import { onCodeForIBMiConfigurationChange, ViewSettings } from "../../config/Configuration";
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

  interface PanelState {
    panel: vscode.WebviewPanel;
    /** Active auto-refresh timer, if any. */
    timer?: NodeJS.Timeout;
    /** Current server-side search term. */
    searchTerm: string;
    /** Current page (1-based) for server-side pagination. */
    currentPage: number;
    /** Total number of messages matching the current search. */
    totalItems: number;
  }

  /** Explicit id so refreshes can target this table; see FastTableUpdateOptions.tableId. */
  const JOBLOG_TABLE_ID = `joblog`;

  const activePanels = new Map<string, PanelState>();

  /** Job name of the panel that most recently had focus (used by the toolbar refresh command). */
  let currentActiveJob: string | undefined;

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
      }),
      vscode.commands.registerCommand(`code-for-ibmi.refreshJobLog`, async () => {
        if (currentActiveJob) {
          const state = activePanels.get(currentActiveJob);
          if (state) {
            await refresh(state.panel, currentActiveJob);
            return;
          }
        }
        vscode.window.showWarningMessage(vscode.l10n.t("No active job log view found to refresh"));
      }),
      onCodeForIBMiConfigurationChange(`views.autoRefreshInterval`, () => {
        for (const [jobName, state] of activePanels) {
          startAutoRefresh(state, jobName);
        }
      }),
      onCodeForIBMiConfigurationChange(`tables.itemsPerPage`, async () => {
        // The page size is baked into the webview's script, so the whole page has to
        // be rebuilt. The current page number no longer means the same thing either.
        for (const [jobName, state] of activePanels) {
          state.currentPage = 1;
          try {
            await render(state.panel, jobName);
          } catch (error) {
            console.error(`Job log re-render error:`, error);
          }
        }
      })
    );
  }

  /**
   * Fetch a page of job log messages, optionally filtered by a search term.
   * Filtering and pagination are performed server-side.
   */
  async function fetchJoblog(jobName: string, searchTerm: string, page: number): Promise<{ entries: JoblogEntry[]; total: number }> {
    const connection = instance.getConnection();
    if (!connection) {
      return { entries: [], total: 0 };
    }

    // Build the search filter (shared between the count and the data query)
    let whereClause = ``;
    if (searchTerm && searchTerm.trim() !== `` && searchTerm.trim() !== `-`) {
      const searchPattern = `%${searchTerm.trim().toUpperCase()}%`;
      whereClause = ` WHERE (
        UPPER(MESSAGE_ID) LIKE '${searchPattern}' OR
        UPPER(MESSAGE_TEXT) LIKE '${searchPattern}' OR
        UPPER(MESSAGE_SECOND_LEVEL_TEXT) LIKE '${searchPattern}' OR
        UPPER(FROM_LIBRARY CONCAT '/' CONCAT FROM_PROGRAM) LIKE '${searchPattern}'
      )`;
    }

    // Total count for pagination
    const countRows = await connection.runSQL(
      `SELECT COUNT(*) AS TOTAL FROM TABLE(QSYS2.JOBLOG_INFO('${jobName}'))${whereClause}`
    );
    const total = countRows.length ? Number(countRows[0].TOTAL) : 0;

    const pageSize = FrontendTables.getItemsPerPage();
    const offset = (page - 1) * pageSize;

    const rows = await connection.runSQL(
      `SELECT MESSAGE_ID,
         MESSAGE_TEXT,
         MESSAGE_SECOND_LEVEL_TEXT,
         SEVERITY,
         FROM_LIBRARY CONCAT '/' CONCAT FROM_PROGRAM AS FROM_PROGRAM,
         MESSAGE_LIBRARY CONCAT '/' CONCAT MESSAGE_FILE AS MESSAGE_FILE,
         TO_CHAR(MESSAGE_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS') AS MESSAGE_TIMESTAMP
       FROM TABLE(QSYS2.JOBLOG_INFO('${jobName}'))${whereClause}
       ORDER BY ORDINAL_POSITION DESC
       LIMIT ${pageSize} OFFSET ${offset}`
    );

    const entries = rows.map((row: Tools.DB2Row): JoblogEntry => ({
      msgid: String(row.MESSAGE_ID),
      msgtext: String(row.MESSAGE_TEXT),
      msgtext2: String(row.MESSAGE_SECOND_LEVEL_TEXT),
      severity: Number(row.SEVERITY),
      fromProgram: String(row.FROM_PROGRAM),
      msgFile: String(row.MESSAGE_FILE),
      timestamp: String(row.MESSAGE_TIMESTAMP)
    }));

    return { entries, total };
  }

  async function openJobLog(jobName: string) {
    const existing = activePanels.get(jobName);
    if (existing) {
      existing.panel.reveal();
      currentActiveJob = jobName;
      await refresh(existing.panel, jobName);
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

    const state: PanelState = { panel, searchTerm: ``, currentPage: 1, totalItems: 0 };
    activePanels.set(jobName, state);
    currentActiveJob = jobName;

    // Track focus so the toolbar refresh command targets the right panel
    panel.onDidChangeViewState(e => {
      if (e.webviewPanel.active) {
        currentActiveJob = jobName;
      }
    });

    panel.onDidDispose(() => {
      stopAutoRefresh(state);
      activePanels.delete(jobName);
      if (currentActiveJob === jobName) {
        currentActiveJob = undefined;
      }
    });

    panel.webview.onDidReceiveMessage(async (message: { command?: string; searchTerm?: string; page?: number }) => {
      try {
        switch (message?.command) {
          case `search`:
            state.searchTerm = message.searchTerm ?? ``;
            state.currentPage = 1;
            await refresh(panel, jobName);
            break;
          case `paginate`:
            if (message.searchTerm !== undefined) {
              state.searchTerm = message.searchTerm;
            }
            state.currentPage = message.page ?? 1;
            await refresh(panel, jobName);
            break;
        }
      } catch (error) {
        // The webview spins its busy indicator until an answer arrives, so a failed
        // query must still be answered — otherwise it spins until its own timeout.
        console.error(`Job log ${message?.command} error:`, error);
        vscode.window.showErrorMessage(vscode.l10n.t("Failed to load job log: {0}", String(error)));
        await panel.webview.postMessage({ command: `updateTableFailed`, tableId: JOBLOG_TABLE_ID });
      }
    });

    startAutoRefresh(state, jobName);
    await render(panel, jobName);
  }

  function startAutoRefresh(state: PanelState, jobName: string) {
    stopAutoRefresh(state);

    const interval = ViewSettings.getAutoRefreshInterval();
    if (interval <= 0) {
      return;
    }

    // No visibility check: the panel is created with retainContextWhenHidden, so a
    // job log left in a background tab keeps refreshing and is already up to date
    // when the user comes back to it.
    state.timer = setInterval(async () => {
      try {
        await refresh(state.panel, jobName);
      } catch (error) {
        console.error(`Job log auto-refresh error:`, error);
      }
    }, interval);
  }

  function stopAutoRefresh(state: PanelState) {
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = undefined;
    }
  }

  function getColumns(): FrontendTables.FastTableColumn<JoblogEntry>[] {
    return [
      { title: vscode.l10n.t("MSGID"), width: "0.7fr", getValue: e => e.msgid },
      { title: vscode.l10n.t("Message"), width: "2fr", getValue: e => e.msgtext },
      { title: vscode.l10n.t("Second Level"), width: "0.3fr", getValue: e => e.msgtext2.replaceAll(`&N`, `\n`).replaceAll(`&B`, `\n\t`).replaceAll(`&P`, `\n\t`), collapsible: true },
      { title: vscode.l10n.t("Sev."), width: "0.3fr", getValue: e => String(e.severity) },
      { title: vscode.l10n.t("From Program"), width: "1.5fr", getValue: e => e.fromProgram },
      { title: vscode.l10n.t("Timestamp"), width: "1.2fr", getValue: e => e.timestamp }
    ];
  }

  function subtitleFor(jobName: string, total: number) {
    return vscode.l10n.t("Job {0} - Total messages: {1}", jobName, String(total));
  }

  /**
   * Refresh the rows of an already rendered panel.
   * Deliberately does NOT reassign `panel.webview.html`: that would recreate the
   * search box, stealing keyboard focus mid-typing and restoring the search term
   * as it was when the query started — so characters the user had backspaced in
   * the meantime would reappear. The webview patches the table body instead.
   */
  async function refresh(panel: vscode.WebviewPanel, jobName: string) {
    const state = activePanels.get(jobName);
    const searchTerm = state?.searchTerm ?? ``;
    const currentPage = state?.currentPage ?? 1;

    const { entries, total } = await fetchJoblog(jobName, searchTerm, currentPage);

    if (state) {
      state.totalItems = total;
    }

    await panel.webview.postMessage(FrontendTables.generateFastTableUpdate({
      columns: getColumns(),
      data: entries,
      totalItems: total,
      currentPage,
      subtitle: subtitleFor(jobName, total),
      tableId: JOBLOG_TABLE_ID
    }));
  }

  /** Build the whole page. Only used when the panel is first opened. */
  async function render(panel: vscode.WebviewPanel, jobName: string) {
    const state = activePanels.get(jobName);
    const searchTerm = state?.searchTerm ?? ``;
    const currentPage = state?.currentPage ?? 1;

    const { entries, total } = await fetchJoblog(jobName, searchTerm, currentPage);

    if (state) {
      state.totalItems = total;
    }

    const columns = getColumns();

    const body = FrontendTables.generateFastTable({
      title: vscode.l10n.t("Job Log"),
      subtitle: subtitleFor(jobName, total),
      columns,
      data: entries,
      stickyHeader: true,
      emptyMessage: vscode.l10n.t("No job log messages found."),
      enableSearch: true,
      searchPlaceholder: vscode.l10n.t("Search messages..."),
      enablePagination: true,
      itemsPerPage: FrontendTables.getItemsPerPage(),
      totalItems: total,
      currentPage,
      searchTerm,
      tableId: JOBLOG_TABLE_ID
    });

    panel.webview.html = /*html*/`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${vscode.l10n.t("Job Log: {0}", jobName)}</title>
      <script type="module">${vscodeElements}</script>
    </head>
    <body>
      <script>const vscode = acquireVsCodeApi();</script>
      ${body}
    </body>
    </html>`;
  }
}
