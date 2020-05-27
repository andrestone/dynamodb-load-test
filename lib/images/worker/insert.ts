import ddb from 'aws-sdk/clients/dynamodb';
import { v4 as uuidv4 } from 'uuid';

const client = new ddb();
const tableName = process.env.TABLE_NAME as string;
const executionId = uuidv4();
const startTime = Date.now();
let throttledRequests = 0;
let consumedCapacity = 0;
const duration = parseInt(process.env.DURATION || "300"); // 5 minutes
const load = parseInt(process.env.LOAD || "500"); // 500 items
const interval = parseInt(process.env.INTERVAL || "1000") // 1 second

function doTest():Array<Promise<ddb.BatchWriteItemOutput>> {

  const promises = new Array<Promise<ddb.BatchWriteItemOutput>>();
  const items = [];
  while (items.length < load) {
    items.push({
      PutRequest: {
        Item: {
          PK: {
            S: "SinglePK",
          },
          SK: {
            S: Math.random().toString(36).slice(2,3) + "#" + uuidv4(),
          },
          Payload: {
            S: uuidv4(),
          }
        }
      }
    })
  }

  while (items.length > 0) {
    promises.push(client.batchWriteItem({
      RequestItems: {
        [tableName]: items.splice(0, 25)
      },
      ReturnConsumedCapacity: "TOTAL",
    }).promise());
  }

  return promises
}

// Send 500 items per second for 5 minutes
async function run() {
  let ran = 0;
  console.log(`Execution ${executionId}: started ${startTime}\n`);
  while (true) {
    if (ran === duration) {
      break;
    }
    const ahora = Date.now();
    const promises = doTest();
    ran++;
    // Interval
    await new Promise(r => setTimeout(r, interval));
    // Resolve promises
    try {
      while (promises.length > 0) {
        const chunk = promises.splice(0, 10);
        const rets = await Promise.all(chunk);
        for (const ret of rets) {
          throttledRequests += ret.UnprocessedItems?.[tableName]?.length || 0;
          for (const c of ret?.ConsumedCapacity || []) {
            consumedCapacity += c.CapacityUnits || 0;
          }
        }
      }
      console.log(`INSERT ${executionId}: throttledRequests so far: ${throttledRequests}\n`);
      console.log(`INSERT ${executionId}: consumedCapacity so far: ${consumedCapacity}\n`);
    }
    catch (error) {
      console.log(`INSERT ERROR on ${executionId}: failed to resolve ${promises.length} promises.\n`);
      console.log(`Error: ${error}`);
    }
    const memStat = process.memoryUsage();
    console.log(`INSERT Took ${((Date.now() - ahora) / 1000).toFixed(3)} seconds to process ${((interval) / 1000).toFixed(3)} second(s).`)
    console.log(`INSERT ${executionId}: RSS(${memStat.rss/1024/1024}MB) HT(${memStat.heapTotal/1024/1024}MB) HU(${memStat.heapUsed/1024/1024}MB)\n`);
  }
  return true;
}

run().then(x => {
    const ahora = Date.now();
    console.log(`INSERT ${executionId}: PutItem at ${load / (interval/1000)}/s for ${duration} seconds.\n`)
    console.log(`INSERT ${executionId}: throttledRequests: ${throttledRequests}\n`);
    console.log(`INSERT ${executionId}: consumedCapacity: ${consumedCapacity}\n`);
    console.log(`INSERT ${executionId}: finished ${ahora}. Duration: ${ahora - startTime}ms.`);
    process.exit();
  }
)