import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateStaticProxyOrderDto {
  @ApiProperty()
  resourceId!: string;

  @ApiProperty()
  quantity!: number;

  @ApiProperty()
  durationDays!: number;

  @ApiProperty()
  currency!: string;

  @ApiProperty()
  idempotencyKey!: string;

  @ApiPropertyOptional()
  businessType?: string;
}

export class AdminCreateStaticProxyOrderDto extends CreateStaticProxyOrderDto {
  @ApiProperty({ description: 'Operator reason recorded in audit logs' })
  reason!: string;
}

export class AdminOrderOperationDto {
  @ApiPropertyOptional({ description: 'Operator reason recorded in audit logs' })
  reason?: string;
}

export class RequiredAdminOrderOperationDto {
  @ApiProperty({ description: 'Operator reason recorded in audit logs' })
  reason!: string;
}

export class AdminOrderOperationWalletDto {
  @ApiProperty()
  available!: string;

  @ApiProperty()
  currency!: string;
}

export class AdminOrderOperationResultDto {
  @ApiProperty()
  orderId!: string;

  @ApiProperty()
  status!: string;

  @ApiPropertyOptional()
  fulfillmentJobId?: string;

  @ApiPropertyOptional({ type: AdminOrderOperationWalletDto })
  wallet?: AdminOrderOperationWalletDto;
}
