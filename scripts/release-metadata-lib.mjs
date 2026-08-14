const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const IMAGE_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/i;

export function validateGitSha(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!GIT_SHA_PATTERN.test(normalized)) {
    throw new Error('git sha must be a full 40-character hexadecimal commit id');
  }
  return normalized;
}

export function validateImageDigest(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!IMAGE_DIGEST_PATTERN.test(normalized)) {
    throw new Error('image digest must use sha256:<64 hexadecimal characters>');
  }
  return normalized;
}

export function createReleaseManifest({ gitSha, createdAt, images }) {
  const timestamp = new Date(createdAt);
  if (Number.isNaN(timestamp.getTime()) || timestamp.toISOString() !== createdAt) {
    throw new Error('createdAt must be an ISO-8601 UTC timestamp');
  }
  return {
    schemaVersion: 1,
    gitSha: validateGitSha(gitSha),
    createdAt,
    images: {
      api: validateImageDigest(images?.api),
      web: validateImageDigest(images?.web),
      worker: validateImageDigest(images?.worker),
    },
  };
}
