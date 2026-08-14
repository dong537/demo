import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateDedicatedLineOrderDto {
  @ApiProperty({ description: 'Catalog SKU code, for example SV or ZB' })
  skuCode!: string;

  @ApiProperty()
  countryCode!: string;

  @ApiProperty()
  quantity!: number;

  @ApiProperty()
  durationDays!: number;

  @ApiProperty()
  currency!: string;

  @ApiProperty()
  idempotencyKey!: string;

  @ApiPropertyOptional()
  regionCode?: string;

  @ApiPropertyOptional({ description: 'Provider business code, only when the configured SKU contract requires it' })
  businessType?: string;
}
