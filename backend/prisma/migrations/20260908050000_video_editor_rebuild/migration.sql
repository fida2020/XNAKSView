-- Video editor rebuild: creator-controlled comment eligibility (matches
-- allowDuet/allowStitch/allowDownload), and the persisted, validated edit
-- spec used to reproduce a video's real trim/speed/filter/text/cover/added-
-- audio render on a retried processing attempt.
ALTER TABLE "videos" ADD COLUMN "allowComments" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "videos" ADD COLUMN "editSpec" JSONB;
