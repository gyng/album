export type DatabaseRequest =
  | { type: "open"; url: string; fallbackUrl?: string; forceRefresh: boolean }
  | { type: "exec"; id: number; sql: string; bind: (string | number)[] };
export type DatabaseResponse =
  | { type: "progress"; percent: number; details: { loaded: number; total: number } }
  | { type: "ready"; metadataColumns: string[] }
  | { type: "result"; id: number; rows: unknown[][] }
  | { type: "error"; id?: number; message: string };
