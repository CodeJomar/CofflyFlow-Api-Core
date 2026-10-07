import { Module } from '@nestjs/common';
import { KdsGateway } from './kds.gateway';
import { KdsService } from './kds.service';
import { KdsController } from './kds.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [KdsController],
  providers: [KdsGateway, KdsService],
  exports: [KdsService],
})
export class KdsModule {}
