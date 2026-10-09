export function rankMediaRows<
  T extends {
    id: string;
    kind: string;
    title: string;
    description: string;
    tags: string[];
  },
>(query: string, rows: T[]): T[];
