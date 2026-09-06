import { open } from 'fs/promises';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

/**
 * Real validation, not a mimetype/extension check: reads the file's actual
 * magic bytes to confirm it's a PNG or JPEG. Mirrors the "don't trust the
 * client's claimed type" approach `probeVideo` takes for video uploads,
 * scaled to what a thumbnail image actually needs.
 */
export async function probeImage(filePath: string): Promise<{ mimeType: 'image/png' | 'image/jpeg' }> {
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(8);
    await handle.read(buffer, 0, 8, 0);

    if (buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
      return { mimeType: 'image/png' };
    }
    if (buffer.subarray(0, 3).equals(JPEG_SIGNATURE)) {
      return { mimeType: 'image/jpeg' };
    }
    throw new Error('File is not a recognized PNG or JPEG image');
  } finally {
    await handle.close();
  }
}
