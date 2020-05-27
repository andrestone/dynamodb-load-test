import ddb from 'aws-sdk/clients/dynamodb';
import {v4 as uuidv4} from 'uuid';

//const client = new ddb({region: 'us-west-2'});
const client = new ddb();
const tableName = process.env.TABLE_NAME as string;
const executionId = uuidv4();
const startTime = Date.now();
let consumedCapacity = 0;
let throttledRequests = 0;
let itemsRead = 0;
const duration = parseInt(process.env.DURATION || "300"); // 5 minutes
const load = parseInt(process.env.LOAD || "300"); // 300 reads
const interval = parseInt(process.env.INTERVAL || "1000") // 1 second

async function pickItems(): Promise<Array<{ PK: ddb.AttributeValue, SK: ddb.AttributeValue }>> {
  const items = new Array<{ PK: ddb.AttributeValue, SK: ddb.AttributeValue }>();
  while (items.length < load) {
    const leading = Math.random().toString(36).slice(2, 3);
    const ret = await client.query({
      TableName: tableName,
      ExpressionAttributeValues: {
        ":spk": {
          S: "SinglePK"
        },
        ":l": {
          S: leading
        }
      },
      KeyConditionExpression: `PK = :spk and begins_with(SK, :l)`,
      Limit: 100,
    }).promise();
    if (ret.Items && ret.Items.length > 0) {
      const returnedItems = ret.Items;
      for (const r of returnedItems) {
        if (items.length >= load) {
          break;
        } else {
          items.push({PK: r.PK, SK: r.SK})
        }
      }
    }
  }
  console.log(`Execution ${executionId}: Randomly picked ${items.length} items.\n`)
  return items;
}

async function doTest(): Promise<Array<Promise<ddb.BatchGetItemOutput>>> {
  const items = await pickItems();
  const promises = new Array<Promise<ddb.BatchGetItemOutput>>();
  while (items.length > 0) {
    promises.push(client.batchGetItem({
      RequestItems: {
        [tableName]: {
          ConsistentRead: true,
          Keys: items.splice(0, 25)
        }
      },
      ReturnConsumedCapacity: "TOTAL",
    }).promise());
  }
  return promises
}

async function run() {
  let ran = 0;
  console.log(`Execution ${executionId}: started ${startTime}\n`);
  while (true) {
    if (ran === duration) {
      break;
    }
    const ahora = Date.now();
    const promises = await doTest();
    ran++;
    // Interval
    await new Promise(r => setTimeout(r, interval));
    // Resolve Promises
    try {
      while (promises.length > 0) {
        const chunk = promises.splice(0, 25);
        const rets = await Promise.all(chunk);
        for (const ret of rets) {
          itemsRead += ret.Responses?.[tableName].length || 0;
          throttledRequests += ret.UnprocessedKeys?.[tableName]?.Keys?.length || 0;
          for (const c of ret?.ConsumedCapacity || []) {
            consumedCapacity += c.CapacityUnits || 0;
          }
        }
      }
      console.log(`READ ${executionId}: throttledRequests so far: ${throttledRequests}\n`);
      console.log(`READ ${executionId}: consumedCapacity so far: ${consumedCapacity}\n`);
      console.log(`READ ${executionId}: itemsRead so far: ${itemsRead}\n`);
    } catch (error) {
      console.log(`READ ERROR on ${executionId}: failed to resolve ${promises.length} promises.\n`);
      console.log(`Error: ${error}`);
      console.log(`READ ${executionId}: throttledRequests so far: ${throttledRequests}\n`);
      console.log(`READ ${executionId}: consumedCapacity so far: ${consumedCapacity}\n`);
      console.log(`READ ${executionId}: itemsRead so far: ${itemsRead}\n`);
    }
    const memStat = process.memoryUsage();
    console.log(`READ Took ${((Date.now() - ahora) / 1000).toFixed(3)} seconds to process ${((interval) / 1000).toFixed(3)} second(s).`)
    console.log(`READ ${executionId}: RSS(${(memStat.rss / 1024 / 1024).toFixed(2)}MB) HT(${(memStat.heapTotal / 1024 / 1024).toFixed(2)}MB) HU(${(memStat.heapUsed / 1024 / 1024).toFixed(2)}MB)\n`);
  }
  return true;
}

run()
  .then(x => {
      const ahora = Date.now();
      console.log(`READ ${executionId}: Query at ${load / (interval / 1000)}/s for ${duration} seconds.\n`)
      console.log(`READ ${executionId}: throttledRequests: ${throttledRequests}\n`);
      console.log(`READ ${executionId}: consumedCapacity: ${consumedCapacity}\n`);
      console.log(`READ ${executionId}: itemsRead: ${itemsRead}\n`);
      console.log(`READ ${executionId}: finished ${ahora}. Duration: ${ahora - startTime}ms.`);
      process.exit();
    }
  )
