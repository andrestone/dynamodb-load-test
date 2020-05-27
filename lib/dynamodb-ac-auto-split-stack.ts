import * as cdk from '@aws-cdk/core';
import * as ddb from '@aws-cdk/aws-dynamodb';
import * as cw from '@aws-cdk/aws-cloudwatch';
import * as ecs from '@aws-cdk/aws-ecs';
import * as iam from '@aws-cdk/aws-iam';
import * as sfn from '@aws-cdk/aws-stepfunctions';
import * as sft from '@aws-cdk/aws-stepfunctions-tasks';
import * as ec2 from '@aws-cdk/aws-ec2';
import {DeploymentManager} from "cdk-execution-manager";


export class DynamodbAcAutoSplitStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Table
    const table = new ddb.Table(this, "WillItThrottle", {
      partitionKey: {name: "PK", type: ddb.AttributeType.STRING},
      sortKey: {name: "SK", type: ddb.AttributeType.STRING},
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // CW Dashboard
    const dash = new DynamoDBTestCWDashboard(this, "WillItThrottleDashBoard", {
      tableName: table.tableName,
    });

    // Fargate Cluster and VPC
    const vpc = new ec2.Vpc(this, 'Vpc', {maxAzs: 1});
    const cluster = new ecs.Cluster(this, 'FargateCluster', {vpc});

    // ECS Task Role with access to Table
    const taskRole = new iam.Role(this, "TestWorkerRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });
    table.grantReadWriteData(taskRole);

    // Worker
    const testWorker = new TestWorker(this, "FargateWorker", {
      tableName: table.tableName,
      taskRole,
    });

    // Insert Task
    const insertWorkerTask = new sft.RunEcsFargateTask({
      taskDefinition: testWorker.taskDefinition,
      integrationPattern: sfn.ServiceIntegrationPattern.SYNC,

      cluster,
      containerOverrides: [
        {
          containerName: testWorker.container.containerName,
          environment: [
            {
              name: "DURATION",
              value: "600", // INSERT seconds
            },
            {
              name: "LOAD",
              value: "500", // INSERT items
            },
            {
              name: "INTERVAL",
              value: "1000", // INSERT milliseconds
            },
          ],
          command: ["ts-node", '/opt/insert.ts'] //insert, update, read
        }
      ]
    });

    // Read Task
    const readWorkerTask = new sft.RunEcsFargateTask({
      taskDefinition: testWorker.taskDefinition,
      integrationPattern: sfn.ServiceIntegrationPattern.SYNC,
      cluster,
      containerOverrides: [
        {
          containerName: testWorker.container.containerName,
          environment: [
            {
              name: "DURATION",
              value: "600", // READ seconds
            },
            {
              name: "LOAD",
              value: "300", // READ items
            },
            {
              name: "INTERVAL",
              value: "1000", // READ milliseconds
            },
          ],
          command: ["ts-node", '/opt/read.ts'] //insert, update, read
        }
      ]
    });

    // Update Task
    const updateWorkerTask = new sft.RunEcsFargateTask({
      taskDefinition: testWorker.taskDefinition,
      integrationPattern: sfn.ServiceIntegrationPattern.SYNC,
      cluster,
      containerOverrides: [
        {
          containerName: testWorker.container.containerName,
          environment: [
            {
              name: "DURATION",
              value: "180", // UPDATE seconds
            },
            {
              name: "LOAD",
              value: "300", // UPDATE items
            },
            {
              name: "INTERVAL",
              value: "700", // UPDATE interval
            },
          ],
          command: ["ts-node", '/opt/update.ts'] //insert, update, read
        }
      ]
    });

    // StateMachine
    const endState = new sfn.Pass(this, "Quit");

    // 3 insert workers / 1500 inserts per second
    const insertData = new sfn.Parallel(this, "InsertData", {
      resultPath: "DISCARD",
    });
    for (let x = 0; x < 5; x++) {
      insertData.branch(new sfn.Task(this, "InsertWorker " + x.toString(), {
        task: insertWorkerTask,
      }))
    }
    // 15 read workers / 4500 reads per second
    const readData = new sfn.Parallel(this, "ReadData", {
      resultPath: "DISCARD",
    });
    for (let x = 0; x < 15; x++) {
      readData.branch(new sfn.Task(this, "ReadWorker " + x.toString(), {
        task: readWorkerTask,
      }))
    }
    // 5 update workers / 2500 updates per cycle (avg 1.8hz, over 1000 updates / second)
    const updateData = new sfn.Parallel(this, "UpdateData", {
      resultPath: "DISCARD",
    });
    for (let x = 0; x < 5; x++) {
      updateData.branch(new sfn.Task(this, "UpdateWorker " + x.toString(), {
        task: updateWorkerTask,
      }))
    }

    // Dry Run
    const definition = insertData
      .next(new sfn.Choice(this, "QuitAfterInsert?").when(sfn.Condition.stringEquals("$.runNext", "NO"), endState)
        .otherwise(readData.next(new sfn.Choice(this, "QuitAfterRead?").when(sfn.Condition.stringEquals("$.runNext", "NO"), endState)
          .otherwise(updateData))));

    const deployment = new DeploymentManager(this, "TestDeployment", {
      stateMachineDefinition: definition,
      executionInput: {
        resumeTo: endState.id,
        runNext: "NO"
      }
    })
  }
}

interface TestWorkerProps {
  readonly taskRole: iam.IRole,
  readonly tableName: string,
}

class TestWorker extends cdk.Construct {
  private readonly _taskDefinition: ecs.FargateTaskDefinition;
  private readonly _container: ecs.ContainerDefinition;

  constructor(scope: cdk.Construct, id: string, props: TestWorkerProps) {
    super(scope, id);

    this._taskDefinition = new ecs.FargateTaskDefinition(this, "DDBTestWorkerTask", {
      taskRole: props.taskRole,
      memoryLimitMiB: 1024,
    })

    this._container = new ecs.ContainerDefinition(this._taskDefinition, "DDBTestWorkerTaskContainer", {
      taskDefinition: this._taskDefinition,
      logging: ecs.LogDriver.awsLogs({
        streamPrefix: "DDBTestWorkerTaskContainer"
      }),
      image: ecs.ContainerImage.fromAsset("./lib/images/worker"),
      environment: {
        TABLE_NAME: props.tableName,
      }
    });
  }

  public get taskDefinition(): ecs.FargateTaskDefinition {
    return this._taskDefinition;
  }

  public get container(): ecs.ContainerDefinition {
    return this._container;
  }
}


class DynamoDBTestCWDashboard extends cdk.Construct {
  constructor(scope: cdk.Construct, id: string, props: { tableName: string }) {
    super(scope, id);

    const dash = new cw.Dashboard(this, id, {
      dashboardName: "DynamoDB-AC-Auto-Split-Tests",
    });

    const readThrottleEvents = new cw.Metric({
      namespace: 'AWS/DynamoDB',
      metricName: 'ReadThrottleEvents',
      period: cdk.Duration.minutes(1),
      statistic: "sum",
      dimensions: {
        TableName: props.tableName,
      }
    });

    const writeThrottleEvents = new cw.Metric({
      namespace: 'AWS/DynamoDB',
      metricName: 'WriteThrottleEvents',
      period: cdk.Duration.minutes(1),
      statistic: "sum",
      dimensions: {
        TableName: props.tableName,
      }
    });

    const consumedReadCapacityUnits = new cw.Metric({
      namespace: 'AWS/DynamoDB',
      metricName: 'ConsumedReadCapacityUnits',
      period: cdk.Duration.minutes(1),
      statistic: "sum",
      dimensions: {
        TableName: props.tableName,
      }
    });

    const consumedWriteCapacityUnits = new cw.Metric({
      namespace: 'AWS/DynamoDB',
      metricName: 'ConsumedWriteCapacityUnits',
      period: cdk.Duration.minutes(1),
      statistic: "sum",
      dimensions: {
        TableName: props.tableName,
      }
    });

    const consumedRCU = new cw.MathExpression({
      expression: "r/60",
      usingMetrics: {
        r: consumedReadCapacityUnits,
      },
      label: "Consumed RCUs",
      color: "#114477",
      period: cdk.Duration.minutes(1),
    });

    const consumedWCU = new cw.MathExpression({
      expression: "w/60",
      usingMetrics: {
        w: consumedWriteCapacityUnits,
      },
      label: "Consumed WCUs",
      color: "#117744",
      period: cdk.Duration.minutes(1),
    });

    const graph = new cw.GraphWidget({
      title: "DynamoDB Test",
      right: [consumedRCU, consumedWCU],
      left: [readThrottleEvents, writeThrottleEvents],
      rightAnnotations: [
        {label: "RCU Node Limit", color: "#114477", value: 3000},
        {label: "WCU Node Limit", color: "#117744", value: 1000},
      ]
    })

    dash.addWidgets(graph);
  }

}
