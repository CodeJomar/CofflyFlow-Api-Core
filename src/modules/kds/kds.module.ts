import { Module } from '@nestjs/common';
import { KdsGateway } from './kds.gateway';
import { KdsService } from './kds.service';

@Module({
  providers: [KdsGateway, KdsService],
  exports: [KdsGateway, KdsService],
})
export class KdsModule {}