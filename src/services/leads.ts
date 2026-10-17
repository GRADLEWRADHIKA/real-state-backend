import crypto from 'node:crypto';
import { db } from '../db/index.js';
import { HttpError, notFound } from '../utils/http.js';
import { buildSchedule, LEAD_PIPELINE_ORDER, normalizePhone, type ConvertData } from '@estateflow/shared';
import { nowIso } from '../utils/dates.js';
import { logActivity, notifyRoles, notifyUsers } from './activity.js';
import { inr, recordPayment } from './payments.js';
import type { AuthUser } from '../middleware/auth.js';

export const CODE_PREFIX = {
  leads: ['LD', 1000],
  customers: ['CU', 2000],
  properties: ['PR', 3000],
  deals: ['DL', 5000],
} as const;

/**
 * Inserts a row and derives its public code from the generated id (LD-1043 = base + id), so codes
 * are never reused after deletes and no dialect-specific sequence query is needed.
 */
export async function insertWithCode(table: keyof typeof CODE_PREFIX, data: Record<string, unknown>) {
  const [prefix, base] = CODE_PREFIX[table];
  const id = await db.insert(table, { ...data, code: `TMP-${crypto.randomUUID()}` });
  await db.run(`UPDATE ${table} SET code = ? WHERE id = ?`, [`${prefix}-${base + id}`, id]);
  return id;
}

export { normalizePhone };

/** Leads sharing a phone number (normalised to the last 10 digits). */
export async function findDuplicates(phone: string, excludeId?: number) {
  const norm = normalizePhone(phone);
  if (norm.length < 8) return [];
  return db.all(
    `SELECT l.id, l.code, l.name, l.status, l.assigned_to, u.name AS agent_name, l.created_at
     FROM leads l LEFT JOIN users u ON u.id = l.assigned_to WHERE l.phone_norm = ?${excludeId ? ' AND l.id != ?' : ''} ORDER BY l.id`,
    excludeId ? [norm, excludeId] : [norm],
  );
}

/** Keeps leads.next_followup in sync with the earliest pending follow-up. */
export async function refreshLeadFollowup(leadId: number) {
  const next = await db.get<{ at: string }>(
    `SELECT due_date || 'T' || due_time AS at FROM followups
     WHERE lead_id = ? AND status = 'Pending' ORDER BY due_date, due_time LIMIT 1`,
    [leadId],
  );
  await db.run('UPDATE leads SET next_followup = ? WHERE id = ?', [next?.at ?? null, leadId]);
}

export async function touchLeadContact(leadId: number) {
  await db.run('UPDATE leads SET last_contact = ?, updated_at = ? WHERE id = ?', [nowIso(), nowIso(), leadId]);
}

export async function changeLeadStatus(leadId: number, status: string, user: AuthUser, reason?: string | null) {
  const lead = await db.get('SELECT id, name, status, assigned_to FROM leads WHERE id = ?', [leadId]);
  if (!lead) throw notFound('Lead');
  if (lead.status === status) return lead;
  await db.update('leads', leadId, {
    status,
    lost_reason: status === 'Lost' ? reason || null : null,
    updated_at: nowIso(),
  });
  await logActivity({
    lead_id: leadId,
    type: 'status',
    title: `Moved to ${status}`,
    description: status === 'Lost' && reason ? `Reason: ${reason}` : `Stage changed from ${lead.status} to ${status}`,
    user_id: user.id,
  });
  if (lead.assigned_to && lead.assigned_to !== user.id) {
    await notifyUsers([lead.assigned_to], {
      type: 'lead',
      title: 'Lead stage updated',
      message: `${user.name} moved ${lead.name} to ${status}.`,
      link: `/leads/${leadId}`,
    });
  }
  return { ...lead, status };
}

/** Promotes a lead to the next pipeline stage when an action implies progress (never moves it back). */
export async function advanceLead(leadId: number, to: string, user: AuthUser) {
  const order: string[] = LEAD_PIPELINE_ORDER;
  const lead = await db.get<{ status: string }>('SELECT status FROM leads WHERE id = ?', [leadId]);
  if (!lead || lead.status === 'Lost') return;
  if (order.indexOf(lead.status) < order.indexOf(to)) await changeLeadStatus(leadId, to, user);
}

export type ConversionInput = Omit<ConvertData, 'record_booking_payment'> & { record_booking_payment?: boolean; name?: string; assigned_to?: number | null };

/**
 * Lead → Customer + Deal + installment schedule (+ optional booking payment), atomically.
 * With `leadId = null` it books a walk-in customer directly (no lead record).
 */
export async function convertLead(leadId: number | null, input: ConversionInput, user: AuthUser) {
  return db.transaction(async () => {
    const lead = leadId
      ? await db.get('SELECT * FROM leads WHERE id = ?', [leadId])
      : { id: null, name: input.name, phone: input.phone, email: input.email ?? null, assigned_to: input.assigned_to ?? (user.role === 'sales' ? user.id : null), customer_id: null };
    if (!lead) throw notFound('Lead');
    if (lead.customer_id) throw new HttpError(409, 'This lead has already been converted to a customer');
    const property = await db.get('SELECT * FROM properties WHERE id = ?', [input.property_id]);
    if (!property) throw notFound('Property');
    if (!['Available', 'Reserved'].includes(property.status)) {
      throw new HttpError(409, `${property.project} ${property.unit_number} is already ${property.status.toLowerCase()}`);
    }
    if (input.booking_amount >= input.total_value) throw new HttpError(422, 'Booking amount must be less than the deal value');

    const now = nowIso();
    const agent = lead.assigned_to ?? user.id;
    const customerId = await insertWithCode('customers', {
      lead_id: lead.id,
      name: lead.name,
      phone: input.phone || lead.phone,
      email: input.email ?? lead.email,
      address: input.address,
      city: input.city ?? property.city,
      occupation: input.occupation,
      pan: input.pan?.toUpperCase(),
      aadhaar: input.aadhaar,
      property_id: property.id,
      booking_date: input.booking_date,
      total_value: input.total_value,
      status: 'Active',
      assigned_to: agent,
      created_at: now,
    });
    const dealId = await insertWithCode('deals', {
      lead_id: lead.id,
      customer_id: customerId,
      property_id: property.id,
      agent_id: agent,
      value: input.total_value,
      booking_amount: input.booking_amount,
      discount: Math.max(0, property.price - input.total_value),
      stage: 'Booked',
      status: 'Open',
      booking_date: input.booking_date,
      created_at: now,
    });

    // Schedule: booking amount + N installments; the last one absorbs rounding.
    const schedule = buildSchedule(input);
    let bookingInstallmentId = 0;
    for (const s of schedule) {
      const id = await db.insert('installments', { customer_id: customerId, deal_id: dealId, ...s, paid_amount: 0, status: 'Pending', created_at: now });
      if (s.number === 1) bookingInstallmentId = id;
    }

    await db.update('properties', property.id, { status: 'Booked', updated_at: now });
    if (lead.id) {
      await db.update('leads', lead.id, { status: 'Booked', customer_id: customerId, property_id: property.id, updated_at: now });
      await db.run('UPDATE documents SET entity_type = ?, entity_id = ? WHERE entity_type = ? AND entity_id = ? AND doc_type IN (?, ?, ?)', [
        'customer', customerId, 'lead', lead.id, 'Aadhaar', 'PAN', 'ID Proof',
      ]);
    }

    const desc = `${property.project} · ${property.unit_number} booked for ${inr(input.total_value)}`;
    await logActivity({ lead_id: lead.id, customer_id: customerId, property_id: property.id, type: 'conversion', title: lead.id ? 'Converted to customer' : 'Booking created', description: desc, user_id: user.id });

    if (input.record_booking_payment) {
      await recordPayment(
        {
          installment_id: bookingInstallmentId,
          amount: input.booking_amount,
          method: input.booking_method || 'Bank Transfer',
          payment_date: input.booking_date,
          reference: input.booking_reference,
          notes: 'Booking amount collected at the time of booking',
        },
        user,
      );
    }
    await notifyRoles(['admin', 'manager', 'accounts'], {
      type: 'deal',
      title: 'New booking',
      message: `${lead.name} booked ${property.project} ${property.unit_number} for ${inr(input.total_value)}.`,
      link: `/customers/${customerId}`,
    }, user.id);
    return customerId;
  });
}
