import { expect as expectCDK, matchTemplate, MatchStyle } from '@aws-cdk/assert';
import * as cdk from '@aws-cdk/core';
import * as DynamodbAcAutoSplit from '../lib/dynamodb-load-test';

test('Empty Stack', () => {
    const app = new cdk.App();
    // WHEN
    const stack = new DynamodbAcAutoSplit.DynamodbLoadTest(app, 'MyTestStack');
    // THEN
    expectCDK(stack).to(matchTemplate({
      "Resources": {}
    }, MatchStyle.EXACT))
});
