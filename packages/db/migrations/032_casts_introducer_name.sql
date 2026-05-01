-- 紹介者名を非正規化保存（小規模なので denormalize）
-- 紹介者IDだけだと管理画面で誰だか分からないため。
ALTER TABLE casts ADD COLUMN introducer_name TEXT;
