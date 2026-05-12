export type ResolvedHyperframeRuntime = {
    manifestPath: string;
    runtimePath: string;
    expectedSha256: string;
    actualSha256: string;
    runtimeSource: string;
};
export declare function resolveHyperframeManifestPath(): string;
export declare function getVerifiedHyperframeRuntimeSource(): string;
export declare function resolveVerifiedHyperframeRuntime(): ResolvedHyperframeRuntime;
//# sourceMappingURL=hyperframeRuntimeLoader.d.ts.map