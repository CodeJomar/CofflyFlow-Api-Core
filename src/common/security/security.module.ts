import { Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { PermissionsService } from './permissions.service';
import { PermissionCatalogService } from './permission-catalog.service';

@Global()
@Module({
  imports: [DiscoveryModule],
  providers: [PermissionsService, PermissionCatalogService],
  exports: [PermissionsService, PermissionCatalogService],
})
export class SecurityModule {}
