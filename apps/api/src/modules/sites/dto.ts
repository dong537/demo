import { ApiProperty } from '@nestjs/swagger';

export class UpdateSiteDomainDto {
  @ApiProperty({ example: '365proxy.example.com' })
  domain!: string;
}
