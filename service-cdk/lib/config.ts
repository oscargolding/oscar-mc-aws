import { StackConfig } from "./types";

export const resolveConfig = (): StackConfig => ({
    // To be made - create a domain name to actually use
    domainName: process.env.DOMAIN_NAME || '',
    subdomainPart: 'minecraft',
    serverRegion: 'ap-southeast-2',
    minecraftEdition: `java`,
    shutdownMinutes: '20',
    startupMinutes: '10',
    useFargateSpot: true,
    taskCpu: +(4096),
    taskMemory: +(16384),
    // Just create a new vpc if we haven't already
    vpcId: '',
    snsEmailAddress: 'oscargolding17@gmail.com',
    debug: false,
});
