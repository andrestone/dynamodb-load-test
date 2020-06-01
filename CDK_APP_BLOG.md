# How to Load Test Your DynamoDB Table Using a CDK Serverless App

I recently needed to clarify an understanding about a DynamoDB feature and, in the lack of other means, decided to run some tests in order to see how it would perform. In order to do so, I built a CDK app featuring: 

- Fargate Workers
- CloudWatch Dashboard
- Step Functions State Machine 
- Execution Manager

Here is a walkthrough:
 
>_Disclaimer: Unless you're testing this with very light loads, deploying this App will cost you money. I'm not responsible for that._

### Bootstrap a new CDK app
1. Install CDK: `npm install -g aws-cdk`
2. Create a new CDK app:
```
mkdir dynamodb-load-test && cd dynamodb-load-test
cdk init --language typescript
```

### Construct Interfaces
```typescript
interface DynamoDBLoadTestProps extends cdk.StackProps {
  /**
   *  Configuration for the INSERT worker.
   *
   * @default
   */
  readonly insertWorkerProps: WorkerProps;

  /**
   *  Configuration for the READ worker.
   *
   * @default
   */
  readonly readWorkerProps: WorkerProps;

  /**
   *  Configuration for the UPDATE worker.
   *
   * @default
   */
  readonly updateWorkerProps: WorkerProps;

  /**
   * Execution input
   */
  readonly executionInput?: executionInputProps;
}

interface executionInputProps {
  /**
   * The state to resume to.
   *
   */
  readonly resumeTo: string;

  /**
   * If should run next batch.
   * "YES" or "NO"
   *
   */
  readonly runNext: string;

  /**
   * Other inputs
   *
   */
  readonly [name: string]: string | undefined;
}

interface WorkerProps {
  /**
   * Total number of copies for this worker.
   *
   * @default 5
   */
  readonly copies: number;

  /**
   * Total number of iterations that will happen after each interval.
   *
   * @default 600
   */
  readonly iterations?: number;

  /**
   * Interval on top of processing time in milliseconds.
   *
   * @default 1000
   */
  readonly interval?: number;

  /**
   * Number of capacity units (WCU or RCU) per iteration.
   *
   * @default 300
   */
  readonly load?: number;

  /**
   * Rate on which to increment the load (e.g: 0.3 for 30%).
   *
   * @default 0.0
   */
  readonly  increment?: number;

  /**
   * Limit to use when specifying an increment rate. Use -1 for no limit.
   *
   * @default -1
   */
  readonly loadLimit?: number;

  /**
   * Number of intervals to trigger an increment (e.g: if the interval is 1000ms, set it
   * to 60 to have an increment per minute)
   *
   * @default 60
   */
  readonly incrementTime?: number;
}
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
              value: (props?.insertWorkerProps.iterations?.toFixed(0)) || "600", // INSERT duration 
            },
            {
              name: "LOAD",
              value: (props?.insertWorkerProps.load?.toFixed(0)) || "300", // INSERT load (items / interval)
            },
            {
              name: "INTERVAL",
              value: (props?.insertWorkerProps.interval?.toFixed(0)) || "1000", // INSERT interval 
            },
            {
              name: "INCREMENT",
              value: (props?.insertWorkerProps.increment?.toFixed(2)) || "0", // INSERT incremental rate (e.g: 0.3 for 30% each INC_TIME)
            },
            {
              name: "LOAD_LIMIT",
              value: (props?.insertWorkerProps.loadLimit?.toFixed(0)) || "-1", // INSERT maximum load limit (-1 for no limit)
            },
            {
              name: "INC_TIME",
              value: (props?.insertWorkerProps.incrementTime?.toFixed(0)) || "60", // INSERT time to apply INCREMENT 
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
              value: (props?.readWorkerProps.iterations?.toFixed(0)) || "600", // READ duration
            },
            {
              name: "LOAD",
              value: (props?.readWorkerProps.load?.toFixed(0)) || "300", // READ load (items / interval)
            },
            {
              name: "INTERVAL",
              value: (props?.readWorkerProps.interval?.toFixed(0)) || "1000", // READ interval 
            },
            {
              name: "INCREMENT",
              value: (props?.readWorkerProps.increment?.toFixed(2)) || "0", // READ incremental rate (e.g: 0.3 for 30% each INC_TIME)
            },
            {
              name: "LOAD_LIMIT",
              value: (props?.readWorkerProps.loadLimit?.toFixed(0)) || "-1", // READ maximum load limit (-1 for no limit)
            },
            {
              name: "INC_TIME",
              value: (props?.readWorkerProps.incrementTime?.toFixed(0)) || "60", // READ time to apply INCREMENT 
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
              value: (props?.updateWorkerProps.iterations?.toFixed(0)) || "600", // UPDATE duration
            },
            {
              name: "LOAD",
              value: (props?.updateWorkerProps.load?.toFixed(0)) || "300", // UPDATE load (items / interval)
            },
            {
              name: "INTERVAL",
              value: (props?.updateWorkerProps.interval?.toFixed(0)) || "1000", // UPDATE interval 
            },
            {
              name: "INCREMENT",
              value: (props?.updateWorkerProps.increment?.toFixed(2)) || "0", // UPDATE incremental rate (e.g: 0.3 for 30% each INC_TIME)
            },
            {
              name: "LOAD_LIMIT",
              value: (props?.updateWorkerProps.loadLimit?.toFixed(0)) || "-1", // UPDATE maximum load limit (-1 for no limit)
            },
            {
              name: "INC_TIME",
              value: (props?.updateWorkerProps.incrementTime?.toFixed(0)) || "60", // UPDATE time to apply INCREMENT 
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
    for (let x = 0; x < (props?.insertWorkerProps.copies || 5); x++) {
      insertData.branch(new sfn.Wait(this, "INSERT " + x.toString(), {time: sfn.WaitTime.duration(cdk.Duration.seconds(x))})
        .next(
          new sfn.Task(this, "InsertWorker " + x.toString(), {
            task: insertWorkerTask,
          })));
    }
    // Reads in Parallel
    const readData = new sfn.Parallel(this, "ReadData", {
      resultPath: "DISCARD",
    });
    for (let x = 0; x < (props?.insertWorkerProps.copies || 5); x++) {
      readData.branch(new sfn.Wait(this, "READ " + x.toString(), {time: sfn.WaitTime.duration(cdk.Duration.seconds(x))})
        .next(
          new sfn.Task(this, "ReadWorker " + x.toString(), {
            task: readWorkerTask,
          })));
    }
    // Updates in Parallel
    const updateData = new sfn.Parallel(this, "UpdateData", {
      resultPath: "DISCARD",
    });
    for (let x = 0; x < (props?.insertWorkerProps.copies || 5); x++) {
      updateData.branch(new sfn.Wait(this, "UPDATE " + x.toString(), {time: sfn.WaitTime.duration(cdk.Duration.seconds(x))})
        .next(
          new sfn.Task(this, "UpdateWorker " + x.toString(), {
            task: updateWorkerTask,
          })));
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
      executionInput: props?.executionInput || {
        resumeTo: insertData.id,
        runNext: "YES"
      }
    });
```

### Monitoring


![CloudWatch Dashboard](https://dev-to-uploads.s3.amazonaws.com/i/mjrsuw618k1a00g10rk8.png)
<figcaption>CloudWatch dashboard widget in action</figcaption>

Besides the default DynamoDB metrics, we could have other metrics / dashboards more specific to what we're testing. This can be done by configuring a CloudWatch Dashboard.

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


Here is the App's [source code](https://github.com/andrestone/dynamodb-load-test/), including the test workers.

_Thanks for reading!_

--
André