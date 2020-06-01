## Usage

`git clone https://github.com/andrestone/dynamodb-load-test.git`

Configure the test by modifying `bin/dynamodb-load-test.ts`:

```typescript
new DynamodbLoadTest(app, 'DynamodbLoadTestStack',  {
  insertWorkerProps: {
    load: 200,
    iterations: 60,
    interval: 1000,
    increment: 0,
    incrementTime: 60,
    copies: 3,
    loadLimit: -1,
  },
  updateWorkerProps: {
    load: 200,
    iterations: 60,
    interval: 1000,
    increment: 0,
    incrementTime: 60,
    copies: 3,
    loadLimit: -1,
  },
  readWorkerProps: {
    load: 200,
    iterations: 60,
    interval: 1000,
    increment: 0,
    incrementTime: 60,
    copies: 9,
    loadLimit: -1,
  }
});
```

Workers are defined a `ts-node` scripts that run on Fargate containers. You can customise the workers by modifying `lib/images/worker`.

## LICENSE
MIT

