import { Arn, ArnFormat, aws_iam, aws_lambda, aws_logs, aws_logs_destinations, aws_route53, aws_ssm, Duration, lambda_layer_awscli, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import * as path from 'path';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { StackConfig } from './types';
import { constants } from './constants';

interface DomainStackProps extends StackProps {
  config: Readonly<StackConfig>;
}

export class DomainMinecraftCdkStack extends Stack {
  constructor(scope: Construct, id: string, props: DomainStackProps) {
    super(scope, id, props);

    // TODO: create the actual stack
    const { config } = props;

    const subDomain = `${config.subdomainPart}.${config.domainName}`;

    const queryGroup = new aws_logs.LogGroup(this, 'LogGroup', {
      logGroupName: `/aws/route53/${subDomain}`,
      retention: RetentionDays.THREE_DAYS,
      removalPolicy: RemovalPolicy.DESTROY
    });

    const firstGrant = queryGroup.grantWrite(
      new aws_iam.ServicePrincipal('route53.amazonaws.com'));
    firstGrant.assertSuccess();


    const rootHostedZone = aws_route53.HostedZone.fromLookup(this, 'HostedZone', {
      domainName: config.domainName
    });

    const subdomainHostedZone = new aws_route53.HostedZone(this, 'SubdomainHostedZone', {
      zoneName: subDomain,
      queryLogsLogGroupArn: queryGroup.logGroupArn
    });

    // Have the grant first
    subdomainHostedZone.node.addDependency(firstGrant);
    // Have the root node as a dependency
    subdomainHostedZone.node.addDependency(rootHostedZone);

    const nsRecord = new aws_route53.NsRecord(this, 'NSRecord', {
      zone: rootHostedZone,
      values: subdomainHostedZone.hostedZoneNameServers as string[],
      recordName: subDomain
    });

    const aRecord = new aws_route53.ARecord(this, 'ARecord', {
      target: {
        values: ['192.168.1.1']
      },
      ttl: Duration.seconds(30),
      recordName: subDomain,
      zone: subdomainHostedZone
    });

    // The core lambda function that is being used
    const launcherLambda = new aws_lambda.Function(this, 'LauncherLambda', {
      code: aws_lambda.Code.fromAsset(path.resolve(__dirname, '../../lambda')),
      handler: 'lambda_function.lambda_handler',
      runtime: aws_lambda.Runtime.PYTHON_3_9,
      environment: {
        REGION: config.serverRegion,
        CLUSTER: constants.CLUSTER_NAME,
        SERVICE: constants.SERVICE_NAME
      },
      logRetention: aws_logs.RetentionDays.THREE_DAYS
    });

    /**
     * Core method: create the subscription filter and send to lambda
     */
    queryGroup.addSubscriptionFilter('SubscriptionFilter', {
      destination: new aws_logs_destinations.LambdaDestination(launcherLambda),
      filterPattern: aws_logs.FilterPattern.anyTerm(subDomain)
    });

    new aws_ssm.StringParameter(this, 'HostedZoneParam', {
      allowedPattern: '.*',
      description: 'Hosted zone ID for minecraft server',
      parameterName: constants.HOSTED_ZONE_SSM_PARAMETER,
      stringValue: subdomainHostedZone.hostedZoneId,
    });

    new aws_ssm.StringParameter(this, 'LauncherLambdaFunction', {
      allowedPattern: '.*S.*',
      description: 'Minecraft launcher execution role ARN',
      parameterName: constants.LAUNCHER_LAMBDA_ARN_SSM_PARAMETER,
      stringValue: launcherLambda.role?.roleArn || '',
    });



  }
}
