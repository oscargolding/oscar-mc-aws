#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { constants } from '../lib/constants';
import { resolveConfig } from '../lib/config';
import { MinecraftStack } from '../lib/minecraft-stack';

const config = resolveConfig();

const app = new cdk.App();

// Create a minecraft stack that sets up Fargate and everything we need
const mcStack = new MinecraftStack(app, 'minecraft-server-stack', {
  env: {
    region: config.serverRegion,
    account: '934867246463'
  },
  config
});