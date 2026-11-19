-- Ziki's own code checks (the quick scan) save their findings under parts of this kind (18 Nov).
-- On its own: Postgres can't use a new enum value in the migration that adds it.
ALTER TYPE "SecurityCheckItemKind" ADD VALUE 'automatic';
