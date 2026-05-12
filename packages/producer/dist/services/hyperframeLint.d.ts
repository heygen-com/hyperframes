import { type HyperframeLintResult } from "@hyperframes/core/lint";
export interface PreparedHyperframeLintInput {
    entryFile: string;
    html: string;
    source: "projectDir" | "files" | "html";
}
export declare function prepareHyperframeLintBody(body: Record<string, unknown>): {
    prepared: PreparedHyperframeLintInput;
} | {
    error: string;
};
export declare function runHyperframeLint(prepared: PreparedHyperframeLintInput): HyperframeLintResult;
//# sourceMappingURL=hyperframeLint.d.ts.map