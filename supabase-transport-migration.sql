-- ============================================
-- XIT FACTION: Transport Routes + Ship Status
-- ============================================

-- 1. 运输路线表
CREATE TABLE transport_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  faction_id TEXT NOT NULL REFERENCES factions(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  departure TEXT NOT NULL,
  destination TEXT NOT NULL,
  round_trip BOOLEAN NOT NULL DEFAULT FALSE,
  fee_per_ton NUMERIC NOT NULL DEFAULT 0,
  fee_per_m3 NUMERIC NOT NULL DEFAULT 0,
  ship_registration TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS
ALTER TABLE transport_routes ENABLE ROW LEVEL SECURITY;

-- 同组织成员可读
CREATE POLICY "transport_routes_select"
  ON transport_routes FOR SELECT
  USING (
    faction_id IN (
      SELECT faction_id FROM members WHERE auth_uid = auth.uid()
    )
  );

-- 本人可插入（faction_id 必须匹配）
CREATE POLICY "transport_routes_insert"
  ON transport_routes FOR INSERT
  WITH CHECK (
    faction_id IN (
      SELECT faction_id FROM members WHERE auth_uid = auth.uid()
    )
    AND company_name IN (
      SELECT company_name FROM members WHERE auth_uid = auth.uid()
    )
  );

-- 本人可更新自己的路线
CREATE POLICY "transport_routes_update"
  ON transport_routes FOR UPDATE
  USING (
    company_name IN (
      SELECT company_name FROM members WHERE auth_uid = auth.uid()
    )
  );

-- 本人可删自己的；executive 可删同组织任何人的
CREATE POLICY "transport_routes_delete"
  ON transport_routes FOR DELETE
  USING (
    company_name IN (
      SELECT company_name FROM members WHERE auth_uid = auth.uid()
    )
    OR faction_id IN (
      SELECT faction_id FROM members
      WHERE auth_uid = auth.uid() AND role = 'executive'
    )
  );

-- 2. 飞船状态上报表
CREATE TABLE ship_status_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  faction_id TEXT NOT NULL REFERENCES factions(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  ship_registration TEXT NOT NULL,
  ship_name TEXT,
  condition NUMERIC,
  location TEXT,
  is_flying BOOLEAN NOT NULL DEFAULT FALSE,
  flight_destination TEXT,
  flight_eta TIMESTAMPTZ,
  cargo_volume NUMERIC,
  cargo_weight NUMERIC,
  reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(faction_id, company_name, ship_registration)
);

-- RLS
ALTER TABLE ship_status_reports ENABLE ROW LEVEL SECURITY;

-- 同组织成员可读
CREATE POLICY "ship_status_select"
  ON ship_status_reports FOR SELECT
  USING (
    faction_id IN (
      SELECT faction_id FROM members WHERE auth_uid = auth.uid()
    )
  );

-- 本人可 upsert 自己的飞船状态
CREATE POLICY "ship_status_insert"
  ON ship_status_reports FOR INSERT
  WITH CHECK (
    faction_id IN (
      SELECT faction_id FROM members WHERE auth_uid = auth.uid()
    )
    AND company_name IN (
      SELECT company_name FROM members WHERE auth_uid = auth.uid()
    )
  );

CREATE POLICY "ship_status_update"
  ON ship_status_reports FOR UPDATE
  USING (
    company_name IN (
      SELECT company_name FROM members WHERE auth_uid = auth.uid()
    )
  );
