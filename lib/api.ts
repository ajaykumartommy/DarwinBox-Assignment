export type ApiEscalation = { id: string; record_key: string; title: string; detail: string; confidence: number; status: string };
export type ApiAuditEvent = { event_type: string; detail: string; actor: string; created_at: string };
export type ApiRecord = { id: string; key: string; payload: Record<string, string>; status: string };
export type ApiMapping = { id: string; source_field: string; target_field: string; confidence: number; reason: string; status: string };
export type RunSnapshot = { id: string; status: string; metrics: { source_records: number; ready_records: number; open_escalations: number }; records: ApiRecord[]; mappings: ApiMapping[]; escalations: ApiEscalation[]; deliveries: Array<{ attempts: number; status: string }>; events: ApiAuditEvent[] };

const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { detail?: string };
    throw new Error(body.detail ?? 'The migration service could not complete that action.');
  }
  return response.json() as Promise<T>;
}

export const createDemoMigration = () => request<RunSnapshot>('/api/runs/demo', { method: 'POST' });

export const uploadMigration = (files: File[]) => {
  const data = new FormData();
  files.forEach((file) => data.append('files', file));
  return request<RunSnapshot>('/api/runs/upload', { method: 'POST', body: data });
};

export const resolveMigrationEscalation = (runId: string, escalationId: string, action: 'approve' | 'exclude' | 'edit', note = '') =>
  request<RunSnapshot>(`/api/runs/${runId}/escalations/${escalationId}/resolve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, note, actor: 'Alex Singh' }) });

export const deliverMigration = (runId: string) => request<RunSnapshot>(`/api/runs/${runId}/deliver`, { method: 'POST' });

export const rollbackMigration = (runId: string) => request<RunSnapshot>(`/api/runs/${runId}/rollback`, { method: 'POST' });
