export interface FeedCursor {
  createdAt: string;
  id: string;
}

export function encodeCursor(cursor: FeedCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeCursor(raw: string): FeedCursor | null {
  try {
    const decoded = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<FeedCursor>;
    if (typeof decoded.createdAt === 'string' && typeof decoded.id === 'string') {
      return { createdAt: decoded.createdAt, id: decoded.id };
    }
    return null;
  } catch {
    return null;
  }
}
