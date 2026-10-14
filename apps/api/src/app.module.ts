import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AiModule } from './ai/ai.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AuthGuard, PermissionsGuard } from './auth/guards';
import { IdempotencyInterceptor } from './common/idempotency.interceptor';
import { AllExceptionsFilter } from './common/exception.filter';
import { LOGGER, createLogger } from './common/logger';
import { rateLimits } from './common/rate-limits';
import { ENV, type Env } from './config/env';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { CalendarModule } from './calendar/calendar.module';
import { ClientsModule } from './clients/clients.module';
import { ConflictsModule } from './conflicts/conflicts.module';
import { DocumentsModule } from './documents/documents.module';
import { MattersModule } from './matters/matters.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { QueueModule } from './queue/queue.module';
import { StorageModule } from './storage/storage.module';
import { SystemModule } from './system/system.module';
import { TasksModule } from './tasks/tasks.module';
import { TeamsModule } from './teams/teams.module';

@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    rateLimits.auth = env.AUTH_RATE_LIMIT_PER_MIN;
    rateLimits.global = env.GLOBAL_RATE_LIMIT_PER_MIN;
    return {
      module: AppModule,
      global: true,
      imports: [
        // In-memory counters: per-instance. Move to Redis storage before running multiple API replicas.
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: () => rateLimits.global }]),
        DatabaseModule,
        AuditModule,
        AuthModule,
        OrganizationsModule,
        ClientsModule,
        MattersModule,
        TeamsModule,
        ConflictsModule,
        StorageModule,
        QueueModule,
        DocumentsModule,
        CalendarModule,
        TasksModule,
        AiModule,
        SystemModule,
      ],
      controllers: [HealthController],
      providers: [
        { provide: ENV, useValue: env },
        { provide: LOGGER, useValue: createLogger(env.LOG_LEVEL) },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
        { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
      ],
      exports: [ENV, LOGGER],
    };
  }
}
