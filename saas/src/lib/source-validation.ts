import { AppError, isUuid } from './core';
import type { DbClient } from './db';
import type { SourceRow } from './sources';
import { objectStorage } from './storage';
import { MEDIA_VALIDATION_VERSION, probeVideo } from './media-probe';

// Shared by HTTP and the workflow dispatcher. The server-only source API is
// deliberately a type-only dependency so CLI admission uses the same boundary.
export async function ensureSourceMediaValidation(db: DbClient, workspaceId: string, id: string) {
  if (!isUuid(id)) throw new AppError(404, 'Source not found.');
  const result = await db.query<SourceRow>('SELECT * FROM source_assets WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [workspaceId, id]);
  const source = result.rows[0];
  if (!source) throw new AppError(404, 'Source not found.');
  if (!['UPLOADED', 'VERIFIED'].includes(source.status)) throw new AppError(409, 'Finalize a valid source before clipping.');
  const storage = objectStorage(), head = await storage.head(source.storage_key);
  if (!head || head.byteSize !== Number(source.byte_size) || head.contentType !== source.mime_type) throw new AppError(422, 'Source media is unavailable or invalid.');
  if (source.media_validation_version === MEDIA_VALIDATION_VERSION && source.media_validated_etag === head.etag) return source;
  await probeVideo(storage, source.storage_key, head, true);
  await db.query('UPDATE source_assets SET media_validation_version=$1,media_validated_at=now(),media_validated_etag=$2 WHERE workspace_id=$3 AND id=$4', [MEDIA_VALIDATION_VERSION, head.etag, workspaceId, id]);
  return source;
}
