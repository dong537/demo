export interface UserProfileDto {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  status: string;
  kycStatus: string;
  riskStatus: string;
}

export interface UpdateUserProfileDto {
  name?: string | null;
  phone?: string | null;
}

export interface CreateUserDto {
  email?: string;
  password?: string;
  tenantId?: string;
}

export interface CreatedUserDto {
  id: string;
  email: string;
  tenantId: string;
  status: string;
  kycStatus: string;
  createdAt: Date;
}
