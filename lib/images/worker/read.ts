import ddb from 'aws-sdk/clients/dynamodb';
import { v4 as uuidv4 } from 'uuid';

const client = new ddb();
const tableName = process.env.TABLE_NAME as string;
const executionId = uuidv4();
const startTime = Date.now();
const promises = new Array<Promise<ddb.QueryOutput>>();
let consumedCapacity = 0;
let itemsRead = 0;
const duration = parseInt(process.env.DURATION || "300"); // 5 minutes
const load = parseInt(process.env.LOAD || "500"); // 500 reads
const interval = parseInt(process.env.INTERVAL || "1000") // 1 second

function doTest() {
  const leading = Math.random().toString(36).slice(2,3);
  promises.push(client.query({
    TableName: tableName,
    ExpressionAttributeValues: {
      ":spk": {
        S: "SinglePK"
      },
      ":l": {
        S: leading
      }
    },
    KeyConditionExpression: `PK = :spk AND begins_with(SK, :l)`,
    Limit: load,
    ReturnConsumedCapacity: "TOTAL"
  }).promise());
}

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
    itemsRead += ret.Items?.length || 0;
    consumedCapacity += ret.ConsumedCapacity?.CapacityUnits ? ret.ConsumedCapacity.CapacityUnits : 0;
  }
}

run()
  .then(x => {
    const ahora = Date.now();
    console.log(`Execution ${executionId}: Query at ${load / (interval/1000)}/s for ${duration} seconds.\n`)
    console.log(`Execution ${executionId}: consumedCapacity: ${consumedCapacity}\n`);
    console.log(`Execution ${executionId}: itemsRead: ${itemsRead}\n`);
    console.log(`Execution ${executionId}: finished ${ahora}. Duration: ${startTime - ahora}ms.`);
  }
)