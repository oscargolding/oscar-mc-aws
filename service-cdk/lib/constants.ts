export const constants = {
    CLUSTER_NAME: 'minecraft',
    SERVICE_NAME: 'minecraft-server',
    MC_SERVER_CONTAINER_NAME: 'minecraft-server',
    WATCHDOG_SERVER_CONTAINER_NAME: 'minecraft-ecsfargate-watchdog',
    // Required, since Route53 is in IAD
    DOMAIN_STACK_REGION: 'us-east-1',
    ECS_VOLUME_NAME: 'data',
    HOSTED_ZONE_SSM_PARAMETER: 'MinecraftHostedZoneID',
    LAUNCHER_LAMBDA_ARN_SSM_PARAMETER: 'LauncherLambdaRoleArn',
}