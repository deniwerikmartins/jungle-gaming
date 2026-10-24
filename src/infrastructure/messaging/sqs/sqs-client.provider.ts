import { SQSClient } from '@aws-sdk/client-sqs';

/**
 * Creates a singleton SQSClient configured for LocalStack or real AWS.
 * All workers/consumers share this instance.
 */
export function createSqsClient(): SQSClient {
  return new SQSClient({
    region: process.env['AWS_REGION'] ?? 'us-east-1',
    endpoint: process.env['AWS_ENDPOINT_URL'],
    credentials: {
      accessKeyId: process.env['AWS_ACCESS_KEY_ID'] ?? 'test',
      secretAccessKey: process.env['AWS_SECRET_ACCESS_KEY'] ?? 'test',
    },
  });
}

export const sqsClient = createSqsClient();
