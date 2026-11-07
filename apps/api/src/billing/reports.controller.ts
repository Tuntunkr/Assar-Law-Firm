import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { reportRangeSchema, timeReportQuerySchema } from '@assar/validation';
import type { z } from 'zod';
import type { AppRequest, AuthContext } from '../common/auth-context';
import { Auth, RateLimit, RequirePermissions } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ReportsService } from './reports.service';

@RequirePermissions('billing:read')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('time')
  time(
    @Auth() auth: AuthContext,
    @Query(new ZodPipe(timeReportQuerySchema)) q: z.infer<typeof timeReportQuerySchema>,
  ) {
    return this.reports.time(auth, q);
  }

  @RateLimit({ name: 'report-export', limit: 10, windowSeconds: 60 }) // heavy query returning confidential text
  @Get('time/export')
  async exportTime(
    @Auth() auth: AuthContext,
    @Query(new ZodPipe(timeReportQuerySchema)) q: z.infer<typeof timeReportQuerySchema>,
    @Req() req: AppRequest,
    @Res() res: Response,
  ) {
    const { filename, body } = await this.reports.exportTimeCsv(auth, q, req);
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="${filename}"`);
    res.setHeader('x-content-type-options', 'nosniff');
    res.send(body);
  }

  @Get('billing/summary')
  summary(
    @Auth() auth: AuthContext,
    @Query(new ZodPipe(reportRangeSchema)) q: z.infer<typeof reportRangeSchema>,
  ) {
    return this.reports.summary(auth, q);
  }

  @Get('billing/aging')
  aging(@Auth() auth: AuthContext) {
    return this.reports.aging(auth);
  }
}
