import { Global, Module } from '@nestjs/common';
import { MatterAccessService } from './matter-access.service';
import { MattersController } from './matters.controller';
import { MattersService } from './matters.service';

@Global()
@Module({
  controllers: [MattersController],
  providers: [MattersService, MatterAccessService],
  exports: [MatterAccessService, MattersService],
})
export class MattersModule {}
