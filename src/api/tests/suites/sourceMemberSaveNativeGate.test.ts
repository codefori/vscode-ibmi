import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
    default: {},
}));

import { consumeSourceMemberSaveAs, prepareNativeSaveAsSourceDates } from "../../../filesystems/qsys/sourceMemberSave";

describe("prepareNativeSaveAsSourceDates", () => {
    it("does not stage save-as source dates when useMapepireForSourceMemberSaves is disabled", async () => {
        const sourceUri = {
            scheme: "member",
            path: "/QGPL/QRPGLESRC/HELLO.RPGLE",
            toString: () => "member:/QGPL/QRPGLESRC/HELLO.RPGLE",
        } as any;

        const targetUri = {
            scheme: "member",
            path: "/QGPL/QRPGLESRC/HELLO2.RPGLE",
            toString: () => "member:/QGPL/QRPGLESRC/HELLO2.RPGLE",
        } as any;

        const prepared = await prepareNativeSaveAsSourceDates({
            useMapepireForSourceMemberSaves: false,
            activeDocument: {
                uri: sourceUri,
                getText: () => "line 1\nline 2",
            },
            targetUri,
            sourceDates: ["240101", "240102"],
        });

        expect(prepared).toBe(false);
        expect(consumeSourceMemberSaveAs(targetUri)).toBeUndefined();
    });

    it("stages save-as source dates when useMapepireForSourceMemberSaves is enabled", async () => {
        const sourceUri = {
            scheme: "member",
            path: "/QGPL/QRPGLESRC/HELLO.RPGLE",
            toString: () => "member:/QGPL/QRPGLESRC/HELLO.RPGLE",
        } as any;

        const targetUri = {
            scheme: "member",
            path: "/QGPL/QRPGLESRC/HELLO2.RPGLE",
            toString: () => "member:/QGPL/QRPGLESRC/HELLO2.RPGLE",
        } as any;

        const prepared = await prepareNativeSaveAsSourceDates({
            useMapepireForSourceMemberSaves: true,
            activeDocument: {
                uri: sourceUri,
                getText: () => "line 1\nline 2",
            },
            targetUri,
            sourceDates: ["240101", "240102"],
        });

        expect(prepared).toBe(true);

        const seeded = consumeSourceMemberSaveAs(targetUri);
        expect(seeded).toBeTruthy();
        expect(seeded?.body).toBe("line 1\nline 2");
        expect(seeded?.sourceDates).toEqual(["240101", "240102"]);
    });

    it("can lazily load source dates via callback when needed", async () => {
        const sourceUri = {
            scheme: "member",
            path: "/QGPL/QRPGLESRC/HELLO.RPGLE",
            toString: () => "member:/QGPL/QRPGLESRC/HELLO.RPGLE",
        } as any;

        const targetUri = {
            scheme: "member",
            path: "/QGPL/QRPGLESRC/HELLO3.RPGLE",
            toString: () => "member:/QGPL/QRPGLESRC/HELLO3.RPGLE",
        } as any;

        const readSourceDates = vi.fn().mockResolvedValue(["240201", "240202"]);

        const prepared = await prepareNativeSaveAsSourceDates({
            useMapepireForSourceMemberSaves: true,
            activeDocument: {
                uri: sourceUri,
                getText: () => "a\nb",
            },
            targetUri,
            readSourceDates,
        });

        expect(prepared).toBe(true);
        expect(readSourceDates).toHaveBeenCalledTimes(1);

        const seeded = consumeSourceMemberSaveAs(targetUri);
        expect(seeded?.sourceDates).toEqual(["240201", "240202"]);
    });
});
