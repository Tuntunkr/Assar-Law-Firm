import { Global, Inject, Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { connectDatabase, disconnectDatabase, syncIndexes } from '@assar/database';
import { ENV, type Env } from '../config/env';

@Global()
@Module({})
export class DatabaseModule implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(ENV) private readonly env: Env) {}

  async onModuleInit() {
    await connectDatabase(this.env.MONGODB_URI);
    // Production indexes are managed by migrations, not on boot.
    if (this.env.NODE_ENV !== 'production') await syncIndexes();
  }

  async onModuleDestroy() {
    await disconnectDatabase();
  }
}
