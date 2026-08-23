-- Point 7: every stress user must be a member of the k6 test group.
-- Idempotent. Run against UAT (TablePlus / psql) BEFORE a load run.
-- Missing USER_GROUP rows look like chat/reply failures (no echo, unauthorized).
--
-- Target group = data/group-chat.json groupId
--   0a14c4b7-2a03-419d-a32a-60df68e7d5dc
--
-- Bulk CSV data/csv-users/bulk-upload-users-30000-stress.csv used Groups code
--   8767119282
-- Confirm that code is THIS group. If it is a different group, users will
-- still be missing here — this script adds them to the k6 groupId.

-- 0) Confirm the group (UUID and/or bulk-upload code)
SELECT id, code, name
FROM org_group
WHERE id = '0a14c4b7-2a03-419d-a32a-60df68e7d5dc'
   OR code = '8767119282';

-- 1) How many stress users exist vs how many are already in the test group
SELECT
    (SELECT COUNT(*) FROM gulfnet_tmt_user
      WHERE status = '1' AND user_name ILIKE 'stresstest%') AS stress_users,
    (SELECT COUNT(*) FROM user_group ug
      JOIN gulfnet_tmt_user u ON u.id = ug.user_id
     WHERE ug.group_id = '0a14c4b7-2a03-419d-a32a-60df68e7d5dc'
       AND u.user_name ILIKE 'stresstest%') AS stress_users_in_test_group;

-- 2) Sample of stress users missing from the test group
SELECT u.id, u.user_name, u.first_name, u.last_name
FROM gulfnet_tmt_user u
WHERE u.status = '1'
  AND u.user_name ILIKE 'stresstest%'
  AND NOT EXISTS (
        SELECT 1
        FROM user_group ug
        WHERE ug.user_id = u.id
          AND ug.group_id = '0a14c4b7-2a03-419d-a32a-60df68e7d5dc'
  )
ORDER BY u.user_name
LIMIT 50;

-- 3) Add missing members (safe to re-run)
INSERT INTO user_group (id, date_created, created_by, date_updated, updated_by, group_id, user_id)
SELECT gen_random_uuid(),
       NOW(),
       'stress-prep',
       NOW(),
       'stress-prep',
       '0a14c4b7-2a03-419d-a32a-60df68e7d5dc',
       u.id
FROM gulfnet_tmt_user u
WHERE u.status = '1'
  AND u.user_name ILIKE 'stresstest%'
  AND NOT EXISTS (
        SELECT 1
        FROM user_group ug
        WHERE ug.user_id = u.id
          AND ug.group_id = '0a14c4b7-2a03-419d-a32a-60df68e7d5dc'
  );

-- If gen_random_uuid() is missing, use uuid_generate_v4() instead (uuid-ossp).

-- 4) Re-count after insert
SELECT
    (SELECT COUNT(*) FROM gulfnet_tmt_user
      WHERE status = '1' AND user_name ILIKE 'stresstest%') AS stress_users,
    (SELECT COUNT(*) FROM user_group ug
      JOIN gulfnet_tmt_user u ON u.id = ug.user_id
     WHERE ug.group_id = '0a14c4b7-2a03-419d-a32a-60df68e7d5dc'
       AND u.user_name ILIKE 'stresstest%') AS stress_users_in_test_group;
