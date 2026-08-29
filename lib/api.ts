export type ApiEscalation = { id: string; record_key: string; title: string; detail: string; confidence: number; status: string };
export type RunSnapshot = { id: string; status: string; metrics: { source_records: number; ready_records: number; open_escalations: number }; escalations: ApiEscalation[]; deliveries: Array<{ attempts: number; status: string }> };

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

export const resolveMigrationEscalation = (runId: string, escalationId: string, action: 'approve' | 'exclude') =>
  request<RunSnapshot>(`/api/runs/${runId}/escalations/${escalationId}/resolve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, actor: 'Alex Singh' }) });

export const deliverMigration = (runId: string) => request<RunSnapshot>(`/api/runs/${runId}/deliver`, { method: 'POST' });
