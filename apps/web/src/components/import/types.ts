import type { LEGAL_BASIS_LABELS } from '@docline/core/compliance-domain';
import type {
  ColumnMapping,
  DECISION_LABELS,
  IMPORT_STATUS_LABELS,
  MATCH_STATUS_LABELS,
  POLICY_LABELS,
} from '@docline/core/import-domain';

export type { ColumnMapping };
export type ImportStatus = keyof typeof IMPORT_STATUS_LABELS;
export type MatchStatus = keyof typeof MATCH_STATUS_LABELS;
export type RowDecision = keyof typeof DECISION_LABELS;
export type DuplicatePolicy = keyof typeof POLICY_LABELS;
export type LegalBasis = keyof typeof LEGAL_BASIS_LABELS;

export interface PreviewStats {
  byStatus: Partial<Record<MatchStatus, number>>;
  byDecision: Partial<Record<RowDecision, number>>;
  withWarnings: number;
}

/** Lote como devolvido por GET /imports/{id}. */
export interface BatchDetail {
  id: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  encoding: string | null;
  delimiter: string | null;
  sheetName: string | null;
  sheetNames: string[];
  headerRow: number;
  rowCount: number;
  status: ImportStatus;
  duplicatePolicy: DuplicatePolicy;
  sourceId: string | null;
  sourceDetail: string | null;
  collectedAt: string | Date | null;
  defaultLegalBasis: LegalBasis | null;
  legalBasisAssessmentId: string | null;
  defaultOwnerId: string | null;
  defaultTagIds: string[];
  stats: unknown;
  progress: number;
  error: string | null;
  createdAt: string | Date;
  completedAt: string | Date | null;
  createdBy: { id: string; name: string };
  previousImport: { batchId: string; completedAt: string | Date | null; byName: string } | null;
  headers: string[];
  sampleRows: { number: number; cells: string[] }[];
  suggestedMapping: ColumnMapping[];
  templateUsed: { id: string; name: string } | null;
}

export interface ImportOptions {
  sources: { id: string; name: string; defaultLegalBasis: LegalBasis | null }[];
  tags: { id: string; name: string }[];
  owners: { id: string; name: string }[] | null;
  assessments: { id: string; name: string; legalBasis: LegalBasis }[];
}
