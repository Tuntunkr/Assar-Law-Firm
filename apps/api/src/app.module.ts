import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { DestinationStream } from 'pino';
import { PrincipalRateLimitGuard, RATE_LIMIT_STORAGE } from './security/rate-limit.guard';
import { RedisThrottlerStorage } from './security/redis-throttler.storage';
import { AiModule } from './ai/ai.module';
import { AutomationModule } from './automation/automation.module';
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
import { BillingModule } from './billing/billing.module';
import { CalendarModule } from './calendar/calendar.module';
import { ClientsModule } from './clients/clients.module';
import { ConflictsModule } from './conflicts/conflicts.module';
import { DocumentsModule } from './documents/documents.module';
import { MattersModule } from './matters/matters.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { PortalAdminModule } from './portal-admin/portal-admin.module';
import { PortalModule } from './portal/portal.module';
import { QueueModule } from './queue/queue.module';
import { StorageModule } from './storage/storage.module';
import { SystemModule } from './system/system.module';
import { TasksModule } from './tasks/tasks.module';
import { TeamsModule } from './teams/teams.module';
import { PracticeModule } from './practice/practice.module';
import { TemplatesModule } from './templates/templates.module';
import { TimelineModule } from './timeline/timeline.module';

@Module({})
export class AppModule {
  static forRoot(env: Env, options: { logDestination?: DestinationStream } = {}): DynamicModule {
    const logger = createLogger(env.LOG_LEVEL, options.logDestination);
    // Counters live in Redis so limits hold across all API replicas.
    const storage = new RedisThrottlerStorage(env.REDIS_URL, env.QUEUE_PREFIX, logger);
    rateLimits.auth = env.AUTH_RATE_LIMIT_PER_MIN;
    rateLimits.global = env.GLOBAL_RATE_LIMIT_PER_MIN;
    return {
      module: AppModule,
      global: true,
      imports: [
        ThrottlerModule.forRoot({
          throttlers: [{ ttl: 60_000, limit: () => rateLimits.global }],
          storage,
        }),
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
        PortalModule,
        PortalAdminModule,
        AutomationModule,
        BillingModule,
        TimelineModule,
        TemplatesModule,
        PracticeModule,
      ],
      controllers: [HealthController],
      providers: [
        { provide: ENV, useValue: env },
        { provide: LOGGER, useValue: logger },
        { provide: RATE_LIMIT_STORAGE, useValue: storage },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: PrincipalRateLimitGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
        { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
      ],
      exports: [ENV, LOGGER],
    };
  }
}
