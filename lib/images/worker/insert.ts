import ddb from 'aws-sdk/clients/dynamodb';
import { v4 as uuidv4 } from 'uuid';

const client = new ddb();
const tableName = process.env.TABLE_NAME as string;
const executionId = uuidv4();
const startTime = Date.now();
let throttledRequests = 0;
let consumedCapacity = 0;
const duration = parseInt(process.env.DURATION || "300"); // 5 minutes
let load = parseInt(process.env.LOAD || "500"); // 500 items
const interval = parseInt(process.env.INTERVAL || "1000") // 1 second
const incRate = parseFloat(process.env.INCREMENT || "0")
const limit = parseInt(process.env.LOAD_LIMIT || "-1");
const incTime = parseInt(process.env.INC_TIME || "60"); // 1 minute / 60 seconds


function doTest():Array<Promise<ddb.BatchWriteItemOutput>> {

  const promises = new Array<Promise<ddb.BatchWriteItemOutput>>();
  const items = [];
  while (items.length < load) {
    items.push({
      PutRequest: {
        Item: {
          PK: {
            S: "UltimatePK",
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

  console.log(`INSERT ${executionId} STATUS: Randomly inserted ${items.length} items.\n`)

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
  console.log(`INSERT ${executionId} STATUS: started ${startTime}\n`);
  while (true) {
    if (ran === duration) {
      break;
    }
    // Increment load
    if (ran !== 0 && ran % incTime === 0) {
      const newLoad = Math.floor(load * (1 + incRate));
      load = (newLoad < limit || limit < 0) ? newLoad : limit;
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
      console.log(`INSERT ${executionId} STATUS: throttledRequests so far: ${throttledRequests}\n`);
      console.log(`INSERT ${executionId} STATUS: consumedCapacity so far: ${consumedCapacity}\n`);
    }
    catch (error) {
      console.log(`INSERT ${executionId} ERROR: failed to resolve ${promises.length} promises.\n`);
      console.log(`INSERT ${executionId} ERROR: ${error}`);
    }
    const memStat = process.memoryUsage();
    console.log(`INSERT ${executionId} STATUS: Took ${((Date.now() - ahora) / 1000).toFixed(3)} seconds to process ${((interval) / 1000).toFixed(3)} second(s).`)
    console.log(`INSERT ${executionId} STATUS: RSS(${memStat.rss/1024/1024}MB) HT(${memStat.heapTotal/1024/1024}MB) HU(${memStat.heapUsed/1024/1024}MB)\n`);
  }
  return true;
}

run().then(x => {
    const ahora = Date.now();
    console.log(`INSERT ${executionId} STATUS: PutItem at ${load / (interval/1000)}/s for ${duration} seconds.\n`)
    console.log(`INSERT ${executionId} STATUS: throttledRequests: ${throttledRequests}\n`);
    console.log(`INSERT ${executionId} STATUS: consumedCapacity: ${consumedCapacity}\n`);
    console.log(`INSERT ${executionId} STATUS: finished ${ahora}. Duration: ${ahora - startTime}ms.`);
    process.exit();
  }
)