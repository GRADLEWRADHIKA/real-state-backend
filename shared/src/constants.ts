export const ROLES = [
  { key: 'admin', name: 'Administrator', description: 'Full access to every module, users and settings' },
  { key: 'manager', name: 'Sales Manager', description: 'Team leads, pipeline, assignments and sales reports' },
  { key: 'sales', name: 'Sales Executive', description: 'Assigned leads, follow-ups, site visits and customers' },
  { key: 'accounts', name: 'Accounts / Finance', description: 'Payments, installments, transactions and financial reports' },
  { key: 'customer', name: 'Customer', description: 'Customer portal: property, payments, receipts and documents' },
] as const;

export type Role = (typeof ROLES)[number]['key'];
/** @deprecated use Role */
export type RoleKey = Role;
export const ROLE_KEYS = ROLES.map((r) => r.key) as [Role, ...Role[]];
export const STAFF: Role[] = ['admin', 'manager', 'sales', 'accounts'];
export const SALES_ROLES: Role[] = ['admin', 'manager', 'sales'];
export const FINANCE_ROLES: Role[] = ['admin', 'accounts'];
export const ROLE_LABEL: Record<Role, string> = Object.fromEntries(ROLES.map((r) => [r.key, r.name])) as Record<Role, string>;

/**
 * Job titles offered when adding staff. Each one signs in with its own login and gets the access of
 * its role: Director and GM see everything, Accountant only money, Telecaller and Sales Person only
 * their own leads and customers.
 */
export const DESIGNATIONS = [
  { title: 'Director', role: 'admin', description: 'Sees and manages everything' },
  { title: 'General Manager', role: 'admin', description: 'Sees and manages everything' },
  { title: 'Sales Manager', role: 'manager', description: 'Whole sales team, leads and customers; no accounts' },
  { title: 'Accountant', role: 'accounts', description: 'Payments, receipts, expenses and salaries only' },
  { title: 'Sales Person', role: 'sales', description: 'Only their own leads and customers' },
  { title: 'Telecaller', role: 'sales', description: 'Only their own leads and customers' },
] as const satisfies readonly { title: string; role: Role; description: string }[];

// ─── Front-ends ──────────────────────────────────────────────────────────
export const CLIENTS = ['dashboard', 'app'] as const;
export type ClientKind = (typeof CLIENTS)[number];
export const CLIENT_HEADER = 'X-EstateFlow-Client';

/** Which roles may sign in to which front-end. Enforced by the server at login and on every request. */
export const CLIENT_ACCESS: Record<ClientKind, Role[]> = {
  dashboard: ['admin', 'manager', 'sales', 'accounts'],
  app: ['admin', 'manager', 'sales', 'accounts', 'customer'],
};
export const CUSTOMER_DASHBOARD_MESSAGE =
  'Customer accounts use the EstateFlow mobile app. Please sign in from the app to see your property, payments and receipts.';

// ─── Domain enums ────────────────────────────────────────────────────────
export const LEAD_STATUSES = ['New', 'Contacted', 'Qualified', 'Site Visit', 'Negotiation', 'Booked', 'Closed', 'Lost'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const LEAD_PIPELINE_ORDER: LeadStatus[] = ['New', 'Contacted', 'Qualified', 'Site Visit', 'Negotiation', 'Booked', 'Closed'];
export const ACTIVE_STAGES: LeadStatus[] = ['Qualified', 'Site Visit', 'Negotiation'];
export const LEAD_SOURCES = ['Website', 'Facebook', 'Instagram', 'Google', 'Referral', 'Walk-in', 'Broker'] as const;
export const LEAD_PRIORITIES = ['Hot', 'Warm', 'Cold'] as const;
export type LeadPriority = (typeof LEAD_PRIORITIES)[number];
export const CONTACT_CHANNELS = ['Call', 'WhatsApp', 'SMS', 'Email'] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];
export const PROPERTY_TYPES = ['Apartment', 'Villa', 'Plot', 'Commercial', 'Office', 'Shop'] as const;
export const PROPERTY_STATUSES = ['Available', 'Reserved', 'Booked', 'Sold'] as const;
/** "Reserved" is the hold status: shown as "Hold" on the plot map. */
export const REGISTRY_STATUSES = ['Not done', 'Date fixed', 'Done'] as const;
export type RegistryStatus = (typeof REGISTRY_STATUSES)[number];
/** Days before a fixed registry date when staff and the customer are reminded. */
export const REGISTRY_REMINDER_DAYS = [15, 7, 1, 0] as const;
export const EXPENSE_CATEGORIES = ['Site', 'Office', 'Marketing', 'Salary advance', 'Legal & registry', 'Other'] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export const ATTENDANCE_STATUSES = ['Present', 'Half day', 'Leave', 'Absent'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
export const COMMISSION_STATUSES = ['Due', 'Paid'] as const;
export type PropertyStatus = (typeof PROPERTY_STATUSES)[number];
export const PAYMENT_METHODS = ['Bank Transfer', 'UPI', 'Cheque', 'Cash', 'Card', 'Finance'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const TRANSACTION_STATUSES = ['Completed', 'Pending', 'Failed'] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];
export const INSTALLMENT_STATUSES = ['Pending', 'Partially Paid', 'Paid', 'Overdue'] as const;
export type InstallmentStatus = (typeof INSTALLMENT_STATUSES)[number];
export const VISIT_STATUSES = ['Scheduled', 'Completed', 'Cancelled', 'Rescheduled'] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];
export const VISIT_OUTCOMES = ['Interested', 'Very interested', 'Needs time', 'Price concern', 'Not interested', 'Booked on site'] as const;
export const FOLLOWUP_TYPES = ['Call', 'WhatsApp', 'Email', 'Meeting', 'Site Visit'] as const;
export const FOLLOWUP_STATUSES = ['Pending', 'Completed', 'Missed'] as const;
export type FollowupStatus = (typeof FOLLOWUP_STATUSES)[number];
export const TASK_PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export const TASK_STATUSES = ['Todo', 'In Progress', 'Completed'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const DEAL_STAGES = ['Booked', 'Agreement Signed', 'Registration', 'Possession'] as const;
export type DealStage = (typeof DEAL_STAGES)[number];
export const CUSTOMER_STATUSES = ['Active', 'Completed', 'Cancelled'] as const;
export const DOCUMENT_TYPES = ['Aadhaar', 'PAN', 'Agreement', 'Booking Form', 'Payment Receipt', 'Property Documents', 'ID Proof', 'Requirement', 'Photo', 'Brochure', 'Other'] as const;
export const CUSTOMER_UPLOAD_TYPES = ['Aadhaar', 'PAN', 'ID Proof', 'Requirement', 'Other'] as const;
export const DOCUMENT_ENTITIES = ['lead', 'customer', 'property', 'deal', 'site_visit'] as const;
export type DocumentEntity = (typeof DOCUMENT_ENTITIES)[number];
export const CUSTOMER_REQUEST_TYPES = ['Site visit', 'Query', 'Document', 'Payment', 'Complaint'] as const;
export const CUSTOMER_REQUEST_STATUSES = ['Open', 'In Progress', 'Resolved', 'Closed'] as const;
export type CustomerRequestStatus = (typeof CUSTOMER_REQUEST_STATUSES)[number];
export const RESET_REQUEST_STATUSES = ['Pending', 'Issued', 'Completed', 'Dismissed'] as const;
export const USER_STATUSES = ['Active', 'Inactive'] as const;

/** Construction / possession milestones shown to customers when a deal records them. */
export const CONSTRUCTION_STAGES = ['Booking', 'Foundation', 'Structure', 'Finishing', 'Ready for possession', 'Handed over'] as const;

// ─── Uploads ─────────────────────────────────────────────────────────────
export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const UPLOAD_ALLOWED: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.ms-excel': ['.xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'text/plain': ['.txt'],
  'text/csv': ['.csv'],
};
export const UPLOAD_ACCEPT = Object.values(UPLOAD_ALLOWED).flat().join(',');

// ─── Lists ───────────────────────────────────────────────────────────────
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 500;

export const BUDGET_RANGES = [
  { label: 'Under ₹25 L', min: 0, max: 2500000 },
  { label: '₹25 L – ₹50 L', min: 2500000, max: 5000000 },
  { label: '₹50 L – ₹1 Cr', min: 5000000, max: 10000000 },
  { label: 'Above ₹1 Cr', min: 10000000, max: undefined },
] as const;

/** Server-sent event resource names: clients invalidate matching query keys. */
export const REALTIME_RESOURCES = [
  'leads',
  'customers',
  'deals',
  'properties',
  'site-visits',
  'followups',
  'tasks',
  'finance',
  'documents',
  'notifications',
  'customer-requests',
  'users',
  'settings',
  'portal',
] as const;
export type RealtimeResource = (typeof REALTIME_RESOURCES)[number];

export const NOTIFICATION_TRIGGERS = ['lead_assigned', 'followup_reminder', 'site_visit_reminder', 'installment_due', 'payment_received', 'customer_request', 'daily_digest'] as const;
export type NotificationTrigger = (typeof NOTIFICATION_TRIGGERS)[number];

export const DEFAULT_SETTINGS = {
  company: {
    name: 'Starwiz Realty Pvt. Ltd.',
    legal_name: 'Starwiz Realty Private Limited',
    tagline: 'Your Trust. Our Vision.',
    email: 'info@starwizrealty.com',
    phone: '0522 4216867',
    website: 'https://www.starwizrealty.com',
    address: 'Brahamkunj Complex, First Floor, Hall No. 3, Opp. Phoenix Mall, LDA Colony, Kanpur Road, Ashiyana, Lucknow, Uttar Pradesh',
    gstin: '',
    rera: '',
    receipt_prefix: 'SWR',
    currency: 'INR',
  },
  lead_statuses: [...LEAD_STATUSES] as string[],
  lead_sources: [...LEAD_SOURCES] as string[],
  property_types: [...PROPERTY_TYPES] as string[],
  payment_methods: [...PAYMENT_METHODS] as string[],
  notifications: {
    payment_received: true,
    lead_assigned: true,
    followup_reminder: true,
    site_visit_reminder: true,
    installment_due: true,
    customer_request: true,
    daily_digest: false,
  } as Record<NotificationTrigger, boolean>,
  security: {
    session_hours: 12,
    password_min_length: 8,
    enforce_strong_passwords: true,
    max_failed_logins: 5,
    lockout_minutes: 15,
  },
  lead_capture: {
    enabled: false,
    key_prefix: '',
    key_hash: '',
    key_created_at: '',
    default_source: 'Website',
  },
  /** Monthly company targets shown against actuals on the dashboard (0 = no target). */
  targets: {
    monthly_collections: 0,
    monthly_bookings: 0,
  },
  assignment: {
    mode: 'round_robin' as 'round_robin' | 'none',
    /** User ids in the rotation; empty = every active sales executive. */
    pool: [] as number[],
    apply_to_imports: true,
    last_user_id: 0,
  },
};
export type Settings = typeof DEFAULT_SETTINGS;
export type SettingsKey = keyof Settings;
export const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS) as SettingsKey[];
/** Settings whose values are secrets and never leave the server. */
export const PRIVATE_SETTING_FIELDS: Partial<Record<SettingsKey, string[]>> = { lead_capture: ['key_hash'] };
