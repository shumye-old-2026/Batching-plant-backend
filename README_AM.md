# Batching Plant ERP — Backend Foundation (Preview)

ይህ ጥቅል የEnterprise ERP ማሻሻያ መነሻ ነው፤ ሙሉ የProduction-ready ERP ወይም የአሁኑ HTML በቀጥታ የተተካ አይደለም።

## ያለው
- PostgreSQL መሠረታዊ schema: users/sessions, customers, orders, approval history, audit events, inventory core, invoices, receipts.
- Backend: Login/logout/me, RBAC scaffolding, per-plant filtering, Sales order creation, Marketing decision, simple order summary endpoint.
- Sales orders start at `PENDING_MARKETING_MANAGER_APPROVAL`; decisions and audit events are recorded transactionally.
- Request validation, password hashing support, secure cookie defaults, rate limit, Helmet.

## አስፈላጊ የገደብ ማስታወሻ
የአሁኑ HTML/localStorage ሞጁሎች ወደዚህ API ገና አልተያያዙም። Lab/Finance/Production/Dispatch/Gate approvals, full ledger/accounting, payroll/attendance, fleet/commission, SMS/Telegram, reconciliation, reports, automated tests, deployment hardening ገና ሙሉ ተግባራዊ አይደሉም። Audit is app-level; database permissions/immutable log shipping and monitoring need deployment design.

## ለDeveloper የማስነሻ እርምጃዎች
1. Node.js 20+ እና PostgreSQL ያዘጋጁ።
2. `npm install`
3. `.env.example` ወደ `.env` ቅዳ፤ የDB password፣ JWT secret እና CORS origin ቀይር። በProduction secure cookies/HTTPS ያስፈልጋሉ።
4. `migrations/001_core.sql` በPostgreSQL ላይ አስኪድ።
5. የመጀመሪያው SYS_ADMIN account በተለየ የአስተዳዳሪ provisioning script መፍጠር አለበት፤ public signup አልተከፈተም።
6. `npm start`

## API (starter)
- `GET /api/health`
- `POST /api/auth/login` `{username,password}`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `POST /api/orders`
- `GET /api/orders`
- `POST /api/orders/:id/marketing-decision` `{decision,note?}`
- `GET /api/reports/summary?plant=BOLE`

## Before live deployment
- Independent security review and end-to-end tests
- Password reset / MFA / account lockouts / session revocation enforcement middleware
- Strict origin allowlist + CSRF strategy for cookie auth
- Add required workflow stages and segregation of duties
- Transactional stock movement + production consumption + invoice/receipt lifecycle
- Backups with encrypted off-site copies and restore drills
- SMS/Telegram credentials stored in secrets manager
- Payroll compliance validated by Ethiopian finance/payroll expert
- Deploy behind TLS, configure database least privilege, migrations and monitoring
