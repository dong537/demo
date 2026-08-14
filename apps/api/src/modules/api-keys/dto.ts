export interface CreateApiKeyDto {
  name: string;
  scopes: string[];
  ipWhitelist?: string[];
  tenantId: string;
}

export interface ApiKeyResponseDto {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  ipWhitelist: string[];
  status: string;
  createdAt: Date;
  plainKey?: string;
}

export interface RevokeApiKeyDto {
  id: string;
}

export interface ApiKeyListItemDto {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  ipWhitelist: string[];
  status: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}
