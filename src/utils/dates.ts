export { toDateStr, addDays, addMonths, lastMonths, financialYear, pctChange, humanDate, daysBetween } from '@estateflow/shared';
import { toDateStr } from '@estateflow/shared';

/** Local calendar date (server TZ) as YYYY-MM-DD. */
export const today = () => toDateStr(new Date());
export const nowIso = () => new Date().toISOString();
