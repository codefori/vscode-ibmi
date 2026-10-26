export interface SourceMemberPromptInput {
    library?: string;
    sourceFile?: string;
    member?: string;
    sourceType?: string;
    keepExistingChangeDates?: boolean;
}

export interface SourceMemberPromptResult extends Required<SourceMemberPromptInput> {
    path: string;
}

function sanitizeSourceMemberSegment(value: string | undefined): string {
    return String(value ?? "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9_#$@]/g, "")
        .slice(0, 10);
}

export function normalizeSourceMemberPromptData(input: SourceMemberPromptInput = {}): SourceMemberPromptResult {
    const library = sanitizeSourceMemberSegment(input.library);
    const sourceFile = sanitizeSourceMemberSegment(input.sourceFile);
    const member = sanitizeSourceMemberSegment(input.member);
    const sourceType = sanitizeSourceMemberSegment(input.sourceType);

    return {
        library,
        sourceFile,
        member,
        sourceType,
        keepExistingChangeDates: input.keepExistingChangeDates !== false,
        path: [library, sourceFile, member].filter(Boolean).join(`/`),
    };
}
