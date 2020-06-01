# How to Load Test Your DynamoDB Table Using a CDK Serverless App


I finally dedicated some good hours to build a CDK stack to test this. Here's a step by step:

>_Disclaimer: Unless you're testing this with very light loads, deploying this App will cost you money. I'm not responsible for that._

### Bootstrap a new CDK app
1. Install CDK: `npm install -g aws-cdk`
2. Create a new CDK app:
```
mkdir dynamodb-load-test && cd dynamodb-load-test
cdk init --language typescript
```

### Adding our victim (the Table)
This is pretty straight-forward using the L1 construct available at the official CDK construct library.
```
npm install @aws-cdk/aws-dynamodb
```
<sub>`lib/dynamodb-load-test-stack.ts`</sub>
```typescript
import * as ddb from '@aws-cdk/aws-dynamodb';

    // Table
    const table = new ddb.Table(this, "WillItThrottle", {
      partitionKey: {name: "PK", type: ddb.AttributeType.STRING},
      sortKey: {name: "SK", type: ddb.AttributeType.STRING},
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
```

### Workers
For the workers, I opted to use [Fargate](https://aws.amazon.com/fargate/), the AWS _serverless_ offer for Docker container workloads. Fargate is a perfect fit for ephemeral tasks / test workloads as we don't need to worry about provisioning servers.

```bash
npm install @aws-cdk/aws-ec2
npm install @aws-cdk/aws-ecs
npm install @aws-cdk/aws-iam
```
```typescript
import * as ec2 from '@aws-cdk/aws-ec2';
import * as ecs from '@aws-cdk/aws-ecs';
import * as iam from '@aws-cdk/aws-iam';

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
```

All workers will use the same image that contains three different `ts-node` scripts, one for each task type (insert, read, update). As you might have noticed, the workers' code was isolated in a separate construct.

```typescript
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
```

>_Notice how easy it is to build custom Docker images in the context of your CDK App by using the `fromAsset()` method. It builds your image and updates to it a repository, linking the reference to your deployment behind the scene._

Since all the workers have the same Task Definition, we'll need to make them behave differently by passing parameters at execution time in the form of "container overrides".

### Orchestration and Iteration
In order to orchestrate the test batches, a Step Functions State Machine was used. It was built chaining Task States that will define the ultimate behaviour our workers, such as the velocity and duration of the load, as well as the type of the workload (insert, read or update).

```bash
npm install @aws-cdk/aws-stepfunctions
npm install @aws-cdk/aws-stepfunctions-tasks
```

```typescript
import * as sfn from '@aws-cdk/aws-stepfunctions';
import * as sft from '@aws-cdk/aws-stepfunctions-tasks';

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
              value: "600", // INSERT duration (seconds)
            },
            {
              name: "LOAD",
              value: "500", // INSERT load (items / interval)
            },
            {
              name: "INTERVAL",
              value: "1000", // INSERT interval (milliseconds)
            },
          ],
          command: ["ts-node", '/opt/insert.ts'] // type of load
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
             value: "600", // READ duration (seconds)
           },
           {
             name: "LOAD",
             value: "500", // READ load (items / interval)
           },
           {
             name: "INTERVAL",
             value: "1000", // READ interval (milliseconds)
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
              value: "180", // UPDATE duration (seconds)
            },
            {
              name: "LOAD",
              value: "300", // UPDATE load (items / interval)
            },
            {
              name: "INTERVAL",
              value: "700", // UPDATE interval (milliseconds)
            },
          ],
          command: ["ts-node", '/opt/update.ts'] //insert, update, read
        }
      ]
    });
```

To define the horizontal scale of the batches, nothing better than Step Functions Parallel state.

```typescript
    // Inserts in Parallel
    const insertData = new sfn.Parallel(this, "InsertData", {
      resultPath: "DISCARD",
    });
    for (let x = 0; x < 5; x++) {
      insertData.branch(new sfn.Task(this, "InsertWorker " + x.toString(), {
        task: insertWorkerTask,
      }))
    }
    // Reads in Parallel
    const readData = new sfn.Parallel(this, "ReadData", {
      resultPath: "DISCARD",
    });
    for (let x = 0; x < 15; x++) {
      readData.branch(new sfn.Task(this, "ReadWorker " + x.toString(), {
        task: readWorkerTask,
      }))
    }
    // Updates in Parallel
    const updateData = new sfn.Parallel(this, "UpdateData", {
      resultPath: "DISCARD",
    });
    for (let x = 0; x < 5; x++) {
      updateData.branch(new sfn.Task(this, "UpdateWorker " + x.toString(), {
        task: updateWorkerTask,
      }))
    }
```


To manage the execution iterations, [this](https://github.com/andrestone/cdk-execution-manager) CDK construct was used. It takes a State Machine and an input as props and gives us a nice iteration routine, conveniently displaying a link to the current execution details on Step Functions console. I also added a Pass state (`endState`), so it was possible to perform "dry runs" and two Choice states, so I could stop the execution after a certain state.

```bash
npm install cdk-execution-manager
```
```typescript
    // State Machine
    const definition = insertData
      .next(new sfn.Choice(this, "QuitAfterInsert?").when(sfn.Condition.stringEquals("$.runNext", "NO"), endState)
        .otherwise(readData.next(new sfn.Choice(this, "QuitAfterRead?").when(sfn.Condition.stringEquals("$.runNext", "NO"), endState)
          .otherwise(updateData))));

    const deployment = new DeploymentManager(this, "TestDeployment", {
      stateMachineDefinition: definition,
      executionInput: {
        resumeTo: insertData.id,
        runNext: "NO"
      }
    });
```

### Monitoring

Besides the workflow graphical view Step Function gives, we need to actually observe how the table reacts to the thing being test. For this specific test, a CloudWatch Dashboard featuring the WCU and RCU node limits and the working throughput was configured. It also features the total number of throttled events for both reads and writes.

```
npm install @aws-cdk/aws-cloudwatch
```
```typescript

    // CW Dashboard
    const dash = new DynamoDBTestCWDashboard(this, "WillItThrottleDashBoard", {
      tableName: table.tableName,
    });

...

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
```

[dashboard image]

Here is the App's source code, including the test workers.