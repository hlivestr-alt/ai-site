// The cleanup command revalidates status, age and references under row locks.
export function stagingCleanupKeys(row) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (![row.id, row.workspace_id].every(v => uuid.test(v)) || !['PENDING_UPLOAD', 'FAILED'].includes(row.status) || row.finalized_at || row.verified_at) throw new Error('Cleanup scope rejected');
  let expectedUpload, expectedOriginal;
  if (row.kind === 'asset' && [row.product_id, row.asset_id].every(v => uuid.test(v)) && row.current_version_id !== row.id) {
    const base = `workspaces/${row.workspace_id}/products/${row.product_id}/assets/${row.asset_id}/versions/${row.id}`;
    expectedUpload = `pending/${base}/upload`; expectedOriginal = `${base}/original`;
  } else if (row.kind === 'source') {
    const base = `workspaces/${row.workspace_id}/sources/${row.id}`;
    expectedUpload = `pending/${base}/upload`; expectedOriginal = `${base}/original`;
  } else throw new Error('Cleanup scope rejected');
  if (row.upload_key !== expectedUpload || row.storage_key !== expectedOriginal) throw new Error('Cleanup key scope rejected');
  return [expectedUpload, expectedOriginal];
}
