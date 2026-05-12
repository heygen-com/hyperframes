/**
 * Audio Extractor Service
 *
 * Extracts audio from media elements in the composition HTML,
 * applies timeline positioning, and mixes into a single audio track.
 */
export interface AudioElement {
    id: string;
    src: string;
    start: number;
    duration: number;
    mediaStart: number;
    volume: number;
    tagName: "audio" | "video";
}
export interface AudioTrack {
    id: string;
    srcPath: string;
    start: number;
    duration: number;
    mediaStart: number;
    volume: number;
}
/**
 * Parse audio/video elements from HTML to find media with audio.
 */
export declare function parseAudioElements(html: string): AudioElement[];
/**
 * Process all audio for a composition.
 *
 * @param htmlPath - Path to the composition HTML (for parsing media elements)
 * @param projectDir - Base directory for resolving relative media paths
 * @param workDir - Temporary working directory for intermediate files
 * @param outputPath - Final mixed audio output path
 * @param totalDuration - Total composition duration in seconds
 * @returns true if audio was produced, false if no audio elements found
 */
export declare function processAudio(htmlPath: string, projectDir: string, workDir: string, outputPath: string, totalDuration: number): Promise<boolean>;
//# sourceMappingURL=audioExtractor.d.ts.map