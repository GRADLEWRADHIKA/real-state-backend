import { addMonths } from './format.js';
import type { ScheduleRow } from './types.js';

export interface ScheduleInput {
  total_value: number;
  booking_amount: number;
  booking_date: string;
  installments_count: number;
  frequency_months: number;
  first_due_date: string;
}

/**
 * Payment plan: booking amount + N installments rounded down to ₹1,000; the last one absorbs the remainder.
 * Used by the server when it creates a booking and by the dashboard's plan builder preview.
 */
export function buildSchedule(input: ScheduleInput): ScheduleRow[] {
  const remaining = input.total_value - input.booking_amount;
  const n = Math.max(1, Math.floor(input.installments_count));
  const each = Math.floor(remaining / n / 1000) * 1000;
  const rows: ScheduleRow[] = [{ number: 1, label: 'Booking Amount', due_date: input.booking_date, amount: input.booking_amount }];
  for (let k = 0; k < n; k++) {
    rows.push({
      number: k + 2,
      label: k === n - 1 && n > 1 ? 'Final — On Possession' : `Installment ${k + 1}`,
      due_date: addMonths(input.first_due_date, k * input.frequency_months),
      amount: k === n - 1 ? remaining - each * (n - 1) : each,
    });
  }
  return rows;
}

export function scheduleErrors(input: ScheduleInput): string | null {
  if (input.booking_amount >= input.total_value) return 'Booking amount must be less than the deal value';
  if (input.first_due_date <= input.booking_date) return 'First installment must be due after the booking date';
  return null;
}

/** Status an installment should have for its amounts and due date (as of `today`). */
export function installmentStatus(amount: number, paid: number, due: string, today: string) {
  if (paid >= amount) return 'Paid' as const;
  if (due < today) return 'Overdue' as const;
  if (paid > 0) return 'Partially Paid' as const;
  return 'Pending' as const;
}
