import { ApiProperty } from '@nestjs/swagger';

export class DedicatedLineLifecycleResultDto {
  @ApiProperty()
  lineId!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  desiredVersion!: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  expiresAt!: Date | null;

  @ApiProperty()
  replayed!: boolean;
}

export class UpdateDedicatedLineLimitsDto {
  @ApiProperty({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER, description: 'Total traffic quota in bytes; 0 means unlimited.' })
  trafficLimitBytes!: number;

  @ApiProperty({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER, description: 'Uplink bytes per second; 0 means unlimited.' })
  uplinkLimitBps!: number;

  @ApiProperty({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER, description: 'Downlink bytes per second; 0 means unlimited.' })
  downlinkLimitBps!: number;

  @ApiProperty({ minimum: 0, maximum: 2_147_483_647, description: 'Concurrent connection limit; 0 means unlimited.' })
  maxConnections!: number;

  @ApiProperty({ minimum: 0, maximum: 2_147_483_647, description: 'Distinct client IP limit; 0 means unlimited.' })
  ipLimit!: number;

  @ApiProperty({ maxLength: 500 })
  reason!: string;
}

class DedicatedLineLimitUpdateValuesDto {
  @ApiProperty()
  trafficLimitBytes!: number;

  @ApiProperty()
  uplinkLimitBps!: number;

  @ApiProperty()
  downlinkLimitBps!: number;

  @ApiProperty()
  maxConnections!: number;

  @ApiProperty()
  ipLimit!: number;
}

export class DedicatedLineLimitsResultDto {
  @ApiProperty()
  lineId!: string;

  @ApiProperty()
  desiredVersion!: number;

  @ApiProperty({ type: DedicatedLineLimitUpdateValuesDto })
  limits!: DedicatedLineLimitUpdateValuesDto;

  @ApiProperty()
  replayed!: boolean;
}

class DedicatedLineLimitValuesDto {
  @ApiProperty({ type: String, description: 'Total traffic quota in bytes; 0 means unlimited.' })
  trafficLimitBytes!: string;

  @ApiProperty({ type: String, description: 'Uplink bytes per second; 0 means unlimited.' })
  uplinkLimitBps!: string;

  @ApiProperty({ type: String, description: 'Downlink bytes per second; 0 means unlimited.' })
  downlinkLimitBps!: string;

  @ApiProperty()
  maxConnections!: number;

  @ApiProperty()
  ipLimit!: number;
}

class DedicatedLineLimitCustomerDto {
  @ApiProperty()
  email!: string;

  @ApiProperty({ nullable: true })
  name!: string | null;
}

class DedicatedLineLimitSkuDto {
  @ApiProperty()
  code!: string;

  @ApiProperty()
  name!: string;
}

class DedicatedLineProjectionReadinessDto {
  @ApiProperty()
  ready!: number;

  @ApiProperty()
  total!: number;
}

export class DedicatedLineLimitSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  tenantId!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  countryCode!: string;

  @ApiProperty()
  protocol!: string;

  @ApiProperty()
  desiredVersion!: number;

  @ApiProperty({ type: DedicatedLineLimitCustomerDto })
  customer!: DedicatedLineLimitCustomerDto;

  @ApiProperty({ type: DedicatedLineLimitSkuDto })
  sku!: DedicatedLineLimitSkuDto;

  @ApiProperty()
  inboundTag!: string;

  @ApiProperty({ type: DedicatedLineLimitValuesDto })
  limits!: DedicatedLineLimitValuesDto;

  @ApiProperty({ type: DedicatedLineProjectionReadinessDto })
  projections!: DedicatedLineProjectionReadinessDto;
}

export class DedicatedLineLimitPageDto {
  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  total!: number;

  @ApiProperty({ type: [DedicatedLineLimitSummaryDto] })
  items!: DedicatedLineLimitSummaryDto[];
}
