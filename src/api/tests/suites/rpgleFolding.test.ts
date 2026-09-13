import { describe, expect, it } from 'vitest';
import { parseBlockFoldingRanges } from '../../../languages/rpgle/foldingRanges';

describe('RPGLE procedure folding', { concurrent: true }, () => {
  it('keeps end-proc visible when folding a procedure', () => {
    const source = [
      'dcl-proc GetCurrentUser;',
      '  dcl-pi *n varchar(50); end-pi;',
      '',
      '  return user;',
      'end-proc;',
      ''
    ];

    expect(parseBlockFoldingRanges(source)).toEqual([
      {
        start: 0,
        end: 3
      }
    ]);
  });

  it('ignores procedures with no foldable body before end-proc', () => {
    const source = [
      'dcl-proc EmptyProc;',
      'end-proc;'
    ];

    expect(parseBlockFoldingRanges(source)).toEqual([]);
  });

  it('keeps end-pi visible when folding a procedure interface', () => {
    const source = [
      'dcl-pi *n packed(9:2);',
      '  leftValue packed(9:2) const;',
      '  rightValue packed(9:2) const;',
      'end-pi;'
    ];

    expect(parseBlockFoldingRanges(source)).toEqual([
      {
        start: 0,
        end: 2
      }
    ]);
  });

  it('keeps endif and endsl visible for nested control blocks', () => {
    const source = [
      'select;',
      '  when condition1;',
      '    if flag;',
      '      dsply ''A'';',
      '    endif;',
      'endsl;'
    ];

    expect(parseBlockFoldingRanges(source)).toEqual([
      {
        start: 0,
        end: 4
      },
      {
        start: 2,
        end: 3
      }
    ]);
  });

  it('does not treat sql select as an RPG select block', () => {
    const source = [
      'exec sql',
      '  select current user',
      '    into :result',
      '  from sysibm.sysdummy1;',
      'select;',
      '  when hasValue;',
      '    dsply ''ok'';',
      'endsl;'
    ];

    expect(parseBlockFoldingRanges(source)).toEqual([
      {
        start: 4,
        end: 6
      }
    ]);
  });
});