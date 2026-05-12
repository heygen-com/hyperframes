export declare function buildRmsEnvelope(samples: Int16Array, windowSize?: number, hopSize?: number): number[];
export declare function compareAudioEnvelopes(rendered: number[], snapshot: number[], maxLagWindows: number): {
    correlation: number;
    lagWindows: number;
};
//# sourceMappingURL=audioRegression.d.ts.map