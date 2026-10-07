import { Global, Module } from '@nestjs/common';
import { RealtimeBus } from './realtime-bus.service';

@Global()
@Module({
  providers: [RealtimeBus],
  exports: [RealtimeBus],
})
export class RealtimeModule {}
