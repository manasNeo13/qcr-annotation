import { BlobSASPermissions, generateBlobSASQueryParameters, StorageSharedKeyCredential } from '@azure/storage-blob';
import { env } from '../config/env.js';
import { safeDecode } from '../lib/safeDecode.js';

const configured = Boolean(env.AZURE_STORAGE_ACCOUNT && env.AZURE_STORAGE_KEY);
const cred = configured ? new StorageSharedKeyCredential(env.AZURE_STORAGE_ACCOUNT, env.AZURE_STORAGE_KEY) : null;
const host = `https://${env.AZURE_STORAGE_ACCOUNT}.blob.core.windows.net`;

/** Split a blob ref (full URL or "name" in default container) into container + blob name. */
function resolve(ref) {
  if (/^https?:\/\//i.test(ref)) {
    const u = new URL(ref);
    if (u.host !== `${env.AZURE_STORAGE_ACCOUNT}.blob.core.windows.net`) return {}; // E2E/S3 etc. — not handled
    const [container, ...rest] = u.pathname.replace(/^\//, '').split('/');
    return { container, blobName: safeDecode(rest.join('/')) };
  }
  return { container: env.AZURE_STORAGE_CONTAINER, blobName: ref.replace(/^\//, '') };
}

/** Read-only, short-lived SAS URL. Returns ref unchanged when Azure not configured. */
export function signBlobUrl(ref) {
  if (!ref) return '';
  if (!cred || ref.startsWith('data:')) return ref;
  const { container, blobName } = resolve(ref.split('?')[0]);
  if (!container || !blobName) return '';
  const now = Date.now();
  const sas = generateBlobSASQueryParameters(
    {
      containerName: container,
      blobName,
      permissions: BlobSASPermissions.parse('r'),
      startsOn: new Date(now - 5 * 60_000), // clock skew
      expiresOn: new Date(now + env.SAS_TTL_MINUTES * 60_000),
      protocol: 'https',
    },
    cred,
  ).toString();
  const path = blobName.split('/').map(encodeURIComponent).join('/');
  return `${host}/${container}/${path}?${sas}`;
}

export const sasConfigured = configured;
