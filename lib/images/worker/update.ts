import ddb from 'aws-sdk/clients/dynamodb';
import {v4 as uuidv4} from 'uuid';

const client = new ddb();
const tableName = process.env.TABLE_NAME as string;
const executionId = uuidv4();
const startTime = Date.now();
let consumedCapacity = 0;
const duration = parseInt(process.env.DURATION || "300"); // 5 minutes
const nItems = parseInt(process.env.LOAD || "100"); // 100 items
const interval = parseInt(process.env.INTERVAL || "1000") // 1 second


async function pickItems(): Promise<Array<{ PK: string, SK: string }>> {
  const items = new Array<{ PK: string, SK: string }>();
  while (items.length < nItems) {
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
        if (items.length >= nItems) {
          break;
        } else {
          items.push({PK: r.PK!.S!, SK: r.SK!.S!})
        }
      }
    }
  }
  console.log(`Execution ${executionId}: Randomly picked ${nItems}.\n`);
  return items;
}

async function doTest(): Promise<Array<Promise<ddb.UpdateItemOutput>>> {
  const items = await pickItems();
  const promises = new Array<Promise<ddb.UpdateItemOutput>>();
  for (const i of items) {
    promises.push(client.updateItem({
      TableName: tableName,
      Key: {
        PK: {
          S: i.PK
        },
        SK: {
          S: i.SK
        }
      },
      ExpressionAttributeValues: {
        ":pl": {
          S: uuidv4(),
        }
      },
      UpdateExpression: "SET Payload = :pl",
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
        const chunk = promises.splice(0, 10);
        const rets = await Promise.all(chunk);
        for (const ret of rets) {
          consumedCapacity += ret.ConsumedCapacity?.CapacityUnits ? ret.ConsumedCapacity.CapacityUnits : 0;
        }
      }
      console.log(`UPDATE ${executionId}: consumedCapacity so far: ${consumedCapacity}\n`);
    } catch (error) {
      console.log(`UPDATE ERROR on ${executionId}: failed to resolve ${promises.length} promises.\n`);
      console.log(`Error: ${error}`);
      console.log(`UPDATE ${executionId}: consumedCapacity so far: ${consumedCapacity}\n`);
    }
    const memStat = process.memoryUsage();
    console.log(`UPDATE Took ${((Date.now() - ahora) / 1000).toFixed(3)} seconds to process ${((interval) / 1000).toFixed(3)} second(s).`)
    console.log(`UPDATE ${executionId}: RSS(${memStat.rss / 1024 / 1024}MB) HT(${memStat.heapTotal / 1024 / 1024}MB) HU(${memStat.heapUsed / 1024 / 1024}MB)\n`);
  }
  return true;
}

run()
  .then(x => {
      const ahora = Date.now();
      console.log(`UPDATE ${executionId}: UpdateItem at ${nItems} items every ${interval / 1000} second(s) for ${duration} seconds.`)
      console.log(`UPDATE ${executionId}: consumedCapacity: ${consumedCapacity}\n`);
      console.log(`UPDATE ${executionId}: finished ${ahora}. Duration: ${ahora - startTime}ms.`);
      process.exit();
    }
  )