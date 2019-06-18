# serverless-renovate-fargate

A [CloudFormation](https://aws.amazon.com/cloudformation/) template for running self-hosted [renovate](https://renovatebot.com/) service using [Fargate](https://aws.amazon.com/fargate/).

- Renovate Website: https://renovatebot.com
- Renovate Github Repository: https://github.com/renovatebot/renovate


> Please read 'IMPORTANT: Updating CloudWatch Event Rule' section before deploying your first stack!  

[![Launch Stack](https://cdn.rawgit.com/buildkite/cloudformation-launch-stack-button-svg/master/launch-stack.svg)](https://console.aws.amazon.com/cloudformation/home#/stacks/new?stackName=renovate&templateURL=https://renovate-cloudformation.s3.amazonaws.com/fargate.yml)


## Resources

This CloudFormation stack creates below resources to run renovate service

- ECS Cluster
- ECS Task Definition
- IAM Role for ECS Cluster
- IAM Role for ECS Task Execution
- IAM Role for ECS Task itself
- IAM Role for CloudWatch Event
- CloudWatch Log Group for logging renovate output
- VPC Security Group for securing Fargate container
- CloudWatch Event Rule for executing ECS Task periodically 


## Prerequisites

Before creating your stack using this CloudFormation template, 
you should prepare below resources:

- VPC for associating Fargate container
- Subnets for associating Fargate container. Subnets should be able to talk with Internet.
- A Secret (Github Access Token) which is saved at [Secrets Manager](https://aws.amazon.com/secrets-manager/) for accessing GitHub service
- Node.js v8+ for scripting (see below for details)


## Parameters

Name | Type | Description | Default Value
---- | ---- | ----------- | -----------------
ClusterName | String | A name for ECS Cluster | renovate
TaskName | String | A name for ECS Task Definition | renovate-runner
ContainerCpu | Number | How much CPU to give the container. 1024 is 1 CPU | 1024
ContainerMemory | Number | How much memory in megabytes to give the container | 2048
ContainerVpcId | String | A VPC Id of Task Container | N/A
ContainerSubnets: | String | Comma-delimited list of subnet ids | N/A
RenovateTokenSecretArn | String | A Secret (from Secrets Manager service) ARN of Renovate Token for accessing Github. | N/A
RenovateCronPattern | String | A cron pattern for executing renovate runner periodically | `cron(0 * ? * MON-FRI *)`


## IMPORTANT: Updating CloudWatch Event Rule 

[Due to missing support of CloudFormation for creating CloudWatch Event Rule with Fargate](https://github.com/aws/containers-roadmap/issues/92),
You must update CloudWatch Event Rule which is created from this CloudFormation stack manually.

Otherwise, Fargate Task won'be executed by CloudWatch Event.   

For convenience, I've created update script to update CloudWatch Event Rule.

Simply run script like below from your terminal:

```bash
$ git clone https://github.com/mooyoul/serverless-renovate-fargate.git
$ cd serverless-renovate-fargate
$ npm install
$ env AWS_PROFILE=my_profile AWS_REGION=us-east-1 node update-cloudwatch-event.js
```  

It's recommended to run this update script after every stack creation, or stack update 


## Customizing Renovate

There's several ways to customize renovate service.

##### See also

- https://github.com/renovatebot/renovate/blob/master/docs/self-hosting.md
- https://renovatebot.com/docs/self-hosted-configuration/

#### Using Environment Variable

Just uncomment `Environment` section and add needed environment variables:

```diff
--- a/fargate.yml
+++ b/fargate.yml
@@ -148,9 +148,11 @@ Resources:
               awslogs-group: !Ref 'RenovateTaskLogGroup'
               awslogs-stream-prefix: renovate
           # Add your own renovate configuration via Environment variable if needed
-#          Environment:
-#            - Name: RENOVATE_AUTODISCOVERY
-#              Value: true
+          Environment:
+            - Name: RENOVATE_AUTODISCOVERY
+              Value: true
+            - Name: RENOVATE_AUTODISCOVER_FILTER
+              Value: 'vingle-*'
           Secrets:
             - Name: RENOVATE_TOKEN
               ValueFrom: !Ref 'RenovateTokenSecretArn'
```


#### Using Command Arguments

Add `Command` section with needed parameters:

```diff
--- a/fargate.yml
+++ b/fargate.yml
@@ -141,6 +141,10 @@ Resources:
           Cpu: !Ref 'ContainerCpu'
           Memory: !Ref 'ContainerMemory'
           Image: 'renovate/renovate'
+          Command:
+            - '--autodiscover=false'
+            - 'org/repo1'
+            - 'org/repo2'
           LogConfiguration:
             LogDriver: awslogs
             Options:
```
 

#### Using Configuration File

To use configuration file, edit `fargate.yml` like below or build your own Docker image.

```diff
--- a/fargate.yml
+++ b/fargate.yml
@@ -141,6 +141,11 @@ Resources:
           Cpu: !Ref 'ContainerCpu'
           Memory: !Ref 'ContainerMemory'
           Image: 'renovate/renovate'
+          EntryPoint:
+            - 'bash'
+          Command:
+            - '-c'
+            - 'curl -sL https://s3.amazonaws.com/my-bucket/my-renovate-config.js > renovate.js && renovate'
           LogConfiguration:
             LogDriver: awslogs
             Options:
```


## Debugging

The Fargate task is configured to use CloudWatch Logs driver, You can see logs on the CloudWatch Logs console.

Name of log group is `${CLUSTER_NAME}/${TASK_NAME}`. (It should be `renovate/renovate-runner` if you use defaults)  


## License

[MIT](LICENSE)

See full license on [mooyoul.mit-license.org](http://mooyoul.mit-license.org/)
