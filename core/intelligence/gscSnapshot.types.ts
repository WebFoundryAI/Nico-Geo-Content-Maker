/**
 * GSC Snapshot Types
 *
 * Type definitions for Google Search Console snapshot data.
 * This module accepts pre-exported GSC data (no OAuth required).
 *
 * DESIGN:
 * - GSC data is provided externally (manual export or external system)
 * - No Google API calls are made by this system
 * - All fields are validated at runtime
 */

/**
 * A single row of GSC performance data.
 */
export interface GscSnapshotRow {
  /** Page URL or path (e.g., "https://example.com/about" or "/about") */
  page: string;
  /** Total clicks for this page in the date range */
  clicks: number;
  /** Total impressions for this page in the date range */
  impressions: number;
  /** Click-through rate (0-1 scale, e.g., 0.05 = 5%) */
  ctr: number;
  /** Average position in search results (1 = top) */
  position: number;
  /** Date range descriptor (e.g., "last_28_days", "last_7_days") */
  dateRange: string;
}

/**
 * Complete GSC snapshot with metadata.
 */
export interface GscSnapshot {
  /** Array of performance rows */
  rows: GscSnapshotRow[];
  /** Optional site URL for context */
  siteUrl?: string;
  /** Optional export timestamp */
  exportedAt?: string;
}

/**
 * Validation error for GSC snapshot data.
 */
export interface GscValidationError {
  rowIndex: number;
  field: string;
  message: string;
}

/**
 * Result of GSC snapshot validation.
 */
export interface GscValidationResult {
  valid: boolean;
  errors: GscValidationError[];
  validRows: GscSnapshotRow[];
}

/**
 * Validates a single GSC snapshot row.
 */
function validateRow(row: unknown, index: number): GscValidationError[] {
  const errors: GscValidationError[] = [];

  if (!row || typeof row !== 'object') {
    errors.push({ rowIndex: index, field: 'row', message: 'Row must be an object' });
    return errors;
  }

  const r = row as Record<string, unknown>;

  // Validate page
  if (typeof r.page !== 'string' || r.page.length === 0) {
    errors.push({ rowIndex: index, field: 'page', message: 'page must be a non-empty string' });
  }

  // Validate clicks
  if (typeof r.clicks !== 'number' || r.clicks < 0 || !Number.isFinite(r.clicks)) {
    errors.push({ rowIndex: index, field: 'clicks', message: 'clicks must be a non-negative number' });
  }

  // Validate impressions
  if (typeof r.impressions !== 'number' || r.impressions < 0 || !Number.isFinite(r.impressions)) {
    errors.push({ rowIndex: index, field: 'impressions', message: 'impressions must be a non-negative number' });
  }

  // Validate ctr
  if (typeof r.ctr !== 'number' || r.ctr < 0 || r.ctr > 1 || !Number.isFinite(r.ctr)) {
    errors.push({ rowIndex: index, field: 'ctr', message: 'ctr must be a number between 0 and 1' });
  }

  // Validate position
  if (typeof r.position !== 'number' || r.position < 1 || !Number.isFinite(r.position)) {
    errors.push({ rowIndex: index, field: 'position', message: 'position must be a number >= 1' });
  }

  // Validate dateRange
  if (typeof r.dateRange !== 'string' || r.dateRange.length === 0) {
    errors.push({ rowIndex: index, field: 'dateRange', message: 'dateRange must be a non-empty string' });
  }

  return errors;
}

/**
 * Validates a GSC snapshot array.
 * Returns validation result with errors and valid rows.
 */
export function validateGscSnapshot(snapshot: unknown): GscValidationResult {
  const errors: GscValidationError[] = [];
  const validRows: GscSnapshotRow[] = [];

  // Check if it's an array
  if (!Array.isArray(snapshot)) {
    return {
      valid: false,
      errors: [{ rowIndex: -1, field: 'snapshot', message: 'gscSnapshot must be an array' }],
      validRows: [],
    };
  }

  // Validate each row
  for (let i = 0; i < snapshot.length; i++) {
    const rowErrors = validateRow(snapshot[i], i);
    if (rowErrors.length === 0) {
      validRows.push(snapshot[i] as GscSnapshotRow);
    } else {
      errors.push(...rowErrors);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    validRows,
  };
}

/**
 * Type guard to check if an object is a valid GscSnapshotRow.
 */
export function isValidGscRow(row: unknown): row is GscSnapshotRow {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  return (
    typeof r.page === 'string' &&
    r.page.length > 0 &&
    typeof r.clicks === 'number' &&
    r.clicks >= 0 &&
    typeof r.impressions === 'number' &&
    r.impressions >= 0 &&
    typeof r.ctr === 'number' &&
    r.ctr >= 0 &&
    r.ctr <= 1 &&
    typeof r.position === 'number' &&
    r.position >= 1 &&
    typeof r.dateRange === 'string' &&
    r.dateRange.length > 0
  );
}
