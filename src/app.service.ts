import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Coffly Flow API Core - Operativa y en línea';
  }
}