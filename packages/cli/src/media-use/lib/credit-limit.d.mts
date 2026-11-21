export function creditLimit(projectDir: string): number | undefined;
export function creditsSpent(projectDir: string): { total: number; keys: Map<string, number> };
export function refuseUnderLimit(projectDir: string, what: string, generateType: string): void;
