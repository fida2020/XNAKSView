import { z } from 'zod';

export const searchHashtagsQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
  type: z.enum(['users', 'videos', 'hashtags']).default('videos'),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const createPlaylistSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
});

export const updatePlaylistSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(500).optional(),
});

export const addPlaylistVideoSchema = z.object({
  videoId: z.string().uuid(),
});

export const reorderPlaylistSchema = z.object({
  videoIds: z.array(z.string().uuid()).min(1),
});
