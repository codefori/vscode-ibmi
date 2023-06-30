export interface clDef {
    $: {
        DTDVersion: string;
    };
    Cmd: Array<clCommand>;
}

export interface clCommand {
    $: {
        CmdName: string;
        CmdLib: string;
        CCSID: string;
        Prompt?: string;
        PromptMsgID?: string;
        HlpPnlGrp?: string;
        HlpPnlGrpLib?: string;
        HlpID?: string;
        MaxPos?: string;
        CurLib?: string;
        PrdLib?: string;
        PmtOvrPgm?: string;
        PmtOvrLib?: string;
        MsgF?: string;
        MsgFLib?: string;
        PmtFile?: string;
        PmtFileLib?: string; 
        PmtFileMsg?: string; 
        ExecBatch: "YES" | "NO";
        ChgCmdExit: "YES" | "NO"; 
        RtvCmdExit: "YES" | "NO"; 
    }
    Parm: Array<clParm>;
    Dep?: Array<clDep>;
}

export interface clParm {
    $: {
        Kwd: string;
        Type: string;
        Min?: string;
        Max?: string;
        PmtCtlPgm?: string;
        PmtCtlLib?: string;
        PmtCtl?: string;
        KeyParm?:  "YES" | "NO";
        PosNbr?: string;
        Prompt?: string;
        PromptMsgID?: string;
        Len?: string;
        Dft?: string;
        Constant?: string;
        Rel?: string;
        RelVal?: string;
        RelKwd?: string;
        RangeMinKwd?: string;
        RangeMaxKwd?: string;
        RangeMinVal?: string;
        RangeMaxVal?: string;
        DspInput?: string;
        ChoiceMsgID?: string;
        ChoicePgm?: string;
        ChoiceLib?: string;
        Rstd?: "YES" | "NO";
        Full?: "YES" | "NO";
        AlwUnprt?: "YES" | "NO";
        AlwVar?: "YES" | "NO";
        Expr?: "YES" | "NO";
        IsDtaAra?: "YES" | "NO";
        IsFile?: string;
        IsPgm?: "YES" | "NO";
        Vary?: string;
        ListDspl?: string;
        PassAtr?: "YES" | "NO";
        Case?: string;
        CCSID?: string;
        InlPmtLen?: string;
        RtnVal?: "YES" | "NO";
        PassVal?: string;
        Choice?: string;
    }
    Elem?: Array<clElem>;
    Qual?: Array<clQual>;
    PmtCtl?: Array<clPmtCtl>;
    Values?: Array<clValues>;
    SngVal?: Array<clSngVal>;
    SpcVal?: Array<clSpcVal>;
    ChoicePgmText?: Array<clChoicePgmText>;
    ChoicePgmValues?: Array<clChoicePgmValues>;
}

export interface clElem {
    $: {
        Type: string;
        Max?: string;
        Prompt?: string;
        PromptMsgID?: string;
        Len?: string;
        Min?: string;
        Dft?: string;
        Constant?: string;
        Rel?: string;
        RelVal?: string;
        RangeMinVal?: string;
        RangeMaxVal?: string;
        DspInput?: string;
        ChoiceMsgID?: string;
        ChoicePgm?: string;
        ChoiceLib?: string;
        Rstd?:  "YES" | "NO";
        Full?:  "YES" | "NO";
        AlwUnprt?:  "YES" | "NO";
        AlwVar?:  "YES" | "NO";
        Expr?:  "YES" | "NO";
        IsDtaAra?:  "YES" | "NO";
        IsFile?: string;
        IsPgm?:  "YES" | "NO";
        Vary?: string;
        PassAtr?:  "YES" | "NO";
        Case?: string;
        CCSID?: string;
        InlPmtLen?: string;
        Choice?: string;
    }
    Elem?: Array<clElem>;
    Qual?: Array<clQual>;
    Values?: Array<clValues>;
    SngVal?: Array<clSngVal>;
    SpcVal?: Array<clSpcVal>;
    ChoicePgmText?: Array<clChoicePgmText>;
    ChoicePgmValues?: Array<clChoicePgmValues>;
}

export interface clQual {
    $: {
        Type: string;
        Prompt?: string;
        PromptMsgID?: string;
        Len?: string;
        Min?: string;
        Dft?: string;
        Constant?: string;
        Rel?: string;
        RelVal?: string;
        RangeMinVal?: string;
        RangeMaxVal?: string;
        DspInput?: string
        ChoiceMsgID?: string;
        ChoicePgm?: string;
        ChoiceLib?: string;
        Rstd?:  "YES" | "NO";
        Full?:  "YES" | "NO";
        AlwUnprt?:  "YES" | "NO";
        AlwVar?:  "YES" | "NO";
        Expr?:  "YES" | "NO";
        Vary?: string;
        PassAtr?:  "YES" | "NO";
        InlPmtLen?: string;
        Choice?: string;
    }
    Values?: Array<clValues>;
    SpcVal?: Array<clSpcVal>;
    ChoicePgmText?: Array<clChoicePgmText>;
    ChoicePgmValues?: Array<clChoicePgmValues>;
}

export interface clPmtCtl {
    $: {
        CtlKwd: string;
        NbrTrueRel: string;
        NbrTrue?: string;
        LglRel?: string;
    }
    PmtCtlCond?: Array<clPmtCtlCond>;
}

export interface clPmtCtlCond {
    $: {
        Rel?: string;
        CmpVal?: string;
    }
}

export interface clValue {
    $: {
        Val: string;
        MapTo?: string;
    }
}

export interface clValues {
    Value?: Array<clValue>;
}

export interface clSngVal {
    Value?: Array<clValue>;
}

export interface clSpcVal {
    Value?: Array<clValue>;
}

export interface clChoicePgmText {
    $: {
        Text: string;
    }
}

export interface clChoicePgmValues {
    Value?: Array<clValue>;
}

export interface clDep {
    $: {
        CtlKwdRel: string;
        CtlKwd?: string;
        CmpKwd?: string;
        CmpVal?: string;
        NbrTrueRel?: string;
        NbrTrue?: string;
        MsgID?: string;
    }
    DepParm: Array<clDepParm>;
}

export interface clDepParm {
    $: {
        Kwd: string
        Rel: string
        CmpKwd?: string
        CmpVal?: string
    }
}