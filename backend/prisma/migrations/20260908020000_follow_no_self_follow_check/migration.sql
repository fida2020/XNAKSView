-- Defense-in-depth for the application-level self-follow guard already
-- enforced in routes/v1/follow.ts (`targetId === req.user!.id` rejected
-- with BAD_REQUEST before any write happens). A CHECK constraint isn't
-- expressible in schema.prisma's declarative model syntax, so this is
-- applied directly. No existing row violates this (verified before adding).
ALTER TABLE "follows" ADD CONSTRAINT "follows_no_self_follow" CHECK ("followerId" <> "followingId");
