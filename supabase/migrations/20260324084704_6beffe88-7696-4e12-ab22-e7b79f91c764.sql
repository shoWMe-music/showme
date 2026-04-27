
ALTER TABLE team_members ADD COLUMN phone text NOT NULL DEFAULT '';
ALTER TABLE team_members ADD COLUMN custom_fields jsonb NOT NULL DEFAULT '[]'::jsonb;
-- We can't simply rename since existing data has a single string value. 
-- Add new jsonb column for roles array, migrate data, then drop old column.
ALTER TABLE team_members ADD COLUMN roles_array jsonb NOT NULL DEFAULT '["Member"]'::jsonb;
UPDATE team_members SET roles_array = jsonb_build_array(role);
ALTER TABLE team_members DROP COLUMN role;
ALTER TABLE team_members RENAME COLUMN roles_array TO role;
