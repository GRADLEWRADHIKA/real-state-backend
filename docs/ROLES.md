# Roles and permissions

EstateFlow has five roles. The server enforces every rule here, in `authorize()`, `scope()`, `dashboardOnly` and `adminAppReadOnly` (`server/src/middleware/auth.ts`) and in the route handlers. The dashboard and the app hide what a role cannot do, but they are not the protection. [API.md](API.md) lists the roles for each endpoint.

| Role | Who | Dashboard | App |
|---|---|---|---|
| `admin` | Administrator: full access, users, settings, audit | Yes, full | Yes, **read-mostly**: writes are refused with "Administrators can make this change from the dashboard" |
| `manager` | Sales Manager: the whole team's leads, pipeline, assignments, sales reports | Yes | Yes |
| `sales` | Sales Executive: **only records assigned to them** | Yes | Yes (main field user) |
| `accounts` | Accounts / Finance: payments, installments, transactions, financial reports | Yes | Yes |
| `customer` | A buyer: their own booking, payments, receipts, documents and requests | **No**. Sign-in is refused with a message pointing to the app | Yes, the customer portal |

## Matrix

✅ allowed · 👤 only their own or assigned records · 👁 read only · — not allowed

| Area | Admin | Manager | Sales | Accounts | Customer |
|---|---|---|---|---|---|
| **Dashboard overview / KPIs** | ✅ | ✅ | 👤 (no team leaderboard, no targets) | Finance overview and "My day" | — |
| **Leads**: list, view, create, edit, stage, notes, contact log | ✅ | ✅ | 👤 | — | — |
| Leads: assign / bulk assign, merge duplicates, delete | ✅ | ✅ | — | — | — |
| Leads: CSV import, export, bulk delete *(dashboard only)* | ✅ | ✅ | — | — | — |
| Lead → customer conversion (booking) | ✅ | ✅ | 👤 | — | — |
| **Pipeline** (drag between stages) | ✅ | ✅ | 👤 | — | — |
| **Site visits**: schedule, check-in/out with GPS, photos | ✅ | ✅ | 👤 | — | — |
| **Follow-ups** | ✅ | ✅ | 👤 | — | — |
| **Tasks** | ✅ all | ✅ all | 👤 assigned to or created by them | 👤 assigned to or created by them | — |
| **Customers**: view, ledger, notes | ✅ | ✅ | 👤 | ✅ | Own record via portal |
| Customers: edit | ✅ | ✅ | 👤 (cannot reassign) | ✅ (cannot reassign) | — |
| Customers: direct booking without a lead | ✅ | ✅ | ✅ | — | — |
| Customers: cancel a booking | ✅ | ✅ | — | — | — |
| **Deals**: view | ✅ | ✅ | 👤 | ✅ | — |
| Deals: change stage | ✅ | ✅ | 👤 | 👁 | — |
| **Properties**: view | ✅ | ✅ | ✅ | ✅ | Own unit via portal |
| Properties: create, edit | ✅ | ✅ | — | — | — |
| Properties: delete | ✅ | — | — | — | — |
| **Finance overview, transactions list, installments** | ✅ | — | — | ✅ | — |
| Record a payment, change a transaction's status | ✅ | — | — | ✅ | — |
| View or download a receipt | ✅ | ✅ | 👤 | ✅ | Own receipts |
| **Documents**: list, upload | ✅ | ✅ | 👤 (their leads, customers and visits) | ✅ | Own KYC uploads via portal |
| Documents: delete | ✅ | ✅ | Only files they uploaded | Only files they uploaded | — |
| **Customer requests** (inbox, status, reply) | ✅ | ✅ | 👤 (their customers) | ✅ | Raise and track their own |
| **Reports** and CSV/PDF export | ✅ | ✅ | — | ✅ | — |
| **Users**: create, edit, activate/deactivate, force logout, unlock | ✅ | — | — | — | — |
| Password reset requests: issue a code, dismiss | ✅ any account | Sales and customer accounts | — | — | — |
| **Settings**: company, lists, notifications, security policy, targets, lead-capture key, auto-assignment *(dashboard only)* | ✅ | — | — | — | — |
| **Audit log** and CSV export *(dashboard only)* | ✅ | — | — | — | — |
| Global search | ✅ | ✅ | 👤 | ✅ | — |
| Own profile, password, notifications, sign out everywhere | ✅ | ✅ | ✅ | ✅ | ✅ |

## Rules that apply across roles

- **Client binding.** Every token is issued to one client (`dashboard` or `app`), and requests from the other client are refused. A customer token never works on the dashboard.
- **Scoping for sales.** Lists filter in SQL to `assigned_to` / `agent_id` = the user. Opening another executive's record by id returns 403. Tasks cannot link to another executive's lead or customer.
- **Admin in the app.** Admins can read everything in the app, but every write (including recording payments) must be made from the dashboard.
- **Website leads.** `POST /api/public/leads` takes no user account. It is authenticated by the lead-capture key an admin generates in Settings; only its hash is stored. New leads are assigned round-robin to active sales executives, or to the configured pool.
- **Sessions.** Changing a password, deactivating a user or forcing a logout ends that user's sessions on every device. After repeated failed sign-ins the account locks for the period set in Settings → Security; an admin can unlock it.
