'use client';

import { useMemo, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { createDemoMigration, deliverMigration, resolveMigrationEscalation, rollbackMigration, uploadMigration } from '../lib/api';
import type { ApiAuditEvent, ApiMapping, ApiRecord } from '../lib/api';

type View = 'overview' | 'dataset' | 'mapping' | 'escalations' | 'delivery' | 'audit';
type Resolution = 'open' | 'approved' | 'rejected';

type Escalation = {
  id: string;
  title: string;
  detail: string;
  record: string;
  confidence: number;
  resolution: Resolution;
};

const nav: Array<{ id: View; label: string; icon: string }> = [
  { id: 'overview', label: 'Migration run', icon: '◉' },
  { id: 'dataset', label: 'Source data', icon: '▦' },
  { id: 'mapping', label: 'Field mapping', icon: '⇄' },
  { id: 'escalations', label: 'Review queue', icon: '!' },
  { id: 'delivery', label: 'Target delivery', icon: '↑' },
  { id: 'audit', label: 'Audit trail', icon: '≡' },
];

const activities = [
  ['09:42:14', 'Ingested', 'northstar_people.csv · 24 records'],
  ['09:42:16', 'Ingested', 'benefits_export.xlsx · 18 records'],
  ['09:42:19', 'Mapped', '11 fields matched to the target schema'],
  ['09:42:21', 'Cleaned', 'Normalized 19 date values and 7 phone numbers'],
  ['09:42:23', 'Merged', '4 safe duplicates consolidated'],
  ['09:42:25', 'Escalated', '3 cases need a human decision'],
];

const mappings: Array<[string, string, string, string]> = [
  ['employee_id', 'employeeNumber', 'Exact header match', '100%'],
  ['first_name', 'given_name', 'Semantic + value profile', '98%'],
  ['last_name', 'family_name', 'Semantic + value profile', '97%'],
  ['work_email', 'email', 'Format match', '99%'],
  ['start_date', 'joined_on', 'Date profile', '96%'],
  ['department', 'team_name', 'Label similarity', '91%'],
];

const records = [
  { name: 'Aisha Patel', id: 'EMP-1042', state: 'Ready', note: 'Normalized start date' },
  { name: 'Marcus Chen', id: 'EMP-1047', state: 'Review', note: 'Ambiguous “Location” field' },
  { name: 'Nora Williams', id: 'EMP-1051', state: 'Ready', note: 'Merged duplicate record' },
  { name: 'Diego Romero', id: 'EMP-1054', state: 'Review', note: 'Missing work email' },
];

const initialEscalations: Escalation[] = [
  {
    id: 'E-203',
    title: 'Map “Location” to a target field',
    detail: 'Values look like city names, but the target supports both work_location and legal_entity.',
    record: 'Marcus Chen · EMP-1047',
    confidence: 62,
    resolution: 'open',
  },
  {
    id: 'E-204',
    title: 'Resolve conflicting start dates',
    detail: 'Two source files disagree: 14/03/2022 vs 2022-03-21. Neither source is authoritative.',
    record: 'Priya Shah · EMP-1063',
    confidence: 44,
    resolution: 'open',
  },
  {
    id: 'E-205',
    title: 'Confirm empty manager value',
    detail: 'The record has no manager in either source. This is valid for executive roles but cannot be inferred here.',
    record: 'Diego Romero · EMP-1054',
    confidence: 72,
    resolution: 'open',
  },
];

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warning' | 'blue' }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{children}</section>;
}

function SectionTitle({ eyebrow, title, body, action }: { eyebrow?: string; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="section-title">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {body && <p className="subtitle">{body}</p>}
      </div>
      {action}
    </div>
  );
}

export default function Home() {
  const [view, setView] = useState<View>('overview');
  const [runState, setRunState] = useState<'ready' | 'running' | 'complete'>('ready');
  const [escalations, setEscalations] = useState(initialEscalations);
  const [pushState, setPushState] = useState<'idle' | 'sending' | 'complete'>('idle');
  const [notice, setNotice] = useState('');
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [serverMetrics, setServerMetrics] = useState<{ source_records: number; ready_records: number } | null>(null);
  const [auditEvents, setAuditEvents] = useState<ApiAuditEvent[]>([]);
  const [apiRecords, setApiRecords] = useState<ApiRecord[]>([]);
  const [apiMappings, setApiMappings] = useState<ApiMapping[]>([]);

  const openEscalations = escalations.filter((item) => item.resolution === 'open');
  const resolvedCount = escalations.length - openEscalations.length;
  const readyForPush = openEscalations.length === 0;
  const recordsReady = serverMetrics?.ready_records ?? 24 - openEscalations.length;
  const sourceRecords = serverMetrics?.source_records ?? 42;
  const stage = runState === 'complete' ? 4 : runState === 'running' ? 3 : 3;

  const summary = useMemo(() => {
    if (pushState === 'complete') return 'Validated records delivered · 1 transient target response retried successfully';
    if (readyForPush) return 'All review decisions are complete. Ready to deliver.';
    return `${openEscalations.length} decisions need review before delivery.`;
  }, [pushState, readyForPush, openEscalations.length]);

  function applyServerRun(serverRun: { id: string; metrics: { source_records: number; ready_records: number }; events: ApiAuditEvent[]; records: ApiRecord[]; mappings: ApiMapping[]; escalations: Array<{ id: string; title: string; detail: string; record_key: string; confidence: number; status: string }> }) {
    setRunId(serverRun.id);
    setServerMetrics(serverRun.metrics);
    setAuditEvents(serverRun.events);
    setApiRecords(serverRun.records);
    setApiMappings(serverRun.mappings);
    setEscalations(serverRun.escalations.map((item) => ({ id: item.id, title: item.title, detail: item.detail, record: item.record_key, confidence: item.confidence, resolution: item.status === 'open' ? 'open' : item.status === 'approved' ? 'approved' : 'rejected' })));
  }

  async function beginRun() {
    setRunState('running');
    try {
      const serverRun = selectedFiles.length ? await uploadMigration(selectedFiles) : await createDemoMigration();
      applyServerRun(serverRun);
      setRunState('complete');
      setNotice(`Server-side analysis completed for ${serverRun.metrics.source_records} records. Safe transformations were applied automatically.`);
    } catch (error) {
      setRunState('ready');
      setNotice(error instanceof Error ? error.message : 'Could not reach the migration API. Start the backend and try again.');
    }
  }

  async function resolveEscalation(id: string, resolution: Exclude<Resolution, 'open'>, correction = '') {
    try {
      if (runId) applyServerRun(await resolveMigrationEscalation(runId, id, correction ? 'edit' : resolution === 'approved' ? 'approve' : 'exclude', correction));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not save that decision.');
      return;
    }
    setEscalations((current) => current.map((item) => item.id === id ? { ...item, resolution } : item));
    setNotice(resolution === 'approved' ? 'Decision applied and recorded in the audit trail.' : 'Record excluded from this migration and recorded in the audit trail.');
  }

  function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const names = Array.from(event.target.files ?? []).map((file) => file.name);
    if (names.length) {
      setUploadedFiles(names);
      setSelectedFiles(Array.from(event.target.files ?? []));
      setNotice(`${names.length} source file${names.length > 1 ? 's' : ''} added. The demo dataset remains available for a guided walkthrough.`);
    }
  }

  async function pushToTarget() {
    if (pushState === 'complete') {
      setView('delivery');
      setNotice('Delivery results are shown below. The complete target response remains in the audit trail.');
      return;
    }
    if (!readyForPush) {
      setView('escalations');
      setNotice('Resolve the remaining review decisions before delivering data.');
      return;
    }
    setPushState('sending');
    setNotice('Sending validated records to the target API…');
    try {
      if (!runId) throw new Error('Run the server-side analysis before delivering data.');
      const result = await deliverMigration(runId);
      applyServerRun(result);
      setPushState('complete');
      setNotice(`Delivery complete. ${result.deliveries.filter((item: { attempts: number }) => item.attempts > 1).length} transient target error was retried successfully.`);
    } catch (error) {
      setPushState('idle');
      setNotice(error instanceof Error ? error.message : 'Could not deliver the records.');
    }
  }

  async function shareRun() {
    const summary = `migrateIQ run ${runId ?? 'draft'}: ${sourceRecords} source records, ${openEscalations.length} open review decisions.`;
    try { await navigator.clipboard.writeText(summary); setNotice('Run summary copied to your clipboard.'); }
    catch { setNotice(summary); }
  }

  async function rollbackTarget() {
    if (!runId) {
      setNotice('Run the server-side analysis before attempting a rollback.');
      return;
    }
    try {
      applyServerRun(await rollbackMigration(runId));
      setPushState('idle');
      setNotice('Mock target deliveries were rolled back and the action was added to the audit trail.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not roll back the target deliveries.');
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">m</span><span>migrate<span>IQ</span></span></div>
        <div className="workspace-switcher"><span className="workspace-dot">N</span><span><b>Northstar HR</b><small>Implementation workspace</small></span><span className="chevron">⌄</span></div>
        <nav aria-label="Migration navigation">
          <p className="nav-label">WORKSPACE</p>
          {nav.map((item) => (
            <button key={item.id} className={`nav-item ${view === item.id ? 'active' : ''}`} onClick={() => setView(item.id)}>
              <span className="nav-icon">{item.icon}</span>{item.label}
              {item.id === 'escalations' && openEscalations.length > 0 && <span className="nav-count">{openEscalations.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="help"><span>?</span><div><b>Need help?</b><small>Open the runbook</small></div></div>
          <div className="profile"><span className="avatar">AS</span><div><b>Alex Singh</b><small>Implementation lead</small></div><span>•••</span></div>
        </div>
      </aside>

      <div className="main-area">
        <header className="topbar">
          <div className="breadcrumbs">Workspaces <span>/</span> Northstar HR <span>/</span> <b>Employee migration</b></div>
          <div className="top-actions"><button className="icon-button" aria-label="Notifications" onClick={() => setNotice('There are no unread migration notifications.')}>♧</button><button className="icon-button" aria-label="Help" onClick={() => setNotice('Use Run analysis, resolve the review queue, then push the validated records to the mock target.')}>?</button><button className="share-button" onClick={shareRun}>Share run</button></div>
        </header>

        <div className="content">
          {notice && <div className="notice" role="status"><span>✓</span>{notice}<button aria-label="Dismiss" onClick={() => setNotice('')}>×</button></div>}
          {view === 'overview' && <Overview stage={stage} sourceRecords={sourceRecords} recordsReady={recordsReady} openEscalations={openEscalations} runState={runState} pushState={pushState} summary={summary} onBegin={beginRun} onNavigate={setView} onPush={pushToTarget} />}
          {view === 'dataset' && <Dataset files={uploadedFiles} onFiles={onFiles} recordsReady={recordsReady} sourceRecords={sourceRecords} apiRecords={apiRecords} />}
          {view === 'mapping' && <Mapping onNotice={setNotice} apiMappings={apiMappings} />}
          {view === 'escalations' && <EscalationQueue items={escalations} onResolve={resolveEscalation} resolved={resolvedCount} />}
          {view === 'delivery' && <Delivery ready={readyForPush} state={pushState} onPush={pushToTarget} onRollback={rollbackTarget} />}
          {view === 'audit' && <Audit items={escalations} events={auditEvents} />}
        </div>
      </div>
    </main>
  );
}

function Overview({ stage, sourceRecords, recordsReady, openEscalations, runState, pushState, summary, onBegin, onNavigate, onPush }: { stage: number; sourceRecords: number; recordsReady: number; openEscalations: Escalation[]; runState: string; pushState: string; summary: string; onBegin: () => void; onNavigate: (view: View) => void; onPush: () => void }) {
  return <>
    <SectionTitle eyebrow="EMPLOYEE MIGRATION · RUN #042" title="Migration command center" body="A supervised path from messy source exports to a validated target payload." action={<div className="header-actions"><Badge tone="good"><span className="pulse" />{runState === 'running' ? 'Agent working' : 'Agent ready'}</Badge><button className="primary-button" onClick={onBegin} disabled={runState === 'running'}>{runState === 'running' ? <><span className="spinner" aria-hidden="true" />Analyzing…</> : runState === 'complete' ? 'Re-run analysis' : 'Run analysis'} {runState !== 'running' && <span>→</span>}</button></div>} />
    <Card className="run-card">
      <div className="run-top"><div><div className="run-title"><span className="run-icon">✦</span><div><h2>Employee data migration</h2><p>Created today at 09:42 · 2 source files · Target: DarwinBox sandbox</p></div></div></div><Badge tone={pushState === 'complete' ? 'good' : 'blue'}>{pushState === 'complete' ? 'Delivered' : 'In review'}</Badge></div>
      <div className="progress-rail">
        {['Ingested', 'Standardized', 'Validated', 'Delivered'].map((label, index) => <div className="rail-step" key={label}><div className={`rail-dot ${index < stage ? 'done' : ''}`}>{index < stage ? '✓' : index + 1}</div><span>{label}</span>{index < 3 && <div className={`rail-line ${index < stage - 1 ? 'done' : ''}`} />}</div>)}
      </div>
      <div className="run-stats"><div><b>{sourceRecords}</b><span>source records</span></div><div><b>{recordsReady}</b><span>ready for target</span></div><div><b>4</b><span>duplicates consolidated</span></div><div><b className={openEscalations.length ? 'amber-text' : 'green-text'}>{openEscalations.length}</b><span>awaiting decisions</span></div></div>
    </Card>
    <div className="grid-two overview-grid">
      <Card><div className="card-heading"><div><p className="eyebrow">AUTONOMY REPORT</p><h2>What the agent handled</h2></div><button className="text-button" onClick={() => onNavigate('audit')}>View audit →</button></div><div className="handled-list"><div><span className="check">✓</span><div><b>Matched 11 source fields</b><p>Using header, value-format, and semantic evidence.</p></div><Badge tone="good">Safe</Badge></div><div><span className="check">✓</span><div><b>Standardized inconsistent data</b><p>Dates, phone formats, whitespace, and casing normalized.</p></div><Badge tone="good">Safe</Badge></div><div><span className="check">✓</span><div><b>Consolidated 4 duplicate records</b><p>Exact employee IDs with non-conflicting values only.</p></div><Badge tone="good">Safe</Badge></div></div><div className="boundary-note"><span>⌁</span><p><b>Autonomy boundary:</b> the agent only proceeds when evidence is strong and transformations are reversible. Ambiguity stays visible for review.</p></div></Card>
      <Card className="review-card"><div className="card-heading"><div><p className="eyebrow">HUMAN REVIEW</p><h2>Decisions waiting on you</h2></div><Badge tone={openEscalations.length ? 'warning' : 'good'}>{openEscalations.length ? `${openEscalations.length} open` : 'All clear'}</Badge></div>{openEscalations.length ? <div className="mini-escalations">{openEscalations.slice(0, 3).map(item => <button key={item.id} onClick={() => onNavigate('escalations')}><span className="warning-icon">!</span><span><b>{item.title}</b><small>{item.record}</small></span><span className="confidence">{item.confidence}%</span><span>→</span></button>)}</div> : <div className="empty-state"><span>✓</span><b>All human decisions are complete</b><p>The validated dataset is ready for delivery.</p></div>}<button className="secondary-wide" onClick={() => onNavigate('escalations')}>{openEscalations.length ? `Open review queue (${openEscalations.length})` : 'Review resolved decisions'} →</button></Card>
    </div>
    <div className="grid-two lower-grid"><Card><div className="card-heading"><div><p className="eyebrow">LIVE RUN LOG</p><h2>Agent activity</h2></div><span className="live-dot">Live</span></div><div className="activity-log">{activities.map(([time, type, detail], index) => <div key={time}><time>{time}</time><span className={`activity-icon ${type.toLowerCase()}`}>{index < 5 ? '✓' : '!'}</span><p><b>{type}</b> · {detail}</p></div>)}</div></Card><Card className="deliver-card"><p className="eyebrow">NEXT STEP</p><h2>{pushState === 'complete' ? 'Delivery is complete' : 'Deliver validated records'}</h2><p className="delivery-copy">{summary}</p><div className="target-box"><span className="target-logo">db</span><div><b>DarwinBox sandbox API</b><small>POST /v1/employees · idempotent upsert</small></div><Badge tone="neutral">Mock target</Badge></div><button className="primary-wide" onClick={onPush} disabled={pushState === 'sending'}>{pushState === 'sending' ? 'Sending records…' : pushState === 'complete' ? 'View delivery results' : 'Push to target'} <span>→</span></button><p className="small-note">Per-record status, retries, and payload changes are retained in the audit trail.</p></Card></div>
  </>;
}

function Dataset({ files, onFiles, recordsReady, sourceRecords, apiRecords }: { files: string[]; onFiles: (event: ChangeEvent<HTMLInputElement>) => void; recordsReady: number; sourceRecords: number; apiRecords: ApiRecord[] }) {
  const preview: Array<{ id: string; key: string; name: string; state: string; note: string } | { id: string; name: string; state: string; note: string }> = apiRecords.length ? apiRecords.map(row => ({ id: row.id, name: `${row.payload.given_name ?? ''} ${row.payload.family_name ?? ''}`.trim() || row.key, key: row.key, state: row.status === 'ready' ? 'Ready' : row.status === 'excluded' ? 'Excluded' : 'Review', note: row.status === 'ready' ? 'Passed server-side validation' : row.status === 'excluded' ? 'Excluded by reviewer' : 'Awaiting a review decision' })) : records;
  return <><SectionTitle eyebrow="SOURCE DATA" title="A unified employee dataset" body="The agent reconciles multiple exports into one reviewable source of truth." action={<label className="primary-button upload-label">Add source files <input aria-label="Add source files" type="file" multiple accept=".csv,.xlsx,.xls" onChange={onFiles} /></label>} /><div className="grid-two dataset-summary"><Card><p className="eyebrow">INGESTION</p><h2>{files.length ? `${files.length} newly selected file${files.length > 1 ? 's' : ''}` : '2 source files connected'}</h2><div className="file-list">{(files.length ? files : ['northstar_people.csv', 'benefits_export.xlsx']).map((file, index) => <div key={file}><span className="file-icon">{file.endsWith('csv') ? 'CSV' : 'XLS'}</span><div><b>{file}</b><small>{index === 0 ? 'Profiled by the backend' : 'Merged into the same entity'}</small></div><Badge tone="good">Profiled</Badge></div>)}</div></Card><Card><p className="eyebrow">QUALITY SNAPSHOT</p><h2>Records are being treated conservatively</h2><div className="quality-bars"><div><span>Ready for target</span><b>{recordsReady} / {sourceRecords}</b><i><em style={{ width: `${(recordsReady / sourceRecords) * 100}%` }} /></i></div><div><span>Needs review</span><b>{sourceRecords - recordsReady} / {sourceRecords}</b><i className="amber"><em style={{ width: `${((sourceRecords - recordsReady) / sourceRecords) * 100}%` }} /></i></div></div><p className="small-note">No records are silently discarded. Exclusions require a human decision and leave an audit entry.</p></Card></div><Card className="data-table-card"><div className="card-heading"><div><p className="eyebrow">CANONICAL RECORDS</p><h2>Employee preview</h2></div><Badge tone="neutral">{apiRecords.length || sourceRecords} records</Badge></div><div className="table-wrap"><table><thead><tr><th>Employee</th><th>Employee ID</th><th>Target status</th><th>Agent note</th></tr></thead><tbody>{preview.map(row => <tr key={row.id}><td><span className="person-initial">{row.name.split(' ').map(x => x[0]).join('')}</span><b>{row.name}</b></td><td>{'key' in row ? row.key : row.id}</td><td><Badge tone={row.state === 'Ready' ? 'good' : 'warning'}>{row.state}</Badge></td><td>{row.note}</td></tr>)}</tbody></table></div></Card></>;
}

function Mapping({ onNotice, apiMappings }: { onNotice: (message: string) => void; apiMappings: ApiMapping[] }) {
  const displayedMappings = apiMappings.length ? apiMappings.map(item => [item.source_field, item.target_field, item.reason, `${item.confidence}%`]) : mappings;
  return <><SectionTitle eyebrow="FIELD MAPPING" title="Evidence-led mapping, not black-box guessing" body="The agent combines header similarity, data type, and sample values; low-confidence mappings are never applied silently." action={<button className="secondary-button" onClick={() => { downloadJson('migration-field-mappings.json', displayedMappings); onNotice('Field mapping exported as JSON.'); }}>Export mapping</button>} /><Card className="mapping-intro"><span>✦</span><div><b>{displayedMappings.length} mappings are ready to apply</b><p>Each decision includes explainable evidence and a confidence score. You can override any mapping before delivery.</p></div><Badge tone="good">Server profiled</Badge></Card><Card className="mapping-table"><div className="table-wrap"><table><thead><tr><th>Source field</th><th></th><th>Target field</th><th>Why this mapping is safe</th><th>Confidence</th><th></th></tr></thead><tbody>{displayedMappings.map(([source, target, evidence, confidence]) => <tr key={`${source}-${target}`}><td><code>{source}</code></td><td className="arrow-cell">→</td><td><code className="target-code">{target}</code></td><td>{evidence}</td><td><span className="confidence-score">{confidence}</span></td><td><button className="row-button" onClick={() => onNotice(`${source} → ${target}: ${evidence}. Confidence ${confidence}.`)}>Explain</button></td></tr>)}</tbody></table></div></Card><div className="mapping-foot"><span>⌁</span><p><b>Guardrail:</b> A mapping must meet a high-confidence threshold and pass sample validation. Otherwise it enters the review queue with its evidence.</p></div></>;
}

function EscalationQueue({ items, onResolve, resolved }: { items: Escalation[]; onResolve: (id: string, resolution: Exclude<Resolution, 'open'>, correction?: string) => void; resolved: number }) {
  const open = items.filter(item => item.resolution === 'open');
  return <><SectionTitle eyebrow="REVIEW QUEUE" title="Only genuine ambiguity reaches you" body="Each case shows the competing evidence, so a consultant can resolve it without inspecting raw data." action={<Badge tone={open.length ? 'warning' : 'good'}>{open.length ? `${open.length} decisions open` : 'Review complete'}</Badge>} />{open.length > 0 ? <div className="escalation-stack">{open.map((item, index) => <Card className="escalation-card" key={item.id}><div className="escalation-number">{String(index + 1).padStart(2, '0')}</div><div className="escalation-main"><div className="escalation-top"><div><Badge tone="warning">Needs judgment</Badge><h2>{item.title}</h2></div><span className="case-id">{item.id}</span></div><p>{item.detail}</p><div className="evidence"><div><small>RECORD</small><b>{item.record}</b></div><div><small>AGENT CONFIDENCE</small><b>{item.confidence}% <i><em style={{ width: `${item.confidence}%` }} /></i></b></div><div><small>WHY IT PAUSED</small><b>Conflicting valid interpretations</b></div></div><div className="review-actions"><button className="secondary-button" onClick={() => onResolve(item.id, 'rejected')}>Exclude record</button><button className="secondary-button" onClick={() => { const hint = item.title.includes('date') ? ' Enter YYYY-MM-DD.' : item.title.includes('email') ? ' Enter the corrected email.' : ''; const correction = window.prompt(`Record the correction for “${item.title}”.${hint}`); if (correction?.trim()) onResolve(item.id, 'approved', correction.trim()); }}>Correct decision</button><button className="primary-button" onClick={() => onResolve(item.id, 'approved')}>Approve recommendation <span>→</span></button></div></div></Card>)}</div> : <Card className="review-complete"><span>✓</span><div><p className="eyebrow">REVIEW COMPLETE</p><h2>Every ambiguous case has a recorded decision</h2><p>You can now deliver the validated dataset. Decisions remain reversible and visible in the audit trail.</p></div></Card>} {resolved > 0 && <p className="resolved-note">{resolved} decision{resolved > 1 ? 's' : ''} resolved in this session.</p>}</>;
}

function Delivery({ ready, state, onPush, onRollback }: { ready: boolean; state: string; onPush: () => void; onRollback: () => void }) {
  const delivered = state === 'complete';
  return <>
    <SectionTitle eyebrow="TARGET DELIVERY" title="Controlled, observable handoff" body="The target client is intentionally simple, but every record result is visible and retry-safe." action={<Badge tone={delivered ? 'good' : ready ? 'blue' : 'warning'}>{delivered ? 'Delivered' : ready ? 'Ready to send' : 'Blocked by review'}</Badge>} />
    <Card className="delivery-hero">
      <div className="delivery-status"><span className={`delivery-orb ${delivered ? 'success' : ''}`}>{delivered ? '✓' : '↑'}</span><div><h2>{delivered ? 'Validated records delivered' : ready ? 'Your payload is ready' : 'Review decisions are still required'}</h2><p>{delivered ? 'The mock target accepted each validated record. Its deterministic transient failure was retried once, and every response is in the audit trail.' : ready ? 'All remaining records passed target-schema validation. Use the controlled push below to send them to the mock target.' : 'The system prevents delivery while any record has an unresolved ambiguity.'}</p></div></div>
      <div className="delivery-metrics"><div><b>{delivered ? 'Complete' : 'Ready'}</b><span>delivery status</span></div><div><b>{delivered ? '1' : '—'}</b><span>retried requests</span></div><div><b>0</b><span>silent failures</span></div></div>
      <button className="primary-wide" onClick={onPush} disabled={state === 'sending' || delivered}>{state === 'sending' ? 'Sending to target…' : delivered ? 'Delivery complete' : 'Push validated records to target'} <span>→</span></button>
      {delivered && <button className="secondary-wide" onClick={onRollback}>Roll back mock delivery</button>}
    </Card>
    <Card className="target-contract"><div><p className="eyebrow">MOCK TARGET CONTRACT</p><h2>DarwinBox sandbox API</h2><code>POST /v1/employees</code></div><div><small>WRITE SEMANTICS</small><b>Idempotent upsert by employeeNumber</b></div><div><small>FAILURE POLICY</small><b>Retry transient errors once; preserve all response bodies</b></div><div><small>ROLLBACK</small><b>Available as an explicit audited action</b></div></Card>
  </>;
}

function Audit({ items, events }: { items: Escalation[]; events: ApiAuditEvent[] }) {
  const [filter, setFilter] = useState<'all' | 'agent' | 'human' | 'target'>('all');
  const agentEvents = events.filter(event => event.actor !== 'Alex Singh').map(event => ({ time: new Date(event.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), type: event.event_type, detail: event.detail, review: event.event_type === 'Escalated' }));
  const humanEvents = items.filter(x => x.resolution !== 'open').map(item => ({ time: '09:45', type: 'Human decision', detail: `${item.resolution === 'approved' ? 'Approved' : 'Excluded'}: ${item.title}`, review: false }));
  const targetEvents = events.filter(event => event.event_type === 'Delivered' || event.event_type === 'Rollback').map(event => ({ time: new Date(event.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), type: 'Target response', detail: event.detail, review: false }));
  const visible = filter === 'agent' ? agentEvents : filter === 'human' ? humanEvents : filter === 'target' ? targetEvents : [...agentEvents, ...humanEvents, ...targetEvents];
  return <><SectionTitle eyebrow="AUDIT TRAIL" title="A narrative of every meaningful decision" body="This is the handoff artifact for the implementation team: clear enough to trust, detailed enough to investigate." action={<button className="secondary-button" onClick={() => downloadJson('migration-audit.json', { agentEvents, humanEvents, targetEvents })}>Export audit log</button>} /><Card className="audit-card"><div className="audit-filters">{([['all', 'All activity'], ['agent', 'Agent actions'], ['human', 'Human decisions'], ['target', 'Target responses']] as const).map(([id, label]) => <button key={id} className={filter === id ? 'filter-active' : ''} onClick={() => setFilter(id)}>{label}</button>)}</div><div className="audit-timeline">{visible.length ? visible.map((event, index) => <div className="audit-event" key={`${event.time}-${event.type}-${index}`}><time>Today · {event.time}</time><span className={`timeline-mark ${event.review ? 'review' : event.type === 'Human decision' ? 'human' : ''}`}>{event.review ? '!' : event.type === 'Human decision' ? '◉' : '✓'}</span><div><Badge tone={event.type === 'Human decision' ? 'blue' : event.review ? 'warning' : 'good'}>{event.type}</Badge><h3>{event.detail}</h3><p>{event.review ? 'The agent paused because evidence supported more than one valid interpretation.' : event.type === 'Human decision' ? 'Reviewer action is retained with the original evidence and confidence.' : 'Recorded as an auditable system event.'}</p></div></div>) : <div className="empty-state"><span>•</span><b>No events in this view yet</b><p>Run analysis or complete delivery to add an event.</p></div>}</div></Card></>;
}
