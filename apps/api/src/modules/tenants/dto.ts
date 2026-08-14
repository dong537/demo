import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTenantDto {
  @ApiProperty()
  code!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  adminEmail!: string;

  @ApiProperty({ minLength: 8 })
  adminPassword!: string;
}

export class CreateSelfServiceTenantDto {
  @ApiProperty()
  code!: string;

  @ApiProperty()
  name!: string;
}

export class UpdateTenantStatusDto {
  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED'] })
  status!: 'ACTIVE' | 'SUSPENDED';
}

export class TenantListItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  siteId!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED', 'CLOSED'] })
  status!: string;

  @ApiProperty()
  customerCount!: number;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class TenantPageDto {
  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  total!: number;

  @ApiProperty({ type: [TenantListItemDto] })
  items!: TenantListItemDto[];
}

export class SelfServiceTenantResponseDto {
  @ApiProperty({ type: TenantListItemDto })
  tenant!: TenantListItemDto;
}

export class TenantStatsDto {
  @ApiProperty()
  customerCount!: number;

  @ApiProperty()
  orderCount!: number;

  @ApiProperty()
  monthlyOrders!: number;

  @ApiProperty()
  totalBalance!: string;

  @ApiProperty({ additionalProperties: { type: 'string' } })
  balanceByCurrency!: Record<string, string>;
}

export class TenantDetailDto extends TenantListItemDto {
  @ApiProperty()
  orderCount!: number;

  @ApiProperty()
  monthlyOrders!: number;

  @ApiProperty()
  totalBalance!: string;

  @ApiProperty({ additionalProperties: { type: 'string' } })
  balanceByCurrency!: Record<string, string>;

  @ApiPropertyOptional({ type: TenantStatsDto })
  stats?: TenantStatsDto;
}

export class TenantBrandDto {
  @ApiProperty()
  tenantId!: string;

  @ApiProperty()
  siteName!: string;

  @ApiPropertyOptional()
  logoUrl?: string;

  @ApiPropertyOptional()
  primaryColor?: string;

  @ApiPropertyOptional()
  customDomain?: string;

  @ApiPropertyOptional()
  supportEmail?: string;
}

export class UpdateTenantBrandConfigDto {
  @ApiProperty({ minLength: 1, maxLength: 80 })
  siteName!: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2048 })
  logoUrl?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, pattern: '^#[0-9A-Fa-f]{6}$' })
  primaryColor?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 253 })
  customDomain?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 254 })
  supportEmail?: string | null;
}

export class TenantProviderAccountDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  siteId!: string;

  @ApiProperty()
  tenantId!: string;

  @ApiProperty({ enum: ['IPIPD', 'NINE_EIGHT_FIVE', 'PR'] })
  providerCode!: string;

  @ApiProperty({ enum: ['ACTIVE', 'DISABLED'] })
  status!: string;

  @ApiProperty()
  baseUrl!: string;

  @ApiProperty()
  timeoutMs!: number;

  @ApiProperty()
  inventorySyncEnabled!: boolean;

  @ApiProperty({ type: [String] })
  enabledCountryCodes!: string[];

  @ApiProperty({ type: [Object] })
  availableCountries!: Array<{ code: string; name: string }>;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class CreateTenantProviderAccountDto {
  @ApiProperty({ enum: ['IPIPD', 'NINE_EIGHT_FIVE', 'PR'] })
  providerCode!: string;

  @ApiProperty({ additionalProperties: { type: 'string' } })
  credential!: Record<string, string>;

  @ApiProperty()
  baseUrl!: string;

  @ApiPropertyOptional()
  timeoutMs?: number;

  @ApiPropertyOptional()
  inventorySyncEnabled?: boolean;

  @ApiPropertyOptional({ type: [String] })
  enabledCountryCodes?: string[];
}

export class UpdateTenantProviderAccountDto {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'DISABLED'] })
  status?: string;

  @ApiPropertyOptional({ additionalProperties: { type: 'string' } })
  credential?: Record<string, string>;

  @ApiPropertyOptional()
  baseUrl?: string;

  @ApiPropertyOptional()
  timeoutMs?: number;

  @ApiPropertyOptional()
  inventorySyncEnabled?: boolean;

  @ApiPropertyOptional({ type: [String] })
  enabledCountryCodes?: string[];
}
