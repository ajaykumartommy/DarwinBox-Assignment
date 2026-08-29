export type SourceRow = Record<string, string | null | undefined>;

export type TargetField = {
  name: string;
  required?: boolean;
  format?: 'email' | 'date' | 'phone' | 'string';
};

export type TargetSchema = { entity: string; fields: TargetField[] };

export type MappingEvidence = {
  source: string;
  target: string;
  confidence: number;
  reason: string;
};

export type MigrationEscalation = {
  kind: 'ambiguous_mapping' | 'ambiguous_date' | 'duplicate_conflict' | 'validation_failure';
  recordKey: string;
  message: string;
  sourceFields?: string[];
};

export type MigrationResult = {
  records: SourceRow[];
  mappings: MappingEvidence[];
  escalations: MigrationEscalation[];
  audit: string[];
};

const aliases: Record<string, string[]> = {
  employeeNumber: ['employee_id', 'employee id', 'employee_number', 'emp_id', 'emp id'],
  given_name: ['first_name', 'first name', 'given_name', 'given name', 'firstname'],
  family_name: ['last_name', 'last name', 'family_name', 'family name', 'surname'],
  email: ['work_email', 'work email', 'email', 'email_address', 'email address'],
  joined_on: ['start_date', 'start date', 'join_date', 'joining date', 'date of joining'],
  team_name: ['department', 'department_name', 'team', 'team name'],
  phone: ['phone', 'mobile', 'mobile_number', 'phone number'],
};

function canonical(value: string) {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function cleaned(value: string | null | undefined) {
  return value?.trim().replace(/\s+/g, ' ') || '';
}

function normalisePhone(value: string) {
  const digits = value.replace(/[^\d+]/g, '');
  return digits.startsWith('+') ? digits : digits ? `+${digits}` : '';
}

/**
 * Converts only unambiguous date formats. Day/month dates such as 03/04/2024
 * deliberately return undefined: the caller must ask a human rather than guess.
 */
export function toIsoDate(value: string): string | undefined {
  const safe = cleaned(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(safe)) return safe;
  const parts = safe.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!parts) return undefined;
  const first = Number(parts[1]);
  const second = Number(parts[2]);
  const year = parts[3];
  if (first > 12 && second <= 12) return `${year}-${String(second).padStart(2, '0')}-${String(first).padStart(2, '0')}`;
  if (second > 12 && first <= 12) return `${year}-${String(first).padStart(2, '0')}-${String(second).padStart(2, '0')}`;
  return undefined;
}

export function parseCsv(content: string): SourceRow[] {
  const lines = content.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const cells = (line: string) => line.split(',').map((cell) => cell.replace(/^"|"$/g, '').trim());
  const headers = cells(lines[0]);
  return lines.slice(1).map((line) => {
    const values = cells(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  });
}

export function inferMappings(sourceColumns: string[], schema: TargetSchema): MappingEvidence[] {
  return schema.fields.flatMap((target) => {
    const direct = sourceColumns.find((column) => canonical(column) === canonical(target.name));
    const alias = sourceColumns.find((column) => aliases[target.name]?.includes(canonical(column)));
    const source = direct ?? alias;
    if (!source) return [];
    return [{
      source,
      target: target.name,
      confidence: direct ? 1 : 0.94,
      reason: direct ? 'Exact normalized header match' : 'Known source alias for target field',
    }];
  });
}

function targetValue(target: TargetField, sourceValue: string, escalations: MigrationEscalation[], key: string) {
  if (!sourceValue) return '';
  if (target.format === 'email') return sourceValue.toLowerCase();
  if (target.format === 'phone') return normalisePhone(sourceValue);
  if (target.format === 'date') {
    const iso = toIsoDate(sourceValue);
    if (iso) return iso;
    escalations.push({ kind: 'ambiguous_date', recordKey: key, message: `Could not safely normalize '${sourceValue}' as a date.` });
    return '';
  }
  return sourceValue;
}

/** A small deterministic policy layer intended to sit beside, not beneath, an LLM mapper. */
export function migrateRows(sourceRows: SourceRow[], schema: TargetSchema): MigrationResult {
  const columns = [...new Set(sourceRows.flatMap((row) => Object.keys(row)))];
  const mappings = inferMappings(columns, schema);
  const escalations: MigrationEscalation[] = [];
  const audit = [`Profiled ${sourceRows.length} source rows and ${columns.length} columns.`, `Inferred ${mappings.length} high-confidence field mappings.`];
  const transformed = sourceRows.map((source, index) => {
    const result: SourceRow = {};
    const key = cleaned(source.employee_id) || cleaned(source.email) || `source-row-${index + 1}`;
    for (const target of schema.fields) {
      const mapping = mappings.find((item) => item.target === target.name);
      result[target.name] = targetValue(target, cleaned(mapping ? source[mapping.source] : ''), escalations, key);
      if (target.required && !result[target.name]) {
        escalations.push({ kind: 'validation_failure', recordKey: key, message: `Required target field '${target.name}' is missing or invalid.` });
      }
    }
    return result;
  });

  const unique = new Map<string, SourceRow>();
  for (const row of transformed) {
    const key = cleaned(row.employeeNumber) || cleaned(row.email);
    if (!key) continue;
    const current = unique.get(key);
    if (!current) {
      unique.set(key, row);
      continue;
    }
    const conflict = Object.keys(row).some((field) => current[field] && row[field] && current[field] !== row[field]);
    if (conflict) {
      escalations.push({ kind: 'duplicate_conflict', recordKey: key, message: 'Potential duplicate has conflicting non-empty values.' });
    } else {
      Object.keys(row).forEach((field) => { if (!current[field] && row[field]) current[field] = row[field]; });
    }
  }
  audit.push(`Consolidated ${transformed.length - unique.size} exact, non-conflicting duplicates.`);
  if (escalations.length) audit.push(`Paused ${escalations.length} unsafe or ambiguous cases for human review.`);
  return { records: [...unique.values()], mappings, escalations, audit };
}
