import type { Prisma, PrismaClient } from '@prisma/client';

type Tx = PrismaClient | Prisma.TransactionClient;

/**
 * Lazily gets-or-creates the `Sound` row for a video's own audio — every
 * video's audio is implicitly "usable" (brief C), but a `Sound` row only
 * actually exists once something needs to reference it (posting a new video
 * with `soundId` pointing at it, or browsing its sound page). Attribution
 * always traces back to `sourceVideoId`, never to whoever most recently
 * used it (see the model's own comment in schema.prisma).
 */
export async function getOrCreateSoundForVideo(tx: Tx, videoId: string): Promise<{ id: string }> {
  const existing = await tx.sound.findUnique({ where: { sourceVideoId: videoId } });
  if (existing) return existing;
  return tx.sound.create({ data: { sourceVideoId: videoId } });
}
