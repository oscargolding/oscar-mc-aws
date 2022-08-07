#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DomainMinecraftCdkStack } from '../lib/minecraft-cdk-stack';
import { constants } from '../lib/constants';
import { resolveConfig } from '../lib/config';
import { MinecraftStack } from '../lib/minecraft-stack';

const config = resolveConfig();

const app = new cdk.App();

// Creating the domain stack first
const domainStack = new DomainMinecraftCdkStack(app, 'MinecraftCdkStack', {
  env: {
    region: constants.DOMAIN_STACK_REGION,
    // TODO: replace with the actual account that will be used
    account: '123456789012'
  },
  config
});

const mcStack = new MinecraftStack(app, 'minecraft-server-stack', {
  env: {
    region: config.serverRegion,
    account: '123456789012'
  },
  config
});

mcStack.addDependency(domainStack);