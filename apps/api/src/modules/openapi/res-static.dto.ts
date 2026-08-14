import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { ProxyExportFormat } from '../proxies/proxy-export';

export class BusinessListDto {}

export class InventoryQueryDto {
  @ApiPropertyOptional()
  resource_id?: string;
}

export class CalculateDto {
  @ApiProperty()
  resource_id!: string;
  @ApiProperty({ oneOf: [{ type: 'integer' }, { type: 'string' }] })
  duration_days!: number | string;
  @ApiProperty({ oneOf: [{ type: 'integer' }, { type: 'string' }] })
  quantity!: number | string;
  @ApiProperty()
  currency!: string;
}

export class BuyDto {
  @ApiProperty()
  resource_id!: string;
  @ApiProperty({ oneOf: [{ type: 'integer' }, { type: 'string' }] })
  quantity!: number | string;
  @ApiProperty({ oneOf: [{ type: 'integer' }, { type: 'string' }] })
  duration_days!: number | string;
  @ApiProperty()
  currency!: string;
  @ApiProperty()
  idempotency_key!: string;
}

export class RenewDto {
  @ApiProperty()
  proxy_id!: string;
  @ApiProperty({ oneOf: [{ type: 'integer' }, { type: 'string' }] })
  duration_days!: number | string;
  @ApiPropertyOptional()
  idempotency_key?: string;
}

export class OrderResultDto {
  @ApiProperty()
  order_no!: string;
}

export class OrderListDto {
  @ApiPropertyOptional({ oneOf: [{ type: 'integer' }, { type: 'string' }] })
  page?: number | string;
  @ApiPropertyOptional({ oneOf: [{ type: 'integer' }, { type: 'string' }] })
  page_size?: number | string;
  @ApiPropertyOptional()
  status?: string;
}

export class IpListDto {
  @ApiPropertyOptional({ oneOf: [{ type: 'integer' }, { type: 'string' }] })
  page?: number | string;
  @ApiPropertyOptional({ oneOf: [{ type: 'integer' }, { type: 'string' }] })
  page_size?: number | string;
  @ApiPropertyOptional()
  status?: string;
  @ApiPropertyOptional()
  country_code?: string;
  @ApiPropertyOptional()
  search?: string;
  @ApiPropertyOptional()
  from?: string;
  @ApiPropertyOptional()
  to?: string;
}

export class IpExportDto {
  @ApiPropertyOptional()
  format?: ProxyExportFormat;
  @ApiPropertyOptional()
  status?: string;
  @ApiPropertyOptional()
  country_code?: string;
  @ApiPropertyOptional()
  search?: string;
  @ApiPropertyOptional()
  from?: string;
  @ApiPropertyOptional()
  to?: string;
}

export class IpDetailDto {
  @ApiProperty()
  proxy_id!: string;
}

export class ChangeAuthDto {
  @ApiProperty()
  proxy_id!: string;
}

export class SwitchIpListDto {
  @ApiPropertyOptional({ oneOf: [{ type: 'integer' }, { type: 'string' }] })
  page?: number | string;
  @ApiPropertyOptional({ oneOf: [{ type: 'integer' }, { type: 'string' }] })
  page_size?: number | string;
}

export class SwitchIpDto {
  @ApiProperty()
  proxy_id!: string;
}

export class WalletRecordsDto {
  @ApiPropertyOptional({ oneOf: [{ type: 'integer' }, { type: 'string' }] })
  page?: number | string;
  @ApiPropertyOptional({ oneOf: [{ type: 'integer' }, { type: 'string' }] })
  page_size?: number | string;
}
