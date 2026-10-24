import { Module, OnApplicationBootstrap } from '@nestjs/common';
import { SqsConsumerService } from './sqs/sqs-consumer.service.js';
import { OutboxWorkerService } from './outbox/outbox-worker.service.js';
import { PendingReferenceWorkerService } from './inbox/pending-reference-worker.service.js';

@Module({
  providers: [
    SqsConsumerService,
    OutboxWorkerService,
    PendingReferenceWorkerService,
  ],
  exports: [SqsConsumerService],
})
export class MessagingModule implements OnApplicationBootstrap {
  constructor(private readonly sqsConsumer: SqsConsumerService) {}

  onApplicationBootstrap(): void {
    // Start SQS long-polling after all modules are initialized
    this.sqsConsumer.startPolling();
  }
}
