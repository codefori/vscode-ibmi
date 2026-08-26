import * as vscode from 'vscode';
import { ViewSettings } from '../config/Configuration';
import { codiconStyles } from '../webviews/codicons';
import { VscodeTools } from './Tools';

export namespace FrontendTables {

  const EMPTY_VALUE_PLACEHOLDER = '<span style="color: var(--vscode-descriptionForeground); font-style: italic;">—</span>';

  /** Escape a value for safe interpolation into the generated HTML; empty/null-ish values render as '-'. */
  function escapeHtml(text: string | number): string {
    if (text === 0) return '0';
    if (text === null || text === undefined || text === '') return '-';
    const str = String(text);
    if (str === 'null' || str === 'undefined' || str.trim() === '') return '-';
    return VscodeTools.escapeHtml(str);
  }

  const MAX_FRACTION_DIGITS = 20;

  /** Locale-format a number keeping exactly the decimals of the source text, so 12.50 stays "12.50". */
  function formatNumber(num: number, strValue: string): string {
    const fraction = strValue.split('.')[1];
    if (fraction === undefined) {
      // Integer, or exponential notation whose digits can't be read off the text.
      return num.toLocaleString(undefined, Number.isInteger(num) ? undefined : { maximumFractionDigits: MAX_FRACTION_DIGITS });
    }
    const digits = Math.min(fraction.length, MAX_FRACTION_DIGITS);
    return num.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  /** Renders YES/NO as colored badges and numbers with locale formatting; undefined if the value is neither. */
  function formatYesNoOrNumber(strValue: string, skipNumeric: boolean): string | undefined {
    if (strValue === 'YES') {
      return '<span style="color: var(--vscode-testing-iconPassed, #73c991); font-weight: 600;">✓ YES</span>';
    }
    if (strValue === 'NO') {
      return '<span style="color: var(--vscode-testing-iconFailed, #f48771); font-weight: 600;">✗ NO</span>';
    }
    if (!skipNumeric && strValue !== '' && isFinite(Number(strValue))) {
      const num = Number(strValue);
      return `<span style="font-family: var(--vscode-editor-font-family); color: var(--vscode-charts-blue);">${formatNumber(num, strValue)}</span>`;
    }
    return undefined;
  }

  /**
   * Source of fallback table identifiers. Only uniqueness within a single generated page
   * matters, so a monotonic counter is enough; it deliberately keeps counting across pages
   * rather than resetting, since ids never have to be reproducible between renders.
   */
  let autoTableIdCounter = 0;
  function nextAutoTableId(): string {
    return `fast-table-${++autoTableIdCounter}`;
  }

  /**
   * Column definition for FastTable
   */
  export interface FastTableColumn<T> {
    /** Column title in header */
    title: string;
    /** Function to extract value from row */
    getValue: (row: T) => string | number;
    /** Column width - supports: "100px", "20%", "1fr", "2fr", "auto", "minmax(100px, 1fr)" */
    width?: string;
    /** Custom CSS class for cells (optional) */
    cellClass?: string;
    /** If true, this column will be collapsible (hidden by default, shown in code format when expanded) */
    collapsible?: boolean;
    /** If true, shows the column title in the table header even when collapsible (default: false) */
    showTitle?: boolean;
  }

  /**
   * Options for generating a FastTable
   */
  export interface FastTableOptions<T> {
    /** Page title */
    title: string;
    /** Subtitle or additional info (optional) */
    subtitle?: string;
    /** Table columns */
    columns: FastTableColumn<T>[];
    /** Data to display */
    data: T[];
    /** Sticky header (default: true) */
    stickyHeader?: boolean;
    /** Message when no data (optional) */
    emptyMessage?: string;
    /** Additional custom CSS (optional) */
    customStyles?: string;
    /** Custom JavaScript (optional) */
    customScript?: string;
    /** Enable search bar (default: false) */
    enableSearch?: boolean;
    /** Search placeholder text (optional) */
    searchPlaceholder?: string;
    /** Enable pagination (default: false) */
    enablePagination?: boolean;
    /** Items per page (defaults to the `code-for-ibmi.tables.itemsPerPage` setting) */
    itemsPerPage?: number;
    /** Total items count (for server-side pagination) */
    totalItems?: number;
    /** Current page (for server-side pagination, default: 1) */
    currentPage?: number;
    /** Current search term (for server-side search) */
    searchTerm?: string;
    /** Table identifier for multi-table documents (e.g., SaveFile with objects/members/spools) */
    tableId?: string;
  }

  /**
   * Options for generating a detail table (key-value pairs)
   */
  export interface DetailTableOptions {
    /** Page title */
    title?: string;
    /** Subtitle or additional info (optional) */
    subtitle?: string;
    /** Column definitions (keys and labels) */
    columns: Map<string, string>;
    /** Data object to display */
    data: any;
    /** Array of column names to format as code (optional) */
    codeColumns?: string[];
    /** Additional custom CSS (optional) */
    customStyles?: string;
    /** Custom JavaScript (optional) */
    customScript?: string;
    /** Show action buttons (optional) */
    actions?: DetailTableAction[];
    /** Hide fields with null values (optional, default: false) */
    hideNullValues?: boolean;
  }

  /**
   * Action button configuration for detail tables
   */
  export interface DetailTableAction {
    /** Button label */
    label: string;
    /** Action identifier */
    action: string;
    /** Button appearance (primary, secondary, etc.) */
    appearance?: string;
    /** Custom CSS style */
    style?: string;
  }

  /**
   * Generate an enhanced detail table (key-value pairs) using Fast components
   * Replaces the legacy table generators (generateTableHtml/generateTableHtmlCode) from the FS extension
   * @param options - Detail table configuration options
   * @returns Complete HTML page string
   */
  export function generateDetailTable(options: DetailTableOptions): string {
    const {
      title = '',
      subtitle = '',
      columns,
      data,
      codeColumns = [],
      customStyles = '',
      customScript = '',
      actions = [],
      hideNullValues = false
    } = options;

    // Format value with icons and styling
    const formatValue = (value: any, isCodeColumn: boolean): string => {
      if (value === null || value === undefined || value.toString().trim() === '') {
        return EMPTY_VALUE_PLACEHOLDER;
      }

      const strValue = String(value).trim();

      const commonFormat = formatYesNoOrNumber(strValue, isCodeColumn);
      if (commonFormat) return commonFormat;

      // Handle code columns
      if (isCodeColumn) {
        return `<code style="background: var(--vscode-textCodeBlock-background); padding: 4px 8px; border-radius: 4px; font-family: var(--vscode-editor-font-family); border: 1px solid var(--vscode-panel-border); display: block; width: 100%; white-space: pre-wrap; word-break: break-all; overflow-wrap: break-word; box-sizing: border-box;">${escapeHtml(value)}</code>`;
      }

      return escapeHtml(value);
    };

    // Generate table rows
    const rows: string[] = [];
    columns.forEach((label, key) => {
      if (key in data[0]) {
        let value = data[0][key as keyof typeof data];

        // Skip null/undefined/empty values if hideNullValues is enabled
        if (hideNullValues && (value === null || value === undefined || value.toString().trim() === '')) {
          return;
        }

        const displayValue = formatValue(value, codeColumns.includes(key));

        rows.push(`
        <vscode-table-row>
          <vscode-table-cell style="font-weight: 600; color: var(--vscode-descriptionForeground);">${escapeHtml(label)}</vscode-table-cell>
          <vscode-table-cell>${displayValue}</vscode-table-cell>
        </vscode-table-row>`);
      }
    });

    // Generate action buttons as raw vscode-button markup (click handling is wired up
    // by the webview's own footer script via a `[href^="action:"]` selector).
    const actionButtons = actions.map((action, index) => {
      const marginTop = index === 0 ? '0' : '10px';
      const appearance = action.appearance || 'primary';
      return `<vscode-button appearance="${appearance}" style="width: 100%; text-align: center; display: block; margin-top: ${marginTop};" href="action:${action.action}">${escapeHtml(action.label)}</vscode-button>`;
    }).join('\n');

    return /*html*/`
    <div class="detail-table-container">
      <style>
        .detail-table-container {
          display: flex;
          flex-direction: column;
          align-items: stretch;
          padding: 0 20px;
          max-width: 1200px;
          margin: 0 auto;
          width: 100%;
          box-sizing: border-box;
        }

        .detail-table-container vscode-table {
          width: 100%;
          min-width: 100%;
          border-radius: 6px;
          overflow: visible;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.24);
        }

        .detail-table-container vscode-table-row {
          display: grid !important;
          grid-template-columns: 30% 70% !important;
          width: 100% !important;
          min-height: 36px;
          align-items: stretch;
          position: relative;
        }

        .detail-table-container vscode-table-row:nth-child(odd) {
          background-color: rgba(var(--vscode-editor-foreground-rgb, 204, 204, 204), 0.06);
        }

        .detail-table-container vscode-table-row:nth-child(even) {
          background-color: rgba(var(--vscode-editor-foreground-rgb, 204, 204, 204), 0.20);
        }

        .detail-table-container vscode-table-row:hover {
          background-color: inherit !important;
          transform: none !important;
        }

        .detail-table-container vscode-table-cell:hover {
          background-color: inherit !important;
        }

        .detail-table-container vscode-table-cell:first-child {
          padding: 12px 16px;
          font-weight: 600;
          color: var(--vscode-descriptionForeground);
          white-space: normal;
          word-wrap: break-word;
          background-color: rgba(var(--vscode-editor-foreground-rgb, 204, 204, 204), 0.05);
          border-right: 2px solid var(--vscode-panel-border);
          min-height: 36px;
          display: block;
          height: auto;
        }

        .detail-table-container vscode-table-cell:last-child {
          padding: 12px 16px;
          word-break: break-word;
          white-space: normal;
          word-wrap: break-word;
          font-family: var(--vscode-font-family);
          min-height: 36px;
          display: block;
          min-width: 0;
          overflow-wrap: break-word;
          height: auto;
          position: relative;
          z-index: 1;
        }

        .detail-table-container code {
          font-family: var(--vscode-editor-font-family);
          font-size: 0.95em;
          background: var(--vscode-textCodeBlock-background);
          padding: 4px 8px;
          border-radius: 4px;
          border: 1px solid var(--vscode-panel-border);
          max-width: 100%;
          white-space: pre-wrap;
          word-break: break-all;
          overflow-wrap: break-word;
          display: block;
          width: 100%;
        }

        .detail-table-actions {
          margin-top: 20px;
          padding-top: 20px;
          border-top: 1px solid var(--vscode-panel-border);
          clear: both;
        }

        ${customStyles}
      </style>

      ${title || subtitle ? `
      <div style="margin-top: 20px; margin-bottom: 24px; padding: 16px 20px; background: linear-gradient(135deg, var(--vscode-editor-background) 0%, rgba(var(--vscode-editor-foreground-rgb, 204, 204, 204), 0.03) 100%); border-left: 4px solid var(--vscode-focusBorder); border-radius: 4px; width: 100%; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);">
        ${title ? `<h1 style="margin: 0 0 8px 0; font-size: 1.8em; font-weight: 600; color: var(--vscode-foreground);">${escapeHtml(title)}</h1>` : ''}
        ${subtitle ? `<div style="color: var(--vscode-descriptionForeground); font-size: 0.95em; margin-top: 4px;">${escapeHtml(subtitle)}</div>` : ''}
      </div>
      ` : ''}

      <vscode-table columns='["35%", "65%"]'>
        ${rows.join('')}
      </vscode-table>

      ${actions.length > 0 ? `
      <div class="detail-table-actions">
        ${actionButtons}
      </div>
      ` : ''}
    </div>
  `;
  }

  /**
   * Payload sent to a live table to replace its rows without rebuilding the page.
   * @see generateFastTableUpdate
   */
  export interface FastTableUpdate {
    command: 'updateTable';
    /** Target table. Every rendered table filters incoming messages on this. */
    tableId: string;
    /** Markup for the new <vscode-table-body> content */
    rowsHtml: string;
    /** Modal contents for collapsible columns, indexed by row */
    collapsibleData: { title: string, value: string | number }[][];
    /** Number of rows in this page (used to toggle the empty state) */
    rowCount: number;
    totalItems: number;
    currentPage: number;
    /** Replacement subtitle text (optional) */
    subtitle?: string;
  }

  /** Options for building a FastTableUpdate — the data-dependent subset of FastTableOptions. */
  export interface FastTableUpdateOptions<T> {
    columns: FastTableColumn<T>[];
    data: T[];
    totalItems: number;
    currentPage: number;
    subtitle?: string;
    /**
     * Must be the same tableId the table was rendered with — an update carrying anything
     * else is discarded by every table on the page. Tables meant to be patched therefore
     * have to be given an explicit id in generateFastTable rather than an auto-generated one.
     */
    tableId: string;
  }

  // Format value with icons and styling for FastTable.
  // NOTE: unlike generateDetailTable, cell values here are NOT html-escaped —
  // several callers intentionally return raw HTML (e.g. <vscode-button> action
  // markup) from a column's getValue(), which must render as real elements.
  function formatFastValue(value: string | number): string {
    if (value === null || value === undefined || value === '') {
      return EMPTY_VALUE_PLACEHOLDER;
    }

    const strValue = String(value).trim();
    if (strValue === 'null' || strValue === 'undefined' || strValue === '') {
      return EMPTY_VALUE_PLACEHOLDER;
    }

    return formatYesNoOrNumber(strValue, false) ?? String(value);
  }

  /**
   * Resolve each column to a fixed pixel width.
   * Fixed pixel width assigned per 1fr unit, and an absolute floor so no
   * column becomes too narrow to read. Columns get an actual fixed size
   * instead of a percentage, so resizing the window never squashes them —
   * the wrapper scrolls horizontally instead (see .table-scroll-wrapper).
   * The floor is intentionally low relative to MIN_PX_PER_FR so 'fr' weights
   * stay visually distinct instead of every small-weight column clamping to
   * the same floor value; wide tables (many columns) are expected to scroll.
   */
  function computeColumnWidths<T>(columns: FastTableColumn<T>[]) {
    const MIN_PX_PER_FR = 140;
    const MIN_COLUMN_WIDTH = 90;

    const columnMinWidths = columns.map(col => {
      if (!col.width) return MIN_COLUMN_WIDTH;
      if (col.width.includes('fr')) {
        return Math.max(MIN_COLUMN_WIDTH, parseFloat(col.width) * MIN_PX_PER_FR);
      }
      if (col.width.endsWith('px')) {
        return Math.max(MIN_COLUMN_WIDTH, parseFloat(col.width));
      }
      // For %, minmax(), or other values we can't easily measure — use the floor
      return MIN_COLUMN_WIDTH;
    });

    return {
      // Fixed pixel width per column, passed to the vscode-table 'columns' attribute
      columnsArray: columnMinWidths.map(w => `${w}px`),
      // Total fixed width for the whole table. When the viewport is narrower than
      // this, the wrapper scrolls horizontally instead of squashing columns.
      tableMinWidth: columnMinWidths.reduce((sum, w) => sum + w, 0)
    };
  }

  /**
   * A value this short is never worth wrapping: splitting it over two lines to save
   * a few pixels reads worse than a slightly wider column. Cells holding one are
   * marked `.nowrap-cell`, and the page widens their column at runtime
   * (fitNoWrapColumns) so keeping them on one line never clips them.
   */
  const NOWRAP_MAX_LENGTH = 30;

  function isShortValue(value: string | number): boolean {
    const str = String(value ?? '').trim();
    return str.length > 0 && str.length < NOWRAP_MAX_LENGTH;
  }

  /**
   * Build the table body markup, plus the modal payload for collapsible columns.
   * Shared by the initial page render and by incremental updates, so both produce
   * identical markup.
   */
  function buildRows<T>(columns: FastTableColumn<T>[], data: T[], columnsArray: string[]) {
    const collapsibleIndices = columns.map((col, idx) => col.collapsible ? idx : -1).filter(idx => idx !== -1);

    const collapsibleData = collapsibleIndices.length > 0 ? data.map(row => {
      return collapsibleIndices.map(colIdx => {
        const col = columns[colIdx];
        return {
          title: col.title,
          value: col.getValue(row)
        };
      });
    }) : [];

    const rowsHtml = data.map((row, rowIndex) => {
      const visibleCells = columns.map((col, index) => {
        if (col.collapsible) {
          // For collapsible columns, check if value is empty/null before showing button
          const value = col.getValue(row);
          const isEmpty = value === null || value === undefined || value === '' || String(value).trim() === '' || String(value) === 'null' || String(value) === 'undefined';

          if (isEmpty) {
            // Show empty cell if no content
            return `<vscode-table-cell style="width: ${columnsArray[index]}; text-align: center;"></vscode-table-cell>`;
          } else {
            // Show button to open modal if content exists
            const colIndex = collapsibleIndices.indexOf(index);
            return `<vscode-table-cell style="width: ${columnsArray[index]}; text-align: center;">
              <button type="button" class="show-modal-btn" data-row="${rowIndex}" data-col="${colIndex}" title="${vscode.l10n.t('Show details')}" aria-label="${vscode.l10n.t('Show details')}">
                <span class="codicon codicon-info"></span>
              </button>
            </vscode-table-cell>`;
          }
        }
        const value = col.getValue(row);
        const classes = [col.cellClass, isShortValue(value) ? 'nowrap-cell' : undefined].filter(Boolean);
        const cellClass = classes.length > 0 ? ` class="${classes.join(' ')}"` : '';
        const widthStyle = columnsArray[index] !== 'auto' ? ` style="width: ${columnsArray[index]};"` : '';
        return `<vscode-table-cell${cellClass}${widthStyle}>${formatFastValue(value)}</vscode-table-cell>`;
      }).join('\n        ');

      return `<vscode-table-row class="main-row" data-row="${rowIndex}">
          ${visibleCells}
        </vscode-table-row>`;
    }).join('\n      ');

    return { rowsHtml, collapsibleData };
  }

  /**
   * Build the payload to refresh a table already on screen (search, pagination,
   * auto-refresh). Post it to the webview instead of reassigning `webview.html`:
   * rebuilding the page would recreate the search box, dropping keyboard focus and
   * overwriting whatever the user typed while the query was running.
   * @param options - The new data plus the pagination state it corresponds to
   * @returns Message to pass to `webview.postMessage`
   */
  export function generateFastTableUpdate<T>(options: FastTableUpdateOptions<T>): FastTableUpdate {
    const { columns, data, totalItems, currentPage, subtitle, tableId } = options;
    const { columnsArray } = computeColumnWidths(columns);
    const { rowsHtml, collapsibleData } = buildRows(columns, data, columnsArray);

    return {
      command: 'updateTable',
      tableId,
      rowsHtml,
      collapsibleData,
      rowCount: data.length,
      totalItems,
      currentPage,
      subtitle
    };
  }

  /**
   * Generate a complete HTML page with FAST Element table
   * Optimized for displaying large datasets with better performance
   * @param options - Table configuration options
   * @returns Complete HTML page string
   */
  export function generateFastTable<T>(options: FastTableOptions<T>): string {
    const {
      title,
      subtitle,
      columns,
      data,
      stickyHeader = true,
      emptyMessage = 'No data available.',
      customStyles = '',
      customScript = '',
      enableSearch = false,
      searchPlaceholder = 'Search...',
      enablePagination = false,
      itemsPerPage = ViewSettings.getItemsPerPage(),
      totalItems = data.length,
      currentPage = 1,
      searchTerm = '',
      tableId = undefined
    } = options;

    // Every table gets an identifier, even when the caller didn't ask for one: it suffixes
    // each element id and scopes the emitted script inside an IIFE. Without it, a page
    // holding more than one table would repeat ids (so getElementById would always reach
    // the first table) and re-declare the script's top-level `let`s in the shared global
    // lexical scope, which kills every script after the first with a SyntaxError.
    // An auto-generated id is fine for display-only tables; a table meant to be patched
    // through generateFastTableUpdate needs an explicit, stable tableId from the caller.
    const id = tableId ?? nextAutoTableId();
    const suffix = `-${id}`;

    const { columnsArray, tableMinWidth } = computeColumnWidths(columns);
    const { rowsHtml: rows, collapsibleData } = buildRows(columns, data, columnsArray);

    // Check if there are any collapsible columns
    const hasCollapsibleColumns = columns.some(col => col.collapsible);

    // Generate table header with width styles (skip collapsible columns)
    const headerCells = columns.map((col, index) => {
      if (col.collapsible) {
        const widthStyle = columnsArray[index] !== 'auto' ? ` style="width: ${columnsArray[index]};"` : '';
        const title = col.showTitle ? escapeHtml(col.title) : '';
        return `<vscode-table-header-cell${widthStyle}>${title}</vscode-table-header-cell>`;
      }
      const widthStyle = columnsArray[index] !== 'auto' ? ` style="width: ${columnsArray[index]};"` : '';
      return `<vscode-table-header-cell${widthStyle}>${escapeHtml(col.title)}</vscode-table-header-cell>`;
    }).join('\n        ');

    return /*html*/`
    <style>
      ${codiconStyles}

      body {
        padding: 0;
        margin: 0;
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
        color: var(--vscode-foreground);
        background-color: var(--vscode-editor-background);
      }

      .container {
        padding: 20px;
      }

      .header {
        margin-top: 0;
        margin-bottom: 24px;
        padding: 16px 20px;
        background: linear-gradient(135deg, var(--vscode-editor-background) 0%, rgba(var(--vscode-editor-foreground-rgb, 204, 204, 204), 0.03) 100%);
        border-left: 4px solid var(--vscode-focusBorder);
        border-radius: 4px;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
      }

      .header h1 {
        margin: 0 0 8px 0;
        font-size: 1.8em;
        font-weight: 600;
        color: var(--vscode-foreground);
      }

      .header .info {
        color: var(--vscode-descriptionForeground);
        font-size: 0.95em;
        margin-top: 4px;
      }

      .search-bar {
        margin-bottom: 20px;
        padding: 16px;
        background: rgba(var(--vscode-editor-foreground-rgb, 204, 204, 204), 0.03);
        border-radius: 6px;
        border: 1px solid rgba(var(--vscode-editor-foreground-rgb, 204, 204, 204), 0.1);
      }

      .search-bar-label {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 8px;
        font-weight: 600;
        font-size: 0.9em;
        color: var(--vscode-foreground);
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .search-bar-label .codicon {
        font-size: 1.1em;
      }

      .search-bar vscode-text-field {
        width: 100%;
      }

      .pagination-controls {
        margin-top: 16px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        background: rgba(var(--vscode-editor-foreground-rgb, 204, 204, 204), 0.03);
        border-radius: 4px;
      }

      .pagination-info {
        color: var(--vscode-descriptionForeground);
        font-size: 0.9em;
      }

      .pagination-buttons {
        display: flex;
        gap: 8px;
        align-items: center;
      }

      .page-input-container {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .page-input-container vscode-text-field {
        width: 80px;
      }

      /* Height capped (refined at runtime by syncTableViewport) so the horizontal
         scrollbar stays on screen instead of sitting below a long table. */
      .table-scroll-wrapper {
        overflow: auto;
        max-height: 65vh;
        width: 100%;
        transition: opacity 0.15s ease;
      }

      /* The webview host only styles the document scrollbars, not the wrapper's. */
      .table-scroll-wrapper::-webkit-scrollbar {
        height: 12px;
        width: 12px;
      }

      .table-scroll-wrapper::-webkit-scrollbar-track,
      .table-scroll-wrapper::-webkit-scrollbar-corner {
        background: transparent;
      }

      .table-scroll-wrapper::-webkit-scrollbar-thumb {
        background-color: var(--vscode-scrollbarSlider-background, rgba(121, 121, 121, 0.4));
      }

      .table-scroll-wrapper::-webkit-scrollbar-thumb:hover {
        background-color: var(--vscode-scrollbarSlider-hoverBackground, rgba(100, 100, 100, 0.7));
      }

      .table-scroll-wrapper::-webkit-scrollbar-thumb:active {
        background-color: var(--vscode-scrollbarSlider-activeBackground, rgba(191, 191, 191, 0.4));
      }

      /* Search/pagination are server-side: while the extension re-queries, dim the
         stale rows so it is obvious the content on screen is not the answer yet. */
      .table-scroll-wrapper.is-busy {
        opacity: 0.55;
        pointer-events: none;
      }

      /* Visually hidden, but still announced by screen readers. */
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }

      vscode-table {
        min-width: ${tableMinWidth}px;
        width: 100%;
        border-radius: 6px;
        overflow: hidden;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.24);
        table-layout: fixed;
      }

      vscode-table-header {
        background: linear-gradient(180deg, rgba(var(--vscode-editor-foreground-rgb, 204, 204, 204), 0.08) 0%, rgba(var(--vscode-editor-foreground-rgb, 204, 204, 204), 0.05) 100%);
        border-bottom: 2px solid var(--vscode-focusBorder);
      }

      vscode-table-header-cell {
        white-space: normal;
        word-wrap: break-word;
        padding: 14px 16px;
        font-weight: 700;
        font-size: 0.95em;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--vscode-foreground);
      }

      vscode-table-row {
        transition: background-color 0.2s ease, transform 0.1s ease;
      }

      vscode-table-row:nth-child(odd) {
        background-color: rgba(var(--vscode-editor-foreground-rgb, 204, 204, 204), 0.06);
      }

      vscode-table-row:nth-child(even) {
        background-color: rgba(var(--vscode-editor-foreground-rgb, 204, 204, 204), 0.20);
      }

      vscode-table-row:hover {
        background-color: var(--vscode-list-hoverBackground);
        transform: translateX(2px);
      }

      vscode-table-cell {
        white-space: normal;
        word-wrap: break-word;
        overflow-wrap: break-word;
        padding: 12px 16px;
        border-bottom: 1px solid rgba(var(--vscode-editor-foreground-rgb, 204, 204, 204), 0.08);
        overflow: hidden;
        text-overflow: ellipsis;
      }

      vscode-table-header-cell,
      vscode-table-cell {
        box-sizing: border-box;
      }

      /* Cells that must stay on a single line: action columns, where wrapping would
         push the last button onto a second row and stretch the whole row, and short
         values (see NOWRAP_MAX_LENGTH), which read worse split in two than in a
         slightly wider column. Both are measured by fitNoWrapColumns, which grows
         the column so a single line is never clipped. */
      vscode-table-cell.nowrap-cell,
      vscode-table-cell:has(vscode-button),
      vscode-table-cell:has(button) {
        white-space: nowrap;
        text-overflow: clip;
      }

      /* Add spacing between buttons in action columns */
      vscode-table-cell vscode-button {
        margin-right: 8px;
      }

      vscode-table-cell vscode-button:last-child {
        margin-right: 0;
      }

      .empty-state {
        text-align: center;
        padding: 40px;
        color: var(--vscode-descriptionForeground);
      }

      .hidden {
        display: none !important;
      }

      /* Modal button styles */
      .show-modal-btn {
        background: transparent;
        border: none;
        border-radius: 4px;
        color: var(--vscode-foreground);
        cursor: pointer;
        line-height: 1;
        padding: 4px;
      }

      .show-modal-btn:hover {
        background: rgba(var(--vscode-editor-foreground-rgb, 204, 204, 204), 0.15);
      }

      .show-modal-btn:focus-visible {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: 2px;
      }

      /* Modal styles */
      .modal {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 1000;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .modal-overlay {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(2px);
      }

      .modal-content {
        position: relative;
        background: var(--vscode-editor-background);
        border: 1px solid var(--vscode-panel-border);
        border-radius: 6px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        max-width: 90%;
        max-height: 80%;
        width: 800px;
        display: flex;
        flex-direction: column;
        animation: modalFadeIn 0.2s ease-out;
      }

      @keyframes modalFadeIn {
        from {
          opacity: 0;
          transform: scale(0.95);
        }
        to {
          opacity: 1;
          transform: scale(1);
        }
      }

      .modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 20px;
        border-bottom: 1px solid var(--vscode-panel-border);
      }

      .modal-header h3 {
        margin: 0;
        font-size: 1.2em;
        font-weight: 600;
        color: var(--vscode-foreground);
      }

      .modal-close-btn {
        background: transparent;
        border: none;
        border-radius: 4px;
        color: var(--vscode-foreground);
        cursor: pointer;
        font-family: var(--vscode-font-family);
        font-size: 1.1em;
        line-height: 1;
        padding: 4px 8px;
      }

      .modal-close-btn:hover {
        background: rgba(var(--vscode-editor-foreground-rgb, 204, 204, 204), 0.15);
      }

      .modal-close-btn:focus-visible {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: 2px;
      }

      .modal-body {
        padding: 20px;
        overflow-y: auto;
        flex: 1;
      }

      .modal-body pre {
        background: var(--vscode-textCodeBlock-background);
        padding: 16px;
        border-radius: 4px;
        overflow-x: auto;
        margin: 0;
        border: 1px solid rgba(var(--vscode-editor-foreground-rgb, 204, 204, 204), 0.1);
        font-family: var(--vscode-editor-font-family);
        font-size: 0.95em;
        line-height: 1.6;
        white-space: pre-wrap;
        word-wrap: break-word;
      }

      ${customStyles}
    </style>
    <div class="container">
      ${title || subtitle ? `
      <div class="header">
        ${title ? `<h1>${escapeHtml(title)}</h1>` : ''}
        ${subtitle ? `<div class="info" id="subtitle-info${suffix}">${escapeHtml(subtitle)}</div>` : ''}
      </div>
      ` : ''}

      ${enableSearch ? `
      <div class="search-bar">
        <label class="search-bar-label" for="search-input${suffix}">
          <span class="codicon codicon-search"></span> ${vscode.l10n.t('Search')}
        </label>
        <div style="display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); border-radius: 4px;">
          <span class="codicon codicon-search" id="search-icon${suffix}" style="color: var(--vscode-input-placeholderForeground);"></span>
          <input
            type="text"
            id="search-input${suffix}"
            placeholder="${escapeHtml(searchPlaceholder)}"
            value="${searchTerm && searchTerm !== '-' ? escapeHtml(searchTerm) : ''}"
            style="flex: 1; background: transparent; border: none; outline: none; color: var(--vscode-input-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); padding: 4px 0;">
        </div>
        <span class="sr-only" role="status" aria-live="polite" id="search-status${suffix}"></span>
      </div>
      ` : ''}

      <!-- The table and the empty state are both always emitted and toggled with
           .hidden, so an incremental update can switch between them without the
           extension having to rebuild the page. -->
        <div class="table-scroll-wrapper${data.length > 0 ? '' : ' hidden'}" id="table-scroll-wrapper${suffix}">
          <vscode-table
            id="data-table${suffix}"
            bordered-rows
            columns='${JSON.stringify(columnsArray)}'
            aria-label="${escapeHtml(title)}">
            <vscode-table-header>
              ${headerCells}
            </vscode-table-header>
            <vscode-table-body id="table-body${suffix}">
              ${rows}
            </vscode-table-body>
          </vscode-table>
        </div>

          ${hasCollapsibleColumns ? `
          <!-- Modal for collapsible content -->
          <div id="collapsible-modal${suffix}" class="modal" style="display: none;">
            <div class="modal-overlay"></div>
            <div class="modal-content">
              <div class="modal-header">
                <h3 id="modal-title${suffix}"></h3>
                <button type="button" class="modal-close-btn" id="modal-close${suffix}" title="${vscode.l10n.t('Close')}" aria-label="${vscode.l10n.t('Close')}">
                  <span class="codicon codicon-close"></span>
                </button>
              </div>
              <div class="modal-body" id="modal-body${suffix}"></div>
            </div>
          </div>
          ` : ''}

          ${enablePagination ? `
          <div class="pagination-controls${data.length > 0 ? '' : ' hidden'}" id="pagination-controls${suffix}">
          <div class="pagination-info" id="pagination-info${suffix}"></div>
          <div class="pagination-buttons">
            <vscode-button id="first-page${suffix}" appearance="icon" aria-label="First page">
              <span class="codicon codicon-chevron-left"></span>
              <span class="codicon codicon-chevron-left"></span>
            </vscode-button>
            <vscode-button id="prev-page${suffix}" appearance="icon" aria-label="Previous page">
              <span class="codicon codicon-chevron-left"></span>
            </vscode-button>
            <div class="page-input-container">
              <span>Page</span>
              <input
                type="number"
                id="page-input${suffix}"
                min="1"
                style="width: 60px; padding: 4px 8px; background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); border-radius: 3px; color: var(--vscode-input-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); text-align: center;">
              <span id="total-pages-label${suffix}"></span>
            </div>
            <vscode-button id="next-page${suffix}" appearance="icon" aria-label="Next page">
              <span class="codicon codicon-chevron-right"></span>
            </vscode-button>
            <vscode-button id="last-page${suffix}" appearance="icon" aria-label="Last page">
              <span class="codicon codicon-chevron-right"></span>
              <span class="codicon codicon-chevron-right"></span>
            </vscode-button>
          </div>
        </div>
          ` : ''}

        <div class="empty-state${data.length > 0 ? ' hidden' : ''}" id="empty-state${suffix}">
          <p>${escapeHtml(emptyMessage)}</p>
        </div>
    </div>

    <script defer>
      (function() {
      // Use the global vscode API acquired by webviewToolkit
      // Note: This script runs after the footer script from webviewToolkit.ts

      // State management for table: ${id}
      let currentPage = ${currentPage};
      let currentSearchTerm = ${JSON.stringify(searchTerm)};
      const itemsPerPage = ${itemsPerPage};
      // Mutable: an incremental update carries a new match count (see 'updateTable').
      let totalItems = ${totalItems};
      const enableSearch = ${enableSearch};
      const enablePagination = ${enablePagination};

      // Get DOM elements
      const searchInput = document.getElementById('search-input${suffix}');
      const dataTable = document.getElementById('data-table${suffix}');
      const tableBody = document.getElementById('table-body${suffix}');
      const emptyState = document.getElementById('empty-state${suffix}');
      const subtitleInfo = document.getElementById('subtitle-info${suffix}');
      const searchIcon = document.getElementById('search-icon${suffix}');
      const searchStatus = document.getElementById('search-status${suffix}');
      const tableWrapper = document.getElementById('table-scroll-wrapper${suffix}');
      const paginationControls = document.getElementById('pagination-controls${suffix}');
      const paginationInfo = document.getElementById('pagination-info${suffix}');
      const pageInput = document.getElementById('page-input${suffix}');
      const totalPagesLabel = document.getElementById('total-pages-label${suffix}');
      const firstPageBtn = document.getElementById('first-page${suffix}');
      const prevPageBtn = document.getElementById('prev-page${suffix}');
      const nextPageBtn = document.getElementById('next-page${suffix}');
      const lastPageBtn = document.getElementById('last-page${suffix}');

      // Calculate total pages
      let totalPages = enablePagination ? Math.ceil(totalItems / itemsPerPage) : 1;

      // Fit the table to the visible area, keeping its horizontal scrollbar on screen.
      // Measured against the document (rect.top + scrollY) so scrolling the page does
      // not feed back into the computed height.
      const MIN_TABLE_VIEWPORT_HEIGHT = 200;
      const CONTAINER_BOTTOM_PADDING = 20;
      const PAGINATION_MARGIN_TOP = 16;

      function syncTableViewport() {
        if (!tableWrapper || tableWrapper.classList.contains('hidden')) return;

        const top = tableWrapper.getBoundingClientRect().top + window.scrollY;
        const below = paginationControls && !paginationControls.classList.contains('hidden')
          ? paginationControls.getBoundingClientRect().height + PAGINATION_MARGIN_TOP
          : 0;
        const available = window.innerHeight - top - below - CONTAINER_BOTTOM_PADDING;

        tableWrapper.style.maxHeight = Math.max(MIN_TABLE_VIEWPORT_HEIGHT, available) + 'px';
      }

      // Cells that never wrap (buttons, short values — see the stylesheet) would be
      // clipped by a column narrower than their single line, and the widths computed
      // when the page was generated cannot know how wide a rendered button or string
      // ends up being. So measure them here and grow the column — and the table with
      // it, so the wrapper still scrolls all the way to the widest cell.
      const baseColumnWidths = ${JSON.stringify(columnsArray.map(width => parseFloat(width)))};
      const CELL_PADDING_RIGHT = 16;
      let columnWidths = baseColumnWidths.slice();

      function forEachCell(row, callback) {
        Array.from(row.children).forEach((cell, index) => {
          if (index < columnWidths.length) callback(cell, index);
        });
      }

      function fitNoWrapColumns() {
        if (!dataTable || !tableBody) return;

        const rows = Array.from(tableBody.querySelectorAll('vscode-table-row'));
        if (!rows.length) return;

        rows.forEach(row => forEachCell(row, (cell, index) => {
          if (!cell.classList.contains('nowrap-cell') && !cell.querySelector('vscode-button, button')) return;

          // The content overflows the clipped cell, but it is still laid out: a range
          // over it measures the line the column actually has to fit.
          const range = document.createRange();
          range.selectNodeContents(cell);
          const contentRect = range.getBoundingClientRect();
          if (!contentRect.width) return;

          const needed = Math.ceil(contentRect.right - cell.getBoundingClientRect().left) + CELL_PADDING_RIGHT;
          if (needed > columnWidths[index]) columnWidths[index] = needed;
        }));

        // Nothing to widen, and no widening carried over from a previous page.
        if (columnWidths.every((width, index) => width === baseColumnWidths[index])) return;

        // Widths are written straight onto the cells rather than through the table's
        // own 'columns' property: that one converts them to percentages of the width
        // the table had before growing, which would leave the columns misaligned.
        // Rows are re-applied on every call, since an incremental update replaces
        // them with markup still carrying the generated widths.
        dataTable.style.minWidth = columnWidths.reduce((sum, width) => sum + width, 0) + 'px';
        dataTable.querySelectorAll('vscode-table-header-cell').forEach((cell, index) => {
          if (index < columnWidths.length) cell.style.width = columnWidths[index] + 'px';
        });
        rows.forEach(row => forEachCell(row, (cell, index) => {
          cell.style.width = columnWidths[index] + 'px';
        }));

        syncTableViewport();
      }

      syncTableViewport();
      // The vscode-* elements upgrade after this script runs and shift the table down.
      requestAnimationFrame(() => {
        syncTableViewport();
        fitNoWrapColumns();
      });
      window.addEventListener('load', () => {
        syncTableViewport();
        fitNoWrapColumns();
      });
      window.addEventListener('resize', syncTableViewport);

      // Busy indicator. Search and pagination are handled by the extension, which
      // answers with an 'updateTable' message; the indicator is cleared there. The
      // safety timeout only matters when no answer ever arrives (e.g. a query
      // error), which would otherwise leave the icon spinning forever.
      const BUSY_SAFETY_TIMEOUT = 15000;
      let busySafetyTimer;

      function setSearching(isBusy) {
        if (searchIcon) {
          searchIcon.classList.toggle('codicon-search', !isBusy);
          searchIcon.classList.toggle('codicon-loading', isBusy);
          searchIcon.classList.toggle('codicon-modifier-spin', isBusy);
        }
        if (searchStatus) {
          searchStatus.textContent = isBusy ? ${JSON.stringify(vscode.l10n.t("Searching..."))} : '';
        }
        if (tableWrapper) {
          tableWrapper.classList.toggle('is-busy', isBusy);
        }
        if (enablePagination) {
          [firstPageBtn, prevPageBtn, nextPageBtn, lastPageBtn].forEach(btn => {
            if (btn) btn.disabled = isBusy;
          });
          if (pageInput) pageInput.disabled = isBusy;
        }

        clearTimeout(busySafetyTimer);
        if (isBusy) {
          busySafetyTimer = setTimeout(() => {
            setSearching(false);
            updatePaginationDisplay();
          }, BUSY_SAFETY_TIMEOUT);
        }
      }

      // Search functionality - sends message to extension
      let searchTimeout;
      function performSearch(searchTerm) {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
          currentSearchTerm = searchTerm;
          currentPage = 1;
          const message = {
            command: 'search',
            searchTerm: searchTerm,
            page: 1,
            itemsPerPage: itemsPerPage
          };
          message.tableId = '${id}';
          vscode.postMessage(message);
        }, 500); // Debounce 500ms
      }

      // Pagination functionality - sends message to extension
      function changePage(newPage) {
        if (newPage < 1 || newPage > totalPages) return;
        currentPage = newPage;
        setSearching(true);
        const message = {
          command: 'paginate',
          searchTerm: currentSearchTerm,
          page: newPage,
          itemsPerPage: itemsPerPage
        };
        message.tableId = '${id}';
        vscode.postMessage(message);
      }

      // Update pagination display
      function updatePaginationDisplay() {
        if (enablePagination && paginationInfo) {
          const displayStart = totalItems > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0;
          const displayEnd = Math.min(currentPage * itemsPerPage, totalItems);
          paginationInfo.textContent = \`Showing \${displayStart}-\${displayEnd} of \${totalItems} items\`;

          if (pageInput) {
            pageInput.value = currentPage;
            pageInput.max = totalPages;
          }

          if (totalPagesLabel) {
            totalPagesLabel.textContent = \`of \${totalPages}\`;
          }

          // Update button states
          if (firstPageBtn) firstPageBtn.disabled = currentPage === 1;
          if (prevPageBtn) prevPageBtn.disabled = currentPage === 1;
          if (nextPageBtn) nextPageBtn.disabled = currentPage === totalPages || totalPages === 0;
          if (lastPageBtn) lastPageBtn.disabled = currentPage === totalPages || totalPages === 0;
        }
      }

      // Event listeners
      if (enableSearch && searchInput) {
        searchInput.addEventListener('input', (e) => {
          // Start the indicator on the keystroke, not when the debounce fires,
          // so the 500ms wait is not silent.
          setSearching(true);
          performSearch(e.target.value);
        });
      }

      if (enablePagination) {
        if (firstPageBtn) {
          firstPageBtn.addEventListener('click', () => {
            changePage(1);
          });
        }

        if (prevPageBtn) {
          prevPageBtn.addEventListener('click', () => {
            changePage(currentPage - 1);
          });
        }

        if (nextPageBtn) {
          nextPageBtn.addEventListener('click', () => {
            changePage(currentPage + 1);
          });
        }

        if (lastPageBtn) {
          lastPageBtn.addEventListener('click', () => {
            changePage(totalPages);
          });
        }

        if (pageInput) {
          pageInput.addEventListener('change', (e) => {
            const newPage = parseInt(e.target.value);
            if (newPage >= 1 && newPage <= totalPages) {
              changePage(newPage);
            } else {
              e.target.value = currentPage;
            }
          });
        }
      }

      // Initial display update
      updatePaginationDisplay();

      // Modal functionality for collapsible content
      // Mutable: replaced wholesale by an incremental update (see 'updateTable').
      let collapsibleDataArray = ${JSON.stringify(collapsibleData)};
      const modal = document.getElementById('collapsible-modal${suffix}');
      const modalTitle = document.getElementById('modal-title${suffix}');
      const modalBody = document.getElementById('modal-body${suffix}');
      const modalClose = document.getElementById('modal-close${suffix}');
      const modalOverlay = modal ? modal.querySelector('.modal-overlay') : null;

      function openModal(rowIndex, colIndex) {
        if (!modal || !modalTitle || !modalBody) return;

        const rowData = collapsibleDataArray[rowIndex];
        if (!rowData || rowData.length === 0) return;

        const item = rowData[colIndex];
        if (!item) return;

        // Helper function to escape HTML
        const escapeHtml = (text) => {
          const div = document.createElement('div');
          div.textContent = text;
          return div.innerHTML;
        };

        modalTitle.textContent = item.title;
        modalBody.innerHTML = \`<pre>\${escapeHtml(item.value || '')}</pre>\`;
        modal.style.display = 'flex';
      }

      function closeModal() {
        if (modal) {
          modal.style.display = 'none';
        }
      }

      // Show modal buttons. Delegated on the body, since the rows are replaced on
      // every update and per-button listeners would die with them.
      if (tableBody) {
        tableBody.addEventListener('click', (e) => {
          const button = e.target.closest('.show-modal-btn');
          if (!button) return;
          e.stopPropagation();
          const rowIndex = parseInt(button.getAttribute('data-row'));
          const colIndex = parseInt(button.getAttribute('data-col'));
          openModal(rowIndex, colIndex);
        });
      }

      // Close modal handlers
      if (modalClose) {
        modalClose.addEventListener('click', closeModal);
      }
      if (modalOverlay) {
        modalOverlay.addEventListener('click', closeModal);
      }

      // Close modal on Escape key
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal && modal.style.display === 'flex') {
          closeModal();
        }
      });

      // Incremental refresh: the extension answers search/pagination/auto-refresh
      // with new rows instead of a new page, so the search box is never recreated
      // and keeps both focus and whatever has been typed since the request went out.
      window.addEventListener('message', (event) => {
        const msg = event.data;
        if (!msg) return;
        if (msg.tableId !== '${id}') return;

        // The query failed: stop the indicator and keep the rows already on screen
        // (the extension surfaces the error itself).
        if (msg.command === 'updateTableFailed') {
          setSearching(false);
          updatePaginationDisplay();
          return;
        }

        if (msg.command !== 'updateTable') return;

        if (tableBody) {
          tableBody.innerHTML = msg.rowsHtml;
        }
        collapsibleDataArray = msg.collapsibleData || [];
        totalItems = msg.totalItems;
        currentPage = msg.currentPage;
        totalPages = enablePagination ? Math.ceil(totalItems / itemsPerPage) : 1;

        if (tableWrapper) {
          tableWrapper.classList.toggle('hidden', msg.rowCount === 0);
        }
        if (paginationControls) {
          paginationControls.classList.toggle('hidden', msg.rowCount === 0);
        }
        if (emptyState) {
          emptyState.classList.toggle('hidden', msg.rowCount > 0);
        }
        syncTableViewport();
        // The replaced rows carry the generated widths again; their buttons are only
        // measurable once laid out.
        requestAnimationFrame(fitNoWrapColumns);
        if (subtitleInfo && msg.subtitle !== undefined) {
          subtitleInfo.textContent = msg.subtitle;
        }

        // A row the modal was showing may no longer exist in the new page.
        closeModal();
        setSearching(false);
        updatePaginationDisplay();
      });

      // Custom script
      ${customScript}
      })();
    </script>
    </div>
  `;
  }

}
