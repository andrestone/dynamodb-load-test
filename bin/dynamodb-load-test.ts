#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { DynamodbLoadTest } from '../lib/dynamodb-load-test';

const app = new cdk.App();
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
