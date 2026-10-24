import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { ScheduleModule } from '@nestjs/schedule';
import mikroOrmConfig from './infrastructure/database/mikro-orm.config.js';
import { WalletController } from './infrastructure/http/controllers/wallet.controller.js';
import { WageringController } from './infrastructure/http/controllers/wagering.controller.js';
import { HealthController } from './infrastructure/http/controllers/health.controller.js';
import { DomainExceptionFilter } from './infrastructure/http/filters/domain-exception.filter.js';

@Module({
  imports: [
    MikroOrmModule.forRoot(mikroOrmConfig),
    ScheduleModule.forRoot(),
  ],
  controllers: [
    WalletController,
    WageringController,
    HealthController,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: DomainExceptionFilter,
    },
  ],
})
export class AppModule {}
