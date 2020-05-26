import ddb from 'aws-sdk/clients/dynamodb';
import { v4 as uuidv4 } from 'uuid';

const client = new ddb();
const tableName = process.env.TABLE_NAME as string;
const executionId = uuidv4();
const startTime = Date.now();
const promises = new Array<Promise<ddb.UpdateItemOutput>>();
let consumedCapacity = 0;
const duration = parseInt(process.env.DURATION || "300"); // 5 minutes
const nItems = parseInt(process.env.LOAD || "100"); // 100 items
const interval = parseInt(process.env.INTERVAL || "1000") // 1 second

const items = new Array<{PK: string, SK: string}>();


async function pickItems() {
  while (items.length < nItems) {
    const leading = Math.random().toString(36).slice(2,3);
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
        }
        else {
          items.push({PK: r.PK!.S!, SK: r.SK!.S!})
        }
      }
    }
  }
  console.log(`Execution ${executionId}: Randomly picked ${nItems}.\n`)
}

async function doTest() {
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
    await new Promise(r => setTimeout(r, 1000));
  }
  const rets = await Promise.all(promises);

  for (const ret of rets) {
    consumedCapacity += ret.ConsumedCapacity?.CapacityUnits ? ret.ConsumedCapacity.CapacityUnits : 0;
  }
}

pickItems()
  .then( x => run()
    .then(x => {
      const ahora = Date.now();
      console.log(`Execution ${executionId}: UpdateItem at ${nItems} items every ${interval/1000} second(s) for ${duration} seconds.`)
      console.log(`Execution ${executionId}: consumedCapacity: ${consumedCapacity}\n`);
      console.log(`Execution ${executionId}: finished ${ahora}. Duration: ${startTime - ahora}ms.`);
    }
))