import type {
  ClientKind,
  CustomerRequestStatus,
  DealStage,
  DocumentEntity,
  FollowupStatus,
  InstallmentStatus,
  LeadPriority,
  PropertyStatus,
  RegistryStatus,
  ExpenseCategory,
  AttendanceStatus,
  Role,
  TaskPriority,
  TaskStatus,
  TransactionStatus,
  VisitStatus,
} from './constants.js';

export type ISODate = string; // YYYY-MM-DD
export type ISODateTime = string; // full ISO-8601 timestamp

// ─── Envelope ────────────────────────────────────────────────────────────
export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  pages: number;
  hasMore: boolean;
  /** Opaque token for the next page ("load more"); null on the last page. */
  nextCursor: string | null;
  [aggregate: string]: unknown;
}
export interface Paginated<T, M extends Record<string, unknown> = Record<string, never>> {
  data: T[];
  meta: PageMeta & M;
}
export interface ApiErrorBody {
  error: string;
  details?: unknown;
  requestId?: string;
}

// ─── Auth ────────────────────────────────────────────────────────────────
export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  phone?: string | null;
  title?: string | null;
  status: 'Active' | 'Inactive';
  monthly_salary?: number;
  monthly_target?: number;
  customer_id?: number | null;
  customer_name?: string | null;
  leads_count?: number;
  last_login?: string | null;
  locked_until?: string | null;
  active_sessions?: number;
  created_at?: string;
}
export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  client: ClientKind;
  user: User;
}
export interface ServerMeta {
  app: string;
  mode: 'demo' | 'production';
  version: string;
  minAppVersion: string;
  serverTime: string;
}

// ─── CRM ─────────────────────────────────────────────────────────────────
export interface Lead {
  id: number;
  code: string;
  name: string;
  phone: string;
  email?: string | null;
  location?: string | null;
  source: string;
  source_detail?: string | null;
  property_id?: number | null;
  property_name?: string | null;
  property_project?: string | null;
  property_unit?: string | null;
  property_price?: number | null;
  property_type?: string | null;
  budget?: number | null;
  requirement?: string | null;
  status: string;
  priority: LeadPriority;
  assigned_to?: number | null;
  agent_name?: string | null;
  last_contact?: string | null;
  next_followup?: string | null;
  customer_id?: number | null;
  lost_reason?: string | null;
  created_by?: number | null;
  created_at: string;
  updated_at?: string;
  last_activity?: string | null;
  last_activity_at?: string | null;
}

export interface Activity {
  id: number;
  lead_id?: number | null;
  customer_id?: number | null;
  property_id?: number | null;
  type: string;
  title: string;
  description?: string | null;
  user_id?: number | null;
  user_name?: string | null;
  lead_name?: string | null;
  customer_name?: string | null;
  created_at: string;
}

export interface AuditEntry extends Activity {
  action: string | null;
  entity_type: string | null;
  entity_id: number | null;
  ip: string | null;
  request_id: string | null;
  user_role?: Role | null;
}

export interface Followup {
  id: number;
  lead_id: number;
  lead_name: string;
  lead_phone?: string;
  lead_code?: string;
  lead_status?: string;
  agent_id?: number | null;
  agent_name?: string | null;
  property_project?: string | null;
  due_date: ISODate;
  due_time: string;
  type: string;
  notes?: string | null;
  status: FollowupStatus;
  outcome?: string | null;
  completed_at?: string | null;
  overdue_at?: string | null;
}

export interface SiteVisit {
  id: number;
  lead_id: number;
  lead_name: string;
  lead_phone?: string;
  lead_code?: string;
  property_id?: number | null;
  property_project?: string | null;
  property_unit?: string | null;
  property_name?: string | null;
  property_location?: string | null;
  agent_id?: number | null;
  agent_name?: string | null;
  visit_date: ISODate;
  visit_time: string;
  status: VisitStatus;
  feedback?: string | null;
  next_action?: string | null;
  outcome?: string | null;
  checked_in_at?: string | null;
  checkin_lat?: number | null;
  checkin_lng?: number | null;
  checked_out_at?: string | null;
  checkout_lat?: number | null;
  checkout_lng?: number | null;
  photos?: number;
}

export interface Property {
  id: number;
  code: string;
  name: string;
  project: string;
  location: string;
  city: string;
  type: string;
  unit_number: string;
  block?: string | null;
  rate_per_sqft?: number | null;
  tower?: string | null;
  floor?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  area_sqft: number;
  price: number;
  status: PropertyStatus;
  facing?: string | null;
  furnishing?: string | null;
  parking?: number | null;
  possession?: string | null;
  construction_stage?: string | null;
  rera_number?: string | null;
  description?: string | null;
  amenities: string[];
  assigned_to?: number | null;
  agent_name?: string | null;
  interested_count?: number;
  customer_name?: string | null;
  cover_document_id?: number | null;
  slug?: string | null;
  is_published?: boolean | number;
  cover?: PropertyImage | null;
  images?: PropertyImage[];
}

export type ImageSize = 'thumb' | 'medium' | 'large';

/** A gallery image; urls are API-relative (prefix the server URL) and signed when the property is unpublished. */
export interface PropertyImage {
  id: number;
  property_id: number;
  alt_text: string;
  caption?: string | null;
  kind: string;
  is_cover: boolean;
  is_ai_generated: boolean;
  source: 'upload' | 'generated';
  sort_order: number;
  width?: number | null;
  height?: number | null;
  size?: number | null;
  urls: Record<ImageSize, string>;
}

export interface Installment {
  id: number;
  customer_id: number;
  deal_id?: number | null;
  number: number;
  label: string;
  due_date: ISODate;
  amount: number;
  paid_amount: number;
  balance: number;
  status: InstallmentStatus;
  payment_date?: string | null;
  customer_name?: string;
  customer_code?: string;
  customer_phone?: string;
  property_project?: string | null;
  property_unit?: string | null;
}

export interface Transaction {
  id: number;
  code: string;
  receipt_number?: string | null;
  customer_id: number;
  customer_name?: string;
  customer_code?: string;
  customer_phone?: string;
  property_project?: string | null;
  property_unit?: string | null;
  installment_id?: number | null;
  installment_label?: string | null;
  type: string;
  amount: number;
  method: string;
  payment_date: ISODate;
  reference?: string | null;
  status: TransactionStatus;
  notes?: string | null;
  recorded_by_name?: string | null;
  created_at?: string;
}

export interface Financials {
  total_value: number;
  booking_amount: number;
  paid: number;
  outstanding: number;
  overdue: number;
  progress: number;
  installments: number;
  paid_installments: number;
  next_installment: Pick<Installment, 'id' | 'number' | 'label' | 'due_date' | 'amount' | 'paid_amount' | 'balance'> | null;
}

export interface Customer {
  id: number;
  code: string;
  lead_id?: number | null;
  name: string;
  phone: string;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  occupation?: string | null;
  pan?: string | null;
  aadhaar?: string | null;
  property_id?: number | null;
  property_name?: string | null;
  property_project?: string | null;
  property_unit?: string | null;
  property_type?: string | null;
  booking_date: ISODate;
  total_value: number;
  paid: number;
  outstanding: number;
  overdue: number;
  next_due_date?: string | null;
  status: 'Active' | 'Completed' | 'Cancelled';
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  assigned_to?: number | null;
  agent_name?: string | null;
  property_block?: string | null;
  nominee_name?: string | null;
  nominee_relation?: string | null;
  nominee_phone?: string | null;
  nominee_aadhaar?: string | null;
  registry_status?: RegistryStatus;
  registry_date?: string | null;
  registry_number?: string | null;
  broker_id?: number | null;
  broker_name?: string | null;
  /** Latest "Photo" document uploaded on the customer, shown as their picture. */
  photo_document_id?: number | null;
}

export interface Broker {
  id: number;
  name: string;
  phone?: string | null;
  firm?: string | null;
  commission_pct: number;
  status: 'Active' | 'Inactive';
  notes?: string | null;
  customers_count?: number;
  commission_due?: number;
  commission_paid?: number;
  created_at: string;
}
export interface BrokerCommission {
  id: number;
  broker_id: number;
  broker_name?: string;
  customer_id: number;
  customer_name?: string;
  customer_code?: string;
  transaction_id: number;
  receipt_number?: string | null;
  payment_date?: string;
  payment_amount: number;
  pct: number;
  amount: number;
  status: 'Due' | 'Paid';
  paid_on?: string | null;
  paid_method?: string | null;
  created_at: string;
}
export interface Expense {
  id: number;
  expense_date: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  method: string;
  paid_to?: string | null;
  reference?: string | null;
  recorded_by?: number | null;
  recorded_by_name?: string | null;
  created_at: string;
}
export interface SalaryPayment {
  id: number;
  user_id: number;
  user_name?: string;
  month: string;
  amount: number;
  paid_on: string;
  method: string;
  notes?: string | null;
  created_at: string;
}
/** One staff member's salary for a month: what is due, what was paid and what is left. */
export interface SalaryRow {
  user_id: number;
  name: string;
  title?: string | null;
  role: Role;
  monthly_salary: number;
  paid: number;
  balance: number;
  payments: SalaryPayment[];
}
export interface AttendanceRecord {
  id?: number;
  user_id: number;
  name?: string;
  title?: string | null;
  date: string;
  status: AttendanceStatus | null;
  check_in_at?: string | null;
  check_out_at?: string | null;
  notes?: string | null;
}
export interface TargetRow {
  user_id: number;
  name: string;
  title?: string | null;
  monthly_target: number;
  achieved: number;
  bookings: number;
  collected: number;
}
/** Plot map: every unit, grouped by project and block. */
export interface PlotMapUnit {
  id: number;
  project: string;
  block: string | null;
  unit_number: string;
  type: string;
  status: PropertyStatus;
  area_sqft: number;
  price: number;
  customer_name?: string | null;
}
export interface PropertyHistoryEntry {
  customer_id: number;
  customer_code: string;
  customer_name: string;
  booking_date: string;
  total_value: number;
  status: 'Active' | 'Completed' | 'Cancelled';
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  agent_name?: string | null;
  registry_status?: RegistryStatus;
  registry_date?: string | null;
}
/** "At a glance" numbers shown first on the dashboard. */
export interface Overview {
  plots: { total: number; available: number; hold: number; booked: number; sold: number };
  today_collection: number;
  today_count: number;
  total_pending: number;
  overdue: number;
  registry_pending: number;
  registry_due_15: number;
  attendance: { staff: number; present: number; half_day: number; leave: number; absent: number; not_marked: number } | null;
}

export interface Deal {
  id: number;
  code: string;
  lead_id?: number | null;
  customer_id: number;
  customer_name?: string;
  customer_code?: string;
  property_id?: number | null;
  property_project?: string | null;
  property_unit?: string | null;
  property_type?: string | null;
  agent_name?: string | null;
  agent_id?: number | null;
  value: number;
  booking_amount: number;
  discount: number;
  stage: DealStage | string;
  status: string;
  booking_date: ISODate;
  closed_at?: string | null;
  paid?: number;
  notes?: string | null;
}

export interface DocumentItem {
  id: number;
  entity_type: DocumentEntity;
  entity_id: number;
  entity_name?: string | null;
  name: string;
  doc_type: string;
  mime?: string | null;
  size?: number | null;
  uploaded_by?: number | null;
  uploaded_by_name?: string | null;
  created_at: string;
}

export interface Task {
  id: number;
  title: string;
  description?: string | null;
  assigned_to?: number | null;
  assignee_name?: string | null;
  created_by?: number | null;
  creator_name?: string | null;
  priority: TaskPriority;
  due_date?: ISODate | null;
  lead_id?: number | null;
  lead_name?: string | null;
  lead_code?: string | null;
  customer_id?: number | null;
  customer_name?: string | null;
  status: TaskStatus;
  completed_at?: string | null;
}

export interface NotificationItem {
  id: number;
  type: string;
  title: string;
  message: string;
  link?: string | null;
  is_read: boolean;
  created_at: string;
}

export interface DirectoryUser {
  id: number;
  name: string;
  role: Role;
  title?: string | null;
  phone?: string | null;
}

export interface Company {
  name: string;
  legal_name?: string;
  tagline?: string;
  email?: string;
  phone?: string;
  website?: string;
  address?: string;
  gstin?: string;
  rera?: string;
  receipt_prefix: string;
  currency?: string;
}

export interface CustomerRequest {
  id: number;
  customer_id: number;
  customer_name?: string;
  customer_code?: string;
  customer_phone?: string;
  agent_name?: string | null;
  type: string;
  subject: string;
  message?: string | null;
  preferred_date?: ISODate | null;
  status: CustomerRequestStatus;
  response?: string | null;
  handled_by?: number | null;
  handled_by_name?: string | null;
  created_at: string;
  updated_at?: string | null;
}

export interface ResetRequest {
  id: number;
  user_id: number | null;
  email: string;
  user_name?: string | null;
  user_role?: Role | null;
  status: 'Pending' | 'Issued' | 'Completed' | 'Dismissed';
  requested_at: string;
  issued_at?: string | null;
  issued_by_name?: string | null;
  code_expires_at?: string | null;
  completed_at?: string | null;
  note?: string | null;
}

/** Returned once when a reset code is issued; only its hash is stored. */
export interface IssuedResetCode {
  code: string;
  expires_at: string;
  user: { id: number; name: string; email: string };
}

export interface ReceiptData {
  id: number;
  code: string;
  receipt_number?: string | null;
  type: string;
  amount: number;
  method: string;
  payment_date: string;
  reference?: string | null;
  status: string;
  notes?: string | null;
  installment_label?: string | null;
  installment_number?: number | null;
  property_project?: string | null;
  property_unit?: string | null;
  property_name?: string | null;
  property_location?: string | null;
  property_city?: string | null;
  recorded_by_name?: string | null;
  customer: { id: number; code: string; name: string; phone: string; email?: string | null; address?: string | null; city?: string | null; total_value: number };
  company: Company;
  paid_to_date: number;
  outstanding_after: number;
}

export interface PortalData {
  customer: Customer & { agent_name?: string | null; agent_phone?: string | null; agent_email?: string | null };
  property: (Property & { amenities: string[] }) | null;
  gallery?: PropertyImage[];
  deal: Pick<Deal, 'code' | 'stage' | 'booking_date' | 'value' | 'booking_amount'> | null;
  installments: Installment[];
  transactions: Transaction[];
  documents: DocumentItem[];
  financials: Financials;
  company: Company;
  requests: CustomerRequest[];
}

export interface ScheduleRow {
  number: number;
  label: string;
  due_date: ISODate;
  amount: number;
}

/** A change broadcast over /api/events. */
export interface RealtimeEvent {
  type: 'change' | 'notification' | 'hello' | 'ping';
  resources?: string[];
  id?: number;
  at: string;
  notification?: NotificationItem;
}
