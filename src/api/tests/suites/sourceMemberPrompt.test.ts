import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
    default: {
        window: {
            createWebviewPanel: vi.fn(),
        },
        ViewColumn: {
            One: 1,
        },
    },
    window: {
        createWebviewPanel: vi.fn(),
    },
    ViewColumn: {
        One: 1,
    },
}));

vi.mock('../../../instantiate', () => ({
    instance: {
        getConnection: vi.fn(),
    }
}));

import { normalizeSourceMemberPromptData } from '../../../filesystems/qsys/sourceMemberPromptUtils';

describe('normalizeSourceMemberPromptData', () => {
    it('should trim and uppercase the values and build a compatible member path', () => {
        const result = normalizeSourceMemberPromptData({
            sourceFile: ' qrpglesrc ',
            library: ' mylib ',
            member: ' myprog '
        });

        expect(result).toEqual({
            sourceFile: 'QRPGLESRC',
            library: 'MYLIB',
            member: 'MYPROG',
            sourceType: '',
            keepExistingChangeDates: true,
            path: 'MYLIB/QRPGLESRC/MYPROG'
        });
    });

    it('should cap each value at ten characters and strip invalid characters', () => {
        const result = normalizeSourceMemberPromptData({
            sourceFile: ' qrp*glesrc ',
            library: 'mylib$library',
            member: 'clle/member'
        });

        expect(result.sourceFile).toBe('QRPGLESRC');
        expect(result.library).toBe('MYLIB$LIBR');
        expect(result.member).toBe('CLLEMEMBER');
        expect(result.keepExistingChangeDates).toBe(true);
        expect(result.path).toBe('MYLIB$LIBR/QRPGLESRC/CLLEMEMBER');
    });

    it('should keep keepExistingChangeDates false when explicitly provided', () => {
        const result = normalizeSourceMemberPromptData({
            sourceFile: 'qrpglesrc',
            library: 'mylib',
            member: 'myprog',
            keepExistingChangeDates: false
        });

        expect(result.keepExistingChangeDates).toBe(false);
    });

    it('should normalize the member source type when provided', () => {
        const result = normalizeSourceMemberPromptData({
            sourceFile: 'qrpglesrc',
            library: 'mylib',
            member: 'myprog',
            sourceType: ' clle '
        });

        expect(result.sourceType).toBe('CLLE');
        expect(result.path).toBe('MYLIB/QRPGLESRC/MYPROG');
    });
});
