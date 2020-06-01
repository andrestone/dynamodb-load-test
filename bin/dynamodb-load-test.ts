#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { DynamodbLoadTest } from '../lib/dynamodb-load-test';
import { LazyShardingStack } from '../lib/lazy-sharding-stack';

const app = new cdk.App();

const lazySharding = new LazyShardingStack(app, "LazyShardingStack");

new DynamodbLoadTest(app, 'DynamodbLoadTestStack',  {
  table: lazySharding.table,
  dsQueue: lazySharding.dsQueueUrl,
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
