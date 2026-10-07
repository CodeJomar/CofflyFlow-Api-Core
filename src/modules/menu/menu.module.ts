import { Module } from '@nestjs/common';
import { MenuService } from './menu.service';
import { MenuController } from './menu.controller';
import { ModifiersService } from './modifiers.service';
import { ModifiersController } from './modifiers.controller';

@Module({
  controllers: [MenuController, ModifiersController],
  providers: [MenuService, ModifiersService],
  exports: [MenuService, ModifiersService],
})
export class MenuModule {}
