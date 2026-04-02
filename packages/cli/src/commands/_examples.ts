/**
 * Shared type for CLI command examples.
 * Each command file exports `examples` using this type.
 * help.ts dynamically imports them at --help time.
 */
export type Example = [comment: string, command: string];
