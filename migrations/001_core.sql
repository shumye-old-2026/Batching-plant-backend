CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TYPE plant_code AS ENUM ('BOLE','SARIS','GERJI','HEAD_OFFICE');
CREATE TYPE order_status AS ENUM ('DRAFT','PENDING_MARKETING_MANAGER_APPROVAL','MARKETING_REJECTED','PENDING_LAB_APPROVAL','PENDING_FINANCE_CLEARANCE','READY_FOR_PRODUCTION','IN_PRODUCTION','READY_FOR_DISPATCH','DISPATCHED','CANCELLED');
CREATE TABLE app_users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), username text NOT NULL UNIQUE,
 display_name text NOT NULL, password_hash text NOT NULL, role text NOT NULL CHECK(role IN ('SYS_ADMIN','HEAD_OFFICE','SALES_OFFICER','MARKETING_MANAGER','LAB','FINANCE','PRODUCTION','GATE','HR','INVENTORY','FLEET')),
 plant plant_code NOT NULL, active boolean NOT NULL DEFAULT true,
 must_change_password boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE user_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES app_users(id),
 token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON user_sessions(user_id);
CREATE TABLE customers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_code text NOT NULL UNIQUE, name text NOT NULL, phone text, credit_limit numeric(16,2) NOT NULL DEFAULT 0 CHECK(credit_limit>=0), active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE sales_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_no text NOT NULL UNIQUE, plant plant_code NOT NULL CHECK(plant<>'HEAD_OFFICE'), customer_id uuid NOT NULL REFERENCES customers(id),
 created_by uuid NOT NULL REFERENCES app_users(id), status order_status NOT NULL DEFAULT 'DRAFT',
 product_grade text NOT NULL, quantity_m3 numeric(14,3) NOT NULL CHECK(quantity_m3>0), unit_price numeric(16,2) NOT NULL CHECK(unit_price>=0),
 requested_delivery_at timestamptz, notes text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE approval_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES sales_orders(id), stage text NOT NULL,
 decision text NOT NULL CHECK(decision IN ('APPROVED','REJECTED')), actor_id uuid NOT NULL REFERENCES app_users(id),
 note text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX approval_order_idx ON approval_events(order_id,created_at);
CREATE TABLE audit_events (
 id bigserial PRIMARY KEY, actor_id uuid REFERENCES app_users(id), actor_username text,
 action text NOT NULL, entity_type text NOT NULL, entity_id text, plant plant_code,
 request_id text, details jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_time_idx ON audit_events(created_at DESC);
CREATE INDEX audit_actor_idx ON audit_events(actor_id,created_at DESC);
CREATE TABLE inventory_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sku text NOT NULL UNIQUE, name text NOT NULL, base_unit text NOT NULL, active boolean NOT NULL DEFAULT true);
CREATE TABLE inventory_balances (item_id uuid NOT NULL REFERENCES inventory_items(id), plant plant_code NOT NULL CHECK(plant<>'HEAD_OFFICE'), quantity numeric(16,3) NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(item_id,plant));
CREATE TABLE inventory_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid NOT NULL REFERENCES inventory_items(id), plant plant_code NOT NULL CHECK(plant<>'HEAD_OFFICE'), qty_delta numeric(16,3) NOT NULL CHECK(qty_delta<>0), txn_type text NOT NULL, source_ref text, recorded_by uuid NOT NULL REFERENCES app_users(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE invoices (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), invoice_no text NOT NULL UNIQUE, order_id uuid NOT NULL UNIQUE REFERENCES sales_orders(id), customer_id uuid NOT NULL REFERENCES customers(id), plant plant_code NOT NULL, amount numeric(16,2) NOT NULL CHECK(amount>=0), status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','PARTIAL','PAID','VOID')), issued_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE payment_receipts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), invoice_id uuid NOT NULL REFERENCES invoices(id), amount numeric(16,2) NOT NULL CHECK(amount>0), method text NOT NULL CHECK(method IN ('CASH','BANK','MOBILE','OTHER')), reference text, verification_status text NOT NULL DEFAULT 'PENDING' CHECK(verification_status IN ('PENDING','VERIFIED','REJECTED')), received_by uuid NOT NULL REFERENCES app_users(id), verified_by uuid REFERENCES app_users(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX receipt_invoice_idx ON payment_receipts(invoice_id,created_at);
