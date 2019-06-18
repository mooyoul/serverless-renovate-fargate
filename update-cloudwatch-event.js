'use strict';

const AWS = require('aws-sdk');

const WAIT_REQUIRED_CF_STATUS = [
  "CREATE_IN_PROGRESS",
  "ROLLBACK_IN_PROGRESS",
  "UPDATE_IN_PROGRESS",
  "UPDATE_COMPLETE_CLEANUP_IN_PROGRESS",
  "UPDATE_ROLLBACK_IN_PROGRESS",
  "UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS",
  "REVIEW_IN_PROGRESS",
];

const FAILED_CF_STATUS = [
  "CREATE_FAILED",
  "ROLLBACK_FAILED",
  "DELETE_IN_PROGRESS",
  "DELETE_FAILED",
  "DELETE_COMPLETE",
  "UPDATE_ROLLBACK_FAILED",
];


(async ([ stackName ]) => {
  if (!stackName) {
    console.error('Missing stack name');
    return 1;
  }

  console.log('Checking stack %s', stackName);

  const cf = new AWS.CloudFormation();

  let attempt = 0;
  do {
    const res = await cf.describeStacks({
      StackName: stackName,
    }).promise();

    const [ stack ] = res.Stacks;
    const status = stack.StackStatus;

    if (WAIT_REQUIRED_CF_STATUS.includes(status)) {
      console.log('Stack is in-progress status (%s). Waiting...', status);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } else if (FAILED_CF_STATUS.includes(status)) {
      console.error('Detected unexpected stack status %s: Exiting for safety.', status);
      return 1;
    } else {
      break;
    }
  } while (attempt++ < 300);

  const output = await (async () => {
    const res = await cf.describeStacks({
      StackName: stackName,
    }).promise();

    const [ stack ] = res.Stacks;

    const result = stack.Outputs.reduce((hash, v) => {
      hash[v.OutputKey] = v.OutputValue;
      return hash;
    }, {});


    return {
      TaskName: result.TaskName,
      ECSCluster: result.ECSCluster,
      ECSTaskDefinition: result.ECSTaskDefinition,
      VpcId: result.VpcId,
      SubnetIds: result.SubnetIds.split(',').map((v) => v.trim()).filter((v) => v),
      SecurityGroupId: result.SecurityGroupId,
      CloudwatchEventRuleName: result.CloudwatchEventRuleName,
      CloudwatchEventRole: result.CloudwatchEventRole,
    };
  })();

  for (const key of Object.keys(output)) {
    if (!output[key]) {
      console.error('Failed to find required key %s from stack output', key);
      return 1;
    }
  }

  if (output.SubnetIds.length === 0) {
    console.error('Failed to find Subnet Ids from stack output');
    return 1;
  }

  console.log('Got Outputs from Stack %s', stackName);
  console.log('=====================================');
  console.log('VPC Id: ', output.VpcId);
  console.log('Subnet Ids: ', output.SubnetIds.join(' '));
  console.log('Security Group Id: ', output.SecurityGroupId);
  console.log('Cloudwatch Event Rule Name: ', output.CloudwatchEventRuleName);

  console.log('\nChecking networking configuration');

  const invalidSubnet = await (async () => {
    const ec2 = new AWS.EC2();
    const res = await ec2.describeSubnets({ SubnetIds: output.SubnetIds }).promise();

    const subnetVpcMap = new Map(res.Subnets.map((s) => [s.SubnetId, s.VpcId]));

    return output.SubnetIds.find((subnetId) => subnetVpcMap.get(subnetId) !== output.VpcId);
  })();

  if (invalidSubnet) {
    console.error('Subnet %s is not part of VPC %s', invalidSubnet, output.VpcId);
    return 1;
  }

  console.log('Passed network config validation');


  console.log('\nReading current Target configuration of Cloudwatch Event Rule...');
  const events = new AWS.CloudWatchEvents();
  const targets = (await events.listTargetsByRule({
    Rule: output.CloudwatchEventRuleName,
  }).promise()).Targets;

  const currentTarget = targets.find((t) => t.Id === output.TaskName);
  if (!currentTarget) {
    console.error('Failed to find Cloudwatch Event Rule Target which is associated with Rule %s', output.CloudwatchEventRuleName);
    return 1;
  }

  const target = {
    Id: currentTarget.Id,
    Arn: output.ECSCluster,
    RoleArn: output.CloudwatchEventRole,
    EcsParameters: {
      TaskDefinitionArn: output.ECSTaskDefinition,
      TaskCount: 1,
      LaunchType: 'FARGATE',
      NetworkConfiguration: {
        awsvpcConfiguration: {
          Subnets: output.SubnetIds,
          AssignPublicIp: 'ENABLED',
          SecurityGroups: [output.SecurityGroupId],
        },
      },
    },
  };

  console.log('Generated Target: ', JSON.stringify(target, null, 2));

  console.log('\nWaiting for 10 sec for confirmation.');
  await new Promise((resolve) => setTimeout(resolve, 10000));

  console.log('\nUpdating target...');
  await events.putTargets({
    Rule: output.CloudwatchEventRuleName,
    Targets: [target],
  }).promise();

  console.log('\nSuccessfully updated target. exiting.');
})(process.argv.slice(2)).then((v) => {
  process.exitCode = v || 0;
}).catch((e) => {
  console.error('Got unexpected error: ', e.message);
  console.error('Failed to update cloudwatch event!');
  process.exitCode = 1;
});
