/**
 * Request schemas shared by the API (validation) and both front-ends (form validation, types).
 * Field messages read as "<field>: <message>" on the server so forms can map them back.
 */
import { z } from 'zod';
import {
  CLIENTS,
  CONTACT_CHANNELS,
  CUSTOMER_REQUEST_STATUSES,
  CUSTOMER_REQUEST_TYPES,
  CUSTOMER_UPLOAD_TYPES,
  DEAL_STAGES,
  DOCUMENT_ENTITIES,
  DOCUMENT_TYPES,
  FOLLOWUP_STATUSES,
  FOLLOWUP_TYPES,
  LEAD_PRIORITIES,
  LEAD_SOURCES,
  LEAD_STATUSES,
  MAX_PAGE_SIZE,
  NOTIFICATION_TRIGGERS,
  PAYMENT_METHODS,
  PROPERTY_STATUSES,
  PROPERTY_TYPES,
  REGISTRY_STATUSES,
  EXPENSE_CATEGORIES,
  ATTENDANCE_STATUSES,
  ROLE_KEYS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  VISIT_STATUSES,
} from './constants.js';

// ─── Field helpers ───────────────────────────────────────────────────────
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date (YYYY-MM-DD)');
export const zTime = z.string().regex(/^\d{2}:\d{2}$/, 'must be a time (HH:MM)');
export const zPhone = z.string().trim().regex(/^\+?[0-9 ()-]{8,16}$/, 'must be a valid phone number');
export const zEmail = z.string().trim().toLowerCase().email('must be a valid email');
export const zOptEmail = zEmail.optional().nullable().or(z.literal('').transform(() => null));
export const zMoney = z.coerce.number().int('must be a whole rupee amount').min(0, 'cannot be negative');
export const zOptStr = z.string().trim().max(2000).optional().nullable();
export const zId = z.coerce.number().int().positive();
export const zPan = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/, 'must be a valid PAN (e.g. ABCDE1234F)')
  .optional()
  .nullable()
  .or(z.literal('').transform(() => null));
export const zAadhaar = z
  .string()
  .trim()
  .regex(/^[0-9 ]{12,14}$/, 'must be 12 digits')
  .optional()
  .nullable()
  .or(z.literal('').transform(() => null));
export const zLat = z.coerce.number().min(-90).max(90);
export const zLng = z.coerce.number().min(-180).max(180);

/** Password rules; min length comes from Settings → Security. */
export const passwordSchema = (min = 8, strong = true) => {
  let s = z.string().min(min, `must be at least ${min} characters`).max(128);
  if (strong) s = s.regex(/[A-Z]/, 'needs an uppercase letter').regex(/[0-9]/, 'needs a number');
  return s;
};

// ─── List queries ────────────────────────────────────────────────────────
const optText = z
  .string()
  .trim()
  .max(120)
  .optional()
  .transform((v) => (v ? v : undefined));
const optNum = z.preprocess((v) => (v === '' || v === undefined || v === null ? undefined : v), z.coerce.number().optional());
const optId = z.preprocess((v) => (v === '' || v === undefined || v === null ? undefined : v), zId.optional());
const optDate = z.preprocess((v) => (v === '' ? undefined : v), zDate.optional());
const csvEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').filter(Boolean) : undefined))
    .pipe(z.array(z.enum(values)).optional());

export const listQuery = z.object({
  page: z.preprocess((v) => (v === '' ? undefined : v), z.coerce.number().int().min(1).default(1)),
  limit: z.preprocess((v) => (v === '' ? undefined : v), z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional()),
  pageSize: z.preprocess((v) => (v === '' ? undefined : v), z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional()),
  cursor: z.string().max(40).optional(),
  q: optText,
  sort: z.string().max(40).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});
export type ListQuery = z.infer<typeof listQuery>;

export const leadListQuery = listQuery.extend({
  status: csvEnum(LEAD_STATUSES),
  source: z.enum(LEAD_SOURCES).optional().or(z.literal('').transform(() => undefined)),
  priority: z.enum(LEAD_PRIORITIES).optional().or(z.literal('').transform(() => undefined)),
  agent: z.union([z.literal('unassigned'), z.literal('me'), z.coerce.number().int().positive()]).optional().or(z.literal('').transform(() => undefined)),
  property: optId,
  project: optText,
  budget_min: optNum,
  budget_max: optNum,
  from: optDate,
  to: optDate,
  followup: z.enum(['overdue', 'today', 'none']).optional().or(z.literal('').transform(() => undefined)),
});
export const customerListQuery = listQuery.extend({
  status: z.enum(['Active', 'Completed', 'Cancelled']).optional().or(z.literal('').transform(() => undefined)),
  project: optText,
  agent: optId,
  payment: z.enum(['overdue', 'clear']).optional().or(z.literal('').transform(() => undefined)),
  registry: z.enum([...REGISTRY_STATUSES, 'pending', 'due15']).optional().or(z.literal('').transform(() => undefined)),
  broker: optId,
});
export const propertyListQuery = listQuery.extend({
  status: z.enum(PROPERTY_STATUSES).optional().or(z.literal('').transform(() => undefined)),
  type: z.enum(PROPERTY_TYPES).optional().or(z.literal('').transform(() => undefined)),
  project: optText,
  price_min: optNum,
  price_max: optNum,
  bedrooms: optNum,
  available: z.enum(['0', '1']).optional(),
  block: optText,
});
export const visitListQuery = listQuery.extend({
  status: z.enum(VISIT_STATUSES).optional().or(z.literal('').transform(() => undefined)),
  agent: optId,
  lead: optId,
  property: optId,
  range: z.enum(['today', 'upcoming', 'week', 'past', 'month']).optional().or(z.literal('').transform(() => undefined)),
  from: optDate,
  to: optDate,
});
export const followupListQuery = listQuery.extend({
  status: z.enum(FOLLOWUP_STATUSES).optional().or(z.literal('').transform(() => undefined)),
  type: z.enum(FOLLOWUP_TYPES).optional().or(z.literal('').transform(() => undefined)),
  agent: optId,
  lead: optId,
  bucket: z.enum(['today', 'overdue', 'upcoming', 'week']).optional().or(z.literal('').transform(() => undefined)),
  from: optDate,
  to: optDate,
});
export const taskListQuery = listQuery.extend({
  status: z.enum([...TASK_STATUSES, 'open']).optional().or(z.literal('').transform(() => undefined)),
  priority: z.enum(TASK_PRIORITIES).optional().or(z.literal('').transform(() => undefined)),
  assignee: optId,
  mine: z.enum(['0', '1']).optional(),
  due: z.enum(['overdue', 'today', 'week']).optional().or(z.literal('').transform(() => undefined)),
  lead: optId,
  customer: optId,
  from: optDate,
  to: optDate,
});
export const dealListQuery = listQuery.extend({
  stage: z.enum(DEAL_STAGES).optional().or(z.literal('').transform(() => undefined)),
  status: z.enum(['Open', 'Won', 'Cancelled']).optional().or(z.literal('').transform(() => undefined)),
  agent: optId,
});
export const transactionListQuery = listQuery.extend({
  method: z.enum(PAYMENT_METHODS).optional().or(z.literal('').transform(() => undefined)),
  status: z.enum(['Completed', 'Pending', 'Failed']).optional().or(z.literal('').transform(() => undefined)),
  type: optText,
  customer: optId,
  from: optDate,
  to: optDate,
});
export const installmentListQuery = listQuery.extend({
  status: z.enum(['Pending', 'Partially Paid', 'Paid', 'Overdue']).optional().or(z.literal('').transform(() => undefined)),
  customer: optId,
  range: z.enum(['month', 'next30', 'overdue', 'due']).optional().or(z.literal('').transform(() => undefined)),
});
export const documentListQuery = listQuery.extend({
  entity_type: z.enum(DOCUMENT_ENTITIES).optional().or(z.literal('').transform(() => undefined)),
  entity_id: optId,
  doc_type: z.enum(DOCUMENT_TYPES).optional().or(z.literal('').transform(() => undefined)),
});
export const userListQuery = listQuery.extend({
  role: z.enum(ROLE_KEYS).optional().or(z.literal('').transform(() => undefined)),
  status: z.enum(['Active', 'Inactive']).optional().or(z.literal('').transform(() => undefined)),
});
export const auditListQuery = listQuery.extend({
  user: optId,
  entity_type: optText,
  action: optText,
  from: optDate,
  to: optDate,
});
export const requestListQuery = listQuery.extend({
  status: z.enum(CUSTOMER_REQUEST_STATUSES).optional().or(z.literal('').transform(() => undefined)),
  type: z.enum(CUSTOMER_REQUEST_TYPES).optional().or(z.literal('').transform(() => undefined)),
  /** `open` = Open or In Progress (the staff inbox). */
  state: z.enum(['open']).optional().or(z.literal('').transform(() => undefined)),
  customer: optId,
});
export const notificationListQuery = listQuery.extend({ unread: z.enum(['0', '1']).optional() });
export const rangeQuery = z.object({ from: optDate, to: optDate });

// ─── Auth ────────────────────────────────────────────────────────────────
export const loginBody = z.object({
  email: zEmail,
  password: z.string().min(1, 'is required'),
  remember: z.boolean().optional().default(false),
  client: z.enum(CLIENTS),
  device: z.string().trim().max(120).optional(),
});
export type LoginBody = z.input<typeof loginBody>;
export const refreshBody = z.object({ refreshToken: z.string().min(20).max(200) });
export const forgotPasswordBody = z.object({ email: zEmail, note: z.string().trim().max(300).optional() });
export const resetPasswordBody = z.object({
  email: zEmail,
  code: z.string().trim().min(6, 'is required').max(16),
  new_password: z.string().min(1, 'is required'),
});
export const profileBody = z.object({ name: z.string().trim().min(2).max(80), phone: z.string().trim().max(20).optional().nullable() });
export const changePasswordBody = z.object({ current_password: z.string().min(1, 'is required'), new_password: z.string().min(1, 'is required'), remember: z.boolean().optional() });

// ─── Leads ───────────────────────────────────────────────────────────────
export const leadBody = z.object({
  name: z.string().trim().min(2, 'is required').max(80),
  phone: zPhone,
  email: zOptEmail,
  location: zOptStr,
  source: z.enum(LEAD_SOURCES),
  source_detail: z.string().trim().max(120).optional().nullable(),
  property_id: zId.optional().nullable(),
  property_type: z.enum(PROPERTY_TYPES).optional().nullable().or(z.literal('').transform(() => null)),
  budget: z.coerce.number().int().min(0).max(1_000_000_000).optional().nullable(),
  requirement: zOptStr,
  priority: z.enum(LEAD_PRIORITIES).default('Warm'),
  assigned_to: zId.optional().nullable(),
  status: z.enum(LEAD_STATUSES).optional(),
  notes: zOptStr,
});
export type LeadInput = z.input<typeof leadBody>;
export const leadStatusBody = z.object({ status: z.enum(LEAD_STATUSES), reason: zOptStr });
export const noteBody = z.object({ note: z.string().trim().min(1, 'cannot be empty').max(4000) });
export const logContactBody = z.object({ channel: z.enum(CONTACT_CHANNELS), summary: zOptStr, at: z.string().datetime().optional() });
export const bulkAssignBody = z.object({ ids: z.array(zId).min(1).max(500), agent_id: zId });
export const bulkIdsBody = z.object({ ids: z.array(zId).min(1).max(500) });
export const mergeLeadBody = z.object({ source_id: zId });
export const leadImportRow = z.object({
  name: z.string().trim().min(2, 'name is required').max(80),
  phone: zPhone,
  email: zOptEmail,
  location: zOptStr,
  source: z.enum(LEAD_SOURCES).catch('Website'),
  budget: z.preprocess((v) => (v === '' || v === undefined ? null : String(v).replace(/[^\d]/g, '')), z.coerce.number().int().min(0).nullable()),
  property_type: z.enum(PROPERTY_TYPES).optional().nullable().catch(null),
  priority: z.enum(LEAD_PRIORITIES).catch('Warm'),
  requirement: zOptStr,
  assigned_email: z.string().trim().toLowerCase().optional().nullable(),
});
export const leadImportBody = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(2000),
  dryRun: z.boolean().default(true),
  skipDuplicates: z.boolean().default(true),
});
export const publicLeadBody = z.object({
  name: z.string().trim().min(2).max(80),
  phone: zPhone,
  email: zOptEmail,
  message: z.string().trim().max(1000).optional().nullable(),
  source: z.enum(LEAD_SOURCES).optional(),
  campaign: z.string().trim().max(120).optional().nullable(),
  property_type: z.enum(PROPERTY_TYPES).optional().nullable(),
  budget: z.coerce.number().int().min(0).max(1_000_000_000).optional().nullable(),
  location: z.string().trim().max(160).optional().nullable(),
});

export const convertBody = z.object({
  property_id: zId,
  total_value: z.coerce.number().int().min(100000, 'looks too low'),
  booking_amount: z.coerce.number().int().min(1000),
  booking_date: zDate,
  installments_count: z.coerce.number().int().min(1).max(60),
  frequency_months: z.coerce.number().int().min(1).max(12),
  first_due_date: zDate,
  phone: zPhone.optional(),
  email: zOptEmail,
  address: zOptStr,
  city: zOptStr,
  occupation: zOptStr,
  pan: zPan,
  aadhaar: zAadhaar,
  record_booking_payment: z.boolean().default(true),
  booking_method: z.enum(PAYMENT_METHODS).optional(),
  booking_reference: zOptStr,
});
export type ConvertInput = z.input<typeof convertBody>;
export const directBookingBody = convertBody.extend({
  name: z.string().trim().min(2, 'is required').max(80),
  phone: zPhone,
  assigned_to: zId.optional().nullable(),
});
export const schedulePreviewBody = convertBody.pick({
  total_value: true,
  booking_amount: true,
  booking_date: true,
  installments_count: true,
  frequency_months: true,
  first_due_date: true,
});

// ─── Customers / deals ───────────────────────────────────────────────────
export const customerUpdateBody = z
  .object({
    name: z.string().trim().min(2).max(80),
    phone: zPhone,
    email: zOptEmail,
    address: zOptStr,
    city: zOptStr,
    occupation: zOptStr,
    pan: zPan,
    aadhaar: zAadhaar,
    assigned_to: zId.optional().nullable(),
    nominee_name: zOptStr,
    nominee_relation: zOptStr,
    nominee_phone: zPhone.optional().nullable().or(z.literal('').transform(() => null)),
    nominee_aadhaar: zAadhaar,
    registry_status: z.enum(REGISTRY_STATUSES),
    registry_date: zDate.optional().nullable().or(z.literal('').transform(() => null)),
    registry_number: zOptStr,
    broker_id: zId.optional().nullable().or(z.literal('').transform(() => null)),
  })
  .partial()
  .refine((c) => c.registry_status !== 'Date fixed' || !!c.registry_date, { message: 'registry_date: is required when the registry date is fixed', path: ['registry_date'] })
  .refine((c) => c.registry_status !== 'Done' || !!c.registry_number, { message: 'registry_number: is required once the registry is done', path: ['registry_number'] });
export const customerNoteBody = z.object({
  note: z.string().trim().min(1).max(4000),
  channel: z.enum(['note', 'call', 'whatsapp', 'sms', 'email', 'meeting']).default('note'),
});
export const cancelBookingBody = z.object({ reason: z.string().trim().min(3, 'is required').max(500) });
export const dealUpdateBody = z.object({ stage: z.enum(DEAL_STAGES).optional(), notes: zOptStr });

// ─── Properties ──────────────────────────────────────────────────────────
export const propertyBody = z.object({
  name: z.string().trim().min(2, 'is required').max(120),
  project: z.string().trim().min(2, 'is required').max(80),
  location: z.string().trim().min(2, 'is required').max(160),
  city: z.string().trim().min(2, 'is required').max(60),
  type: z.enum(PROPERTY_TYPES),
  unit_number: z.string().trim().min(1, 'is required').max(30),
  block: z.string().trim().max(30).optional().nullable(),
  rate_per_sqft: z.coerce.number().int().min(0).optional().nullable().or(z.literal('').transform(() => null)),
  tower: zOptStr,
  floor: z.coerce.number().int().min(-2).max(150).optional().nullable(),
  bedrooms: z.coerce.number().int().min(0).max(12).optional().nullable(),
  bathrooms: z.coerce.number().int().min(0).max(12).optional().nullable(),
  area_sqft: z.coerce.number().int().min(50, 'looks too small').max(500000),
  price: z.coerce.number().int().min(100000, 'looks too low'),
  status: z.enum(PROPERTY_STATUSES).default('Available'),
  facing: zOptStr,
  furnishing: zOptStr,
  parking: z.coerce.number().int().min(0).max(20).optional().nullable(),
  possession: zOptStr,
  construction_stage: zOptStr,
  rera_number: zOptStr,
  description: zOptStr,
  amenities: z.array(z.string().trim().min(1)).max(40).default([]),
  assigned_to: zId.optional().nullable(),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'use lowercase letters, numbers and dashes').max(120).optional().nullable().or(z.literal('').transform(() => null)),
  is_published: z.coerce.boolean().optional(),
  /** Create only: render illustrated starter images in the background. */
  generate_images: z.coerce.boolean().optional(),
});
export type PropertyInput = z.input<typeof propertyBody>;

export const IMAGE_KINDS = ['exterior', 'aerial', 'street', 'lobby', 'living', 'bedroom', 'kitchen', 'interior', 'amenity', 'floor_plan', 'master_plan', 'other'] as const;
export const propertyImageUpdate = z.object({
  alt_text: z.string().trim().min(3, 'is required').max(240).optional(),
  caption: z.string().trim().max(240).optional().nullable(),
  kind: z.enum(IMAGE_KINDS).optional(),
  is_ai_generated: z.coerce.boolean().optional(),
});
export const propertyImageOrder = z.object({ ids: z.array(zId).min(1).max(200) });
export const generateImagesBody = z.object({ force: z.coerce.boolean().optional(), seed: z.coerce.number().int().min(0).max(1_000_000).optional() });

// ─── Schedule ────────────────────────────────────────────────────────────
export const visitBody = z.object({
  lead_id: zId,
  property_id: zId.optional().nullable(),
  agent_id: zId.optional().nullable(),
  visit_date: zDate,
  visit_time: zTime,
  status: z.enum(VISIT_STATUSES).default('Scheduled'),
  feedback: zOptStr,
  next_action: zOptStr,
  outcome: zOptStr,
});
export const checkInBody = z.object({ lat: zLat.optional().nullable(), lng: zLng.optional().nullable(), at: z.string().datetime().optional() });
export const checkOutBody = checkInBody.extend({
  outcome: z.string().trim().min(2, 'is required').max(80),
  feedback: zOptStr,
  next_action: zOptStr,
});
export const followupBody = z.object({
  lead_id: zId,
  agent_id: zId.optional().nullable(),
  due_date: zDate,
  due_time: zTime,
  type: z.enum(FOLLOWUP_TYPES),
  notes: zOptStr,
  status: z.enum(FOLLOWUP_STATUSES).default('Pending'),
});
export const followupUpdateBody = followupBody.partial().extend({ outcome: zOptStr });
export const taskBody = z.object({
  title: z.string().trim().min(3, 'is required').max(160),
  description: zOptStr,
  assigned_to: zId.optional().nullable(),
  priority: z.enum(TASK_PRIORITIES).default('Medium'),
  due_date: zDate.optional().nullable().or(z.literal('').transform(() => null)),
  lead_id: zId.optional().nullable(),
  customer_id: zId.optional().nullable(),
  status: z.enum(TASK_STATUSES).default('Todo'),
});

// ─── Finance ─────────────────────────────────────────────────────────────
export const paymentBody = z.object({
  amount: z.coerce.number().int('must be a whole rupee amount').positive('must be greater than zero'),
  method: z.enum(PAYMENT_METHODS),
  payment_date: zDate,
  reference: zOptStr,
  notes: zOptStr,
  status: z.enum(['Completed', 'Pending']).default('Completed'),
});
export type PaymentInput = z.input<typeof paymentBody>;
export const transactionBody = paymentBody.extend({ customer_id: zId, installment_id: zId.optional().nullable() });
export const transactionStatusBody = z.object({ status: z.enum(['Completed', 'Pending', 'Failed']) });

// ─── Documents ───────────────────────────────────────────────────────────
export const documentUploadFields = z.object({
  entity_type: z.enum(DOCUMENT_ENTITIES),
  entity_id: z.coerce.number().int().positive(),
  doc_type: z.enum(DOCUMENT_TYPES),
  name: z.string().trim().max(160).optional(),
});
export const portalUploadFields = z.object({ doc_type: z.enum(CUSTOMER_UPLOAD_TYPES), name: z.string().trim().max(160).optional() });

// ─── Customer requests ───────────────────────────────────────────────────
export const customerRequestBody = z.object({
  type: z.enum(CUSTOMER_REQUEST_TYPES),
  subject: z.string().trim().min(3, 'is required').max(140),
  message: z.string().trim().max(2000).optional().nullable(),
  preferred_date: zDate.optional().nullable().or(z.literal('').transform(() => null)),
});
export const customerRequestUpdateBody = z.object({
  status: z.enum(CUSTOMER_REQUEST_STATUSES).optional(),
  response: z.string().trim().max(2000).optional().nullable(),
});

// ─── Users ───────────────────────────────────────────────────────────────
export const userBody = z.object({
  name: z.string().trim().min(2, 'is required').max(80),
  email: zEmail,
  role: z.enum(ROLE_KEYS),
  phone: z.string().trim().max(20).optional().nullable(),
  title: z.string().trim().max(60).optional().nullable(),
  customer_id: z.coerce.number().int().positive().optional().nullable(),
  password: z.string().optional(),
});
export const userStatusBody = z.object({ status: z.enum(['Active', 'Inactive']) });

// ─── Brokers, expenses, staff ────────────────────────────────
export const brokerBody = z.object({
  name: z.string().trim().min(2, 'is required').max(80),
  phone: zPhone.optional().nullable().or(z.literal('').transform(() => null)),
  firm: zOptStr,
  commission_pct: z.coerce.number().min(0).max(20, 'looks too high'),
  status: z.enum(['Active', 'Inactive']).default('Active'),
  notes: zOptStr,
});
export const commissionPayBody = z.object({ paid_on: zDate, method: z.enum(PAYMENT_METHODS) });
export const expenseBody = z.object({
  expense_date: zDate,
  category: z.enum(EXPENSE_CATEGORIES),
  description: z.string().trim().min(2, 'is required').max(200),
  amount: zMoney.refine((n) => n > 0, 'must be more than zero'),
  method: z.enum(PAYMENT_METHODS),
  paid_to: zOptStr,
  reference: zOptStr,
});
export const expenseListQuery = listQuery.extend({ category: z.enum(EXPENSE_CATEGORIES).optional().or(z.literal('').transform(() => undefined)), from: optDate, to: optDate });
export const zMonth = z.string().regex(/^\d{4}-\d{2}$/, 'must be a month (YYYY-MM)');
export const staffPayBody = z.object({ monthly_salary: zMoney.optional(), monthly_target: zMoney.optional() });
export const salaryPaymentBody = z.object({
  user_id: zId,
  month: zMonth,
  amount: zMoney.refine((n) => n > 0, 'must be more than zero'),
  paid_on: zDate,
  method: z.enum(PAYMENT_METHODS),
  notes: zOptStr,
});
export const attendanceMarkBody = z.object({
  user_id: zId,
  date: zDate,
  status: z.enum(ATTENDANCE_STATUSES),
  notes: zOptStr,
});
export const attendanceCheckBody = z.object({ lat: zLat.optional().nullable(), lng: zLng.optional().nullable() });

// ─── Settings ────────────────────────────────────────────────────────────
const list = z.array(z.string().trim().min(1).max(40)).min(1).max(30);
export const settingsSchemas = {
  company: z.object({
    name: z.string().trim().min(2).max(120),
    tagline: z.string().trim().max(120).default(''),
    legal_name: z.string().trim().max(160).default(''),
    email: z.string().trim().max(120).default(''),
    phone: z.string().trim().max(30).default(''),
    website: z.string().trim().max(160).default(''),
    address: z.string().trim().max(400).default(''),
    gstin: z.string().trim().max(20).default(''),
    rera: z.string().trim().max(60).default(''),
    receipt_prefix: z.string().trim().min(1).max(10).regex(/^[A-Z0-9-]+$/i, 'letters, numbers and dashes only'),
    currency: z.string().default('INR'),
  }),
  lead_statuses: list,
  lead_sources: list,
  property_types: list,
  payment_methods: list,
  notifications: z.object(Object.fromEntries(NOTIFICATION_TRIGGERS.map((k) => [k, z.boolean()])) as Record<(typeof NOTIFICATION_TRIGGERS)[number], z.ZodBoolean>),
  security: z.object({
    session_hours: z.coerce.number().int().min(1).max(720),
    password_min_length: z.coerce.number().int().min(8).max(64),
    enforce_strong_passwords: z.boolean(),
    max_failed_logins: z.coerce.number().int().min(3).max(20).default(5),
    lockout_minutes: z.coerce.number().int().min(1).max(1440).default(15),
  }),
  lead_capture: z.object({ enabled: z.boolean(), default_source: z.enum(LEAD_SOURCES).default('Website') }),
  targets: z.object({
    monthly_collections: z.coerce.number().int().min(0).max(10_000_000_000),
    monthly_bookings: z.coerce.number().int().min(0).max(10_000_000_000),
  }),
  assignment: z.object({
    mode: z.enum(['round_robin', 'none']),
    pool: z.array(zId).max(100).default([]),
    apply_to_imports: z.boolean().default(true),
  }),
};

export type ConvertData = z.infer<typeof convertBody>;
export type PaymentData = z.infer<typeof paymentBody>;
export type LeadData = z.infer<typeof leadBody>;
