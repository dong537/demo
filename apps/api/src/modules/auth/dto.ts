export interface LoginDto {
  email: string;
  password: string;
  siteId: string;
}

export interface LoginResponseDto {
  token: string;
  expiresAt: Date;
}

export interface RegisterDto {
  email: string;
  password: string;
  siteId: string;
  tenantId?: string;
}

export interface RegisterResponseDto {
  token: string;
  expiresAt: Date;
}

export interface CurrentUserDto {
  ownerId: string;
  ownerType: string;
  siteId: string;
  tenantId: string | null;
  scopes: string[];
}

export interface LogoutDto {
  sessionId: string;
}

export interface ChangePasswordDto {
  oldPassword: string;
  newPassword: string;
}
