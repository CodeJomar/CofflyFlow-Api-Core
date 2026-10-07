import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { KdsModule } from '../kds/kds.module';
import { MenuModule } from '../menu/menu.module';

@Module({
  imports: [KdsModule, MenuModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
