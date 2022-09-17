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
            removalPolicy: RemovalPolicy.DESTROY
        });

        const accessPoint = new aws_efs.AccessPoint(this, 'AccessPoint', {
            fileSystem,
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

        const minecraftServerContainer = taskDefinition.addContainer('ServerContainer', {
            containerName: constants.MC_SERVER_CONTAINER_NAME,
            image: aws_ecs.ContainerImage.fromAsset(path.resolve(__dirname, '../../server-docker')),
            portMappings: [
                {
                    containerPort: javaConfig.port,
                    hostPort: javaConfig.port,
                    protocol: javaConfig.protocol
                }
            ],
            essential: true,
            logging: config.debug ? new aws_ecs.AwsLogDriver({
                logRetention: aws_logs.RetentionDays.THREE_DAYS,
                streamPrefix: constants.MC_SERVER_CONTAINER_NAME
            }) : undefined
        })

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

        serviceSecurityGroup.addIngressRule(
            aws_ec2.Peer.anyIpv4(),
            aws_ec2.Port.tcp(22),
            'allow ssh access from anywhere in the world'
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
        });
        serviceControlPolicy.attachToRole(ecsTaskRole);
    }
}