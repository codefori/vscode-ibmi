export type LineFoldingRange = {
  start: number;
  end: number;
};

type BlockDefinition = {
  start: string;
  end: string[];
};

type OpenBlock = {
  startLine: number;
  definition: BlockDefinition;
};

const blockDefinitions: BlockDefinition[] = [
  { start: `if`, end: [`endif`, `end`] },
  { start: `ifeq`, end: [`endif`, `end`] },
  { start: `ifge`, end: [`endif`, `end`] },
  { start: `ifgt`, end: [`endif`, `end`] },
  { start: `ifle`, end: [`endif`, `end`] },
  { start: `iflt`, end: [`endif`, `end`] },
  { start: `ifne`, end: [`endif`, `end`] },
  { start: `dow`, end: [`enddo`, `end`] },
  { start: `doweq`, end: [`enddo`, `end`] },
  { start: `dowge`, end: [`enddo`, `end`] },
  { start: `dowgt`, end: [`enddo`, `end`] },
  { start: `dowle`, end: [`enddo`, `end`] },
  { start: `dowlt`, end: [`enddo`, `end`] },
  { start: `downe`, end: [`enddo`, `end`] },
  { start: `dou`, end: [`enddo`, `end`] },
  { start: `doueq`, end: [`enddo`, `end`] },
  { start: `douge`, end: [`enddo`, `end`] },
  { start: `dougt`, end: [`enddo`, `end`] },
  { start: `doule`, end: [`enddo`, `end`] },
  { start: `doult`, end: [`enddo`, `end`] },
  { start: `doune`, end: [`enddo`, `end`] },
  { start: `do`, end: [`enddo`, `end`] },
  { start: `select`, end: [`endsl`, `end`] },
  { start: `for`, end: [`endfor`, `end`] },
  { start: `for-each`, end: [`endfor`, `end`] },
  { start: `begsr`, end: [`endsr`] },
  { start: `monitor`, end: [`endmon`] },
  { start: `dcl-ds`, end: [`end-ds`] },
  { start: `dcl-proc`, end: [`end-proc`] },
  { start: `dcl-pr`, end: [`end-pr`] },
  { start: `dcl-pi`, end: [`end-pi`] }
];

const startDefinitionByToken = new Map(blockDefinitions.map(definition => [definition.start, definition]));
const closingTokens = new Set(blockDefinitions.flatMap(definition => definition.end));

function getLeadingToken(line: string): string | undefined {
  const trimmedLine = line.trim();

  if (!trimmedLine || trimmedLine.startsWith(`//`)) {
    return undefined;
  }

  const tokenMatch = trimmedLine.match(/^[a-z][a-z0-9-]*/i);
  return tokenMatch?.[0].toLowerCase();
}

function findMatchingOpenBlock(openBlocks: OpenBlock[], closingToken: string): OpenBlock | undefined {
  const lastOpenBlock = openBlocks[openBlocks.length - 1];

  if (lastOpenBlock?.definition.end.includes(closingToken)) {
    return openBlocks.pop();
  }

  return undefined;
}

export function parseBlockFoldingRanges(lines: string[]): LineFoldingRange[] {
  const ranges: LineFoldingRange[] = [];
  const openBlocks: OpenBlock[] = [];
  let inExecSqlBlock = false;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const trimmedLine = line.trim().toLowerCase();

    if (inExecSqlBlock) {
      if (trimmedLine.includes(`;`)) {
        inExecSqlBlock = false;
      }

      continue;
    }

    if (/^exec\s+sql\b/i.test(trimmedLine)) {
      if (!trimmedLine.includes(`;`)) {
        inExecSqlBlock = true;
      }

      continue;
    }

    const token = getLeadingToken(line);

    if (!token) {
      continue;
    }

    const openingDefinition = startDefinitionByToken.get(token);

    if (openingDefinition) {
      openBlocks.push({
        startLine: lineIndex,
        definition: openingDefinition
      });
      continue;
    }

    if (closingTokens.has(token)) {
      const openBlock = findMatchingOpenBlock(openBlocks, token);

      if (openBlock && lineIndex - 1 > openBlock.startLine) {
        ranges.push({
          start: openBlock.startLine,
          end: lineIndex - 1
        });
      }
    }
  }

  return ranges.sort((left, right) => left.start - right.start || left.end - right.end);
}

export const parseProcedureFoldingRanges = parseBlockFoldingRanges;