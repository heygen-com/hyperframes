export function creditLimit(projectDir: string): number | undefined;
export function creditsSpent(projectDir: string): { total: number; keys: Set<string> };
export function refuseUnderLimit(projectDir: string, what: string, generateType: string): void;
