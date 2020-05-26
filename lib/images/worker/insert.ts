import ddb from 'aws-sdk/clients/dynamodb';
import { v4 as uuidv4 } from 'uuid';

const client = new ddb();
const tableName = process.env.TABLE_NAME as string;
const executionId = uuidv4();
const startTime = Date.now();
const promises = new Array<Promise<ddb.BatchWriteItemOutput>>();
let throttledRequests = 0;
let consumedCapacity = 0;
const duration = parseInt(process.env.DURATION || "300"); // 5 minutes
const load = parseInt(process.env.LOAD || "500"); // 500 items
const interval = parseInt(process.env.INTERVAL || "1000") // 1 second

function doTest() {

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
}

// Send 500 items per second for 5 minutes
async function run() {
  let ran = 0;
  console.log(`Execution ${executionId}: started ${startTime}\n`);
  while (true) {
    if (ran === duration) {
      break;
    }
    doTest();
    ran++;
    await new Promise(r => setTimeout(r, interval));
  }
  const rets = await Promise.all(promises);

  for (const ret of rets) {
    throttledRequests += ret.UnprocessedItems?.[tableName]?.length || 0;
    consumedCapacity += ret.ConsumedCapacity ? ret.ConsumedCapacity.reduce((a, c: any) => a + c.CapacityUnits, 0) : 0;
  }
}

run().then(x => {
  const ahora = Date.now();
  console.log(`Execution ${executionId}: PutItem at ${load / (interval/1000)}/s for ${duration} seconds.\n`)
  console.log(`Execution ${executionId}: throttledRequests: ${throttledRequests}\n`);
  console.log(`Execution ${executionId}: consumedCapacity: ${consumedCapacity}\n`);
  console.log(`Execution ${executionId}: finished ${ahora}. Duration: ${startTime - ahora}ms.`);
  }
)