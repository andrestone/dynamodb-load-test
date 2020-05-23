#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { DynamodbAcAutoSplitStack } from '../lib/dynamodb-ac-auto-split-stack';

const app = new cdk.App();
new DynamodbAcAutoSplitStack(app, 'DynamodbAcAutoSplitStack');
