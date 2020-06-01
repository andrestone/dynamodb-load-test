import * as cdk from '@aws-cdk/core';
import * as sqs from '@aws-cdk/aws-sqs';
import * as ddb from '@aws-cdk/aws-dynamodb';
import * as lambda from '@aws-cdk/aws-lambda';
import * as les from '@aws-cdk/aws-lambda-event-sources';


export class LazyShardingStack extends cdk.Stack {
  public readonly table: ddb.ITable;
  public readonly dsQueueUrl: string;

  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Table
    this.table = new ddb.Table(this, 'LazilyShardedPartitionsTable', {
      partitionKey: {name: 'PK', type: ddb.AttributeType.STRING},
      sortKey: {name: 'SK', type: ddb.AttributeType.STRING},
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // De-sharding Queue
    const dsQueue = new sqs.Queue(this, 'De-Sharding Queue');
    this.dsQueueUrl = dsQueue.queueUrl;

    // De-sharding Lambda
    const dsLambda = new lambda.Function(this, 'MyFunction', {
      code: lambda.Code.fromAsset(__dirname + 'lambdas/de-sharding'),
      runtime: lambda.Runtime.NODEJS_12_X,
      handler: "index.onEvent",
    });
    this.table.grantReadWriteData(dsLambda);

    dsLambda.addEventSource(new les.SqsEventSource(dsQueue));
  }
}
