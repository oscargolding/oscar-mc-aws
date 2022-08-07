import {
    Arn, ArnFormat, aws_ec2, aws_ecs, aws_efs, aws_iam,
    aws_logs, aws_sns, RemovalPolicy, Stack, StackProps
} from "aws-cdk-lib";
import { Construct } from "constructs";
import { StackConfig } from "./types";
import { constants } from './constants';
import { Port } from "aws-cdk-lib/aws-ec2";
import * as path from 'path';
import { Protocol } from "aws-cdk-lib/aws-ecs";
import { SSMParameterReader } from "./ssm-paramater-reader";

interface MinecraftStackProps extends StackProps {
    config: Readonly<StackConfig>
}

export class MinecraftStack extends Stack {
    constructor(scope: Construct, id: string, props: MinecraftStackProps) {
        super(scope, id, props);

        const { config } = props;

        const vpc = new aws_ec2.Vpc(this, 'Vpc', {
            maxAzs: 3,
            natGateways: 0,
        });

        const fileSystem = new aws_efs.FileSystem(this, 'Filesystem', {
            vpc,
            removalPolicy: RemovalPolicy.SNAPSHOT
        });

        const accessPoint = new aws_efs.AccessPoint(this, 'AccessPoint', {
            fileSystem,
            path: '/minecraft',
            posixUser: {
                uid: '1000',
                gid: '1000',
            },
            createAcl: {
                ownerGid: '1000',
                ownerUid: '1000',
                permissions: '0755',
            },
        });

        const efsReadWriteDataPolicy = new aws_iam.Policy(this, 'DataRWPolicy', {
            statements: [
                new aws_iam.PolicyStatement({
                    sid: 'AllowReadWriteOnEFS',
                    effect: aws_iam.Effect.ALLOW,
                    actions: [
                        'elasticfilesystem:ClientMount',
                        'elasticfilesystem:ClientWrite',
                        'elasticfilesystem:DescribeFileSystems',
                    ],
                    resources: [fileSystem.fileSystemArn],
                    conditions: {
                        StringEquals: {
                            'elasticfilesystem:AccessPointArn': accessPoint.accessPointArn,
                        }
                    }
                })
            ]
        });

        const ecsTaskRole = new aws_iam.Role(this, 'TaskRole', {
            assumedBy: new aws_iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
            description: 'Minecraft ECS task role',
        });

        efsReadWriteDataPolicy.attachToRole(ecsTaskRole);

        const cluster = new aws_ecs.Cluster(this, 'Cluster', {
            clusterName: constants.CLUSTER_NAME,
            vpc,
            containerInsights: true,
            enableFargateCapacityProviders: true
        });

        const javaConfig = {
            port: 25565,
            protocol: Protocol.TCP,
            ingressRulePort: Port.tcp(25565),
        };

        const taskDefinition = new aws_ecs.FargateTaskDefinition(
            this,
            'TaskDefinition',
            {
                taskRole: ecsTaskRole,
                memoryLimitMiB: config.taskMemory,
                cpu: config.taskCpu,
                volumes: [
                    {
                        name: constants.ECS_VOLUME_NAME,
                        efsVolumeConfiguration: {
                            fileSystemId: fileSystem.fileSystemId,
                            transitEncryption: 'ENABLED',
                            authorizationConfig: {
                                accessPointId: accessPoint.accessPointId,
                                iam: 'ENABLED'
                            }
                        }
                    }
                ]
            }
        );

        const minecraftServerContainer = new aws_ecs.ContainerDefinition(
            this,
            'ServerContainer',
            {
                containerName: constants.MC_SERVER_CONTAINER_NAME,
                image: aws_ecs.ContainerImage.fromAsset(path.resolve(__dirname, '../../server-docker')),
                portMappings: [
                    {
                        containerPort: javaConfig.port,
                        hostPort: javaConfig.port,
                        protocol: javaConfig.protocol
                    }
                ],
                essential: false,
                taskDefinition,
                logging: config.debug ? new aws_ecs.AwsLogDriver({
                    logRetention: aws_logs.RetentionDays.THREE_DAYS,
                    streamPrefix: constants.MC_SERVER_CONTAINER_NAME
                }) : undefined
            }
        );

        minecraftServerContainer.addMountPoints({
            containerPath: '/data',
            sourceVolume: constants.ECS_VOLUME_NAME,
            readOnly: false
        });

        const serviceSecurityGroup = new aws_ec2.SecurityGroup(
            this,
            'ServerSecurityGroup',
            {
                vpc,
                description: 'Security group for Minecraft on-demand'
            }
        );

        serviceSecurityGroup.addIngressRule(
            aws_ec2.Peer.anyIpv4(),
            javaConfig.ingressRulePort
        );

        const mincecraftServerService = new aws_ecs.FargateService(
            this,
            'FargateService',
            {
                cluster,
                capacityProviderStrategies: [
                    {
                        capacityProvider: config.useFargateSpot ? 'FARGATE_SPOT' : 'FARGATE',
                        weight: 1,
                        base: 1
                    }
                ],
                taskDefinition: taskDefinition,
                platformVersion: aws_ecs.FargatePlatformVersion.LATEST,
                serviceName: constants.SERVICE_NAME,
                desiredCount: 0,
                assignPublicIp: true,
                securityGroups: [serviceSecurityGroup]
            }
        );

        fileSystem.connections.allowDefaultPortFrom(
            mincecraftServerService.connections
        );

        const hostedZoneId = new SSMParameterReader(
            this,
            'Route53HostedZoneIdReader',
            {
                parameterName: constants.HOSTED_ZONE_SSM_PARAMETER,
                region: constants.DOMAIN_STACK_REGION,
            }).getParameterValue();

        let snsTopicArn = '';

        if (config.snsEmailAddress) {
            const snsTopic = new aws_sns.Topic(this, 'ServerSnsTopic', {
                displayName: 'Minecraft Server Notifications'
            });

            snsTopic.grantPublish(ecsTaskRole);

            const emailSubscription = new aws_sns.Subscription(
                this,
                'EmailSubscription',
                {
                    protocol: aws_sns.SubscriptionProtocol.EMAIL,
                    topic: snsTopic,
                    endpoint: config.snsEmailAddress
                }
            );

            snsTopicArn = snsTopic.topicArn;
        }

        const watchDogContainer = new aws_ecs.ContainerDefinition(
            this,
            'WatchDogContainer',
            {
                containerName: constants.WATCHDOG_SERVER_CONTAINER_NAME,
                image: aws_ecs.ContainerImage.fromRegistry(
                    'doctorray/minecraft-ecsfargate-watchdog'),
                essential: true,
                taskDefinition: taskDefinition,
                environment: {
                    CLUSTER: constants.CLUSTER_NAME,
                    SERVICE: constants.SERVICE_NAME,
                    DNSZONE: hostedZoneId,
                    SERVERNAME: `${config.subdomainPart}.${config.domainName}`,
                    SNSTOPIC: snsTopicArn,
                    STARTUPMIN: config.startupMinutes,
                    SHUTDOWNMIN: config.shutdownMinutes,
                },
                logging: config.debug
                    ? new aws_ecs.AwsLogDriver({
                        logRetention: aws_logs.RetentionDays.THREE_DAYS,
                        streamPrefix: constants.WATCHDOG_SERVER_CONTAINER_NAME,
                    })
                    : undefined,
            }
        );

        const serviceControlPolicy = new aws_iam.Policy(this, 'ServiceControlPolicy', {
            statements: [
                new aws_iam.PolicyStatement({
                    sid: 'AllowAllOnServiceAndTask',
                    effect: aws_iam.Effect.ALLOW,
                    actions: ['ecs:*'],
                    resources: [
                        mincecraftServerService.serviceArn,
                        Arn.format(
                            {
                                service: 'ecs',
                                resource: 'task',
                                resourceName: `${constants.CLUSTER_NAME}`,
                                arnFormat: ArnFormat.SLASH_RESOURCE_NAME
                            },
                            this
                        )
                    ]
                }),
                new aws_iam.PolicyStatement({
                    effect: aws_iam.Effect.ALLOW,
                    actions: ['ec2:DescribeNetworkInterfaces'],
                    resources: ['*']
                })
            ]
        })

        serviceControlPolicy.attachToRole(ecsTaskRole);

        // Add the service control to lambda

        const launcherLambdaRoleArn = new SSMParameterReader(
            this,
            'launcherLambdaRoleArn',
            {
                parameterName: constants.LAUNCHER_LAMBDA_ARN_SSM_PARAMETER,
                region: constants.DOMAIN_STACK_REGION,
            }
        ).getParameterValue();

        const launcherLambdaRole = aws_iam.Role.fromRoleArn(
            this,
            'LauncherLambdaRole',
            launcherLambdaRoleArn
        );

        serviceControlPolicy.attachToRole(launcherLambdaRole);

        // Give permission to update the associated A record
        const iamRoute53Policy = new aws_iam.Policy(this, 'IamRoute53Policy', {
            statements: [
                new aws_iam.PolicyStatement({
                    sid: 'AllowEditRecordSets',
                    effect: aws_iam.Effect.ALLOW,
                    actions: [
                        'route53:GetHostedZone',
                        'route53:ChangeResourceRecordSets',
                        'route53:ListResourceRecordSets',
                    ],
                    resources: [`arn:aws:route53:::hostedzone/${hostedZoneId}`],
                }),
            ]
        });
        iamRoute53Policy.attachToRole(ecsTaskRole);
    }
}