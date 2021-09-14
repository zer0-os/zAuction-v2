import { ZAuction__factory } from "./../typechain/factories/ZAuction__factory";
import { ethers, upgrades, network, run } from "hardhat";

import {
  DeploymentData,
  DeploymentOutput,
  deploymentsFolder,
  getDeploymentData,
  getLogger,
  writeDeploymentData,
} from "../utilities";

import * as fs from "fs";

import {
  hashBytecodeWithoutMetadata,
  Manifest,
} from "@openzeppelin/upgrades-core";
import { Contract } from "ethers";
const logger = getLogger("scripts::deploy-zauction");

const tokenAddress = "0x50A0A3E9873D7e7d306299a75Dc05bd3Ab2d251F"; //kovan addresses, change to correct later
const registrarAddress = "0xC613fCc3f81cC2888C5Cccc1620212420FFe4931";

interface DeployedContract {
  isUpgradable: boolean;
  instance: Contract;
  version: string;
  date: string;
}

interface UpgradableDeployedContract extends DeployedContract {
  implementationAddress: string;
  admin: string;
}

async function main() {
  await run("compile");
  const accounts = await ethers.getSigners();
  const deploymentAccount = accounts[0];

  logger.log(`Deploying to ${network.name}`);

  logger.log(
    `'${deploymentAccount.address}' will be used as the deployment account`
  );

  const zauctionfactory = new ZAuction__factory(deploymentAccount);

  const bytecodeHash = hashBytecodeWithoutMetadata(zauctionfactory.bytecode);

  logger.debug(`Implementation version is ${bytecodeHash}`);

  const instance = await upgrades.deployProxy(
    zauctionfactory,
    [tokenAddress, registrarAddress],
    {
      initializer: "initialize",
    }
  );
  await instance.deployed();

  logger.log(`Deployed contract to ${instance.address}`);

  const ozUpgradesManifestClient = await Manifest.forNetwork(network.provider);
  const manifest = await ozUpgradesManifestClient.read();
  const implementationContract = manifest.impls[bytecodeHash];

  if (!manifest.admin) {
    throw Error(`No admin address?`);
  }

  if (!implementationContract) {
    throw Error(`No implementation contract?`);
  }

  const deploymentData: UpgradableDeployedContract = {
    isUpgradable: true,
    instance,
    implementationAddress: implementationContract.address,
    version: bytecodeHash,
    date: new Date().toISOString(),
    admin: manifest.admin.address,
  };

  //updating saving system for deployment data
  logger.debug(`Saving deployment data...`);
  await saveDeploymentData(
    "zAuction",
    deploymentData,
    {
      tokenAddress,
      registrarAddress,
    },
    undefined,
    "wilder-prod"
  );

  //fs.mkdirSync(deploymentsFolder, { recursive: true });

  if (deploymentData.implementationAddress) {
    logger.log(`Waiting for 5 confirmations`);
    await instance.deployTransaction.wait(5);

    logger.log(`Attempting to verify implementation contract with etherscan`);
    try {
      await run("verify:verify", {
        address: deploymentData.implementationAddress,
        constructorArguments: [],
      });
    } catch (e) {
      logger.error(`Failed to verify contract: ${e}`);
    }
  }
}

const saveDeploymentData = async (
  type: string,
  deployment: DeployedContract | UpgradableDeployedContract,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: { [key: string]: any },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: { [key: string]: any },
  tag?: string
) => {
  let deploymentData: DeploymentOutput = {};

  try {
    const existingData = getDeploymentData(network.name);
    deploymentData = existingData;
  } catch (e) {
    // create folder
    logger.debug(`no existing deployments found, creating folder`);
    fs.mkdirSync(deploymentsFolder, { recursive: true });
  }

  if (!deploymentData[type]) {
    deploymentData[type] = [];
  }

  const deployments = deploymentData[type];

  let implementation: string | undefined;
  let admin: string | undefined;

  // extract extra data if this is an upgradable contract
  if (deployment.isUpgradable) {
    const upgradableDeployment = deployment as UpgradableDeployedContract;
    implementation = upgradableDeployment.implementationAddress;
    admin = upgradableDeployment.admin;
  }

  const finalTag = tag || "untagged";

  checkUniqueTag(finalTag, deployments);

  logger.log(`Registering new deployment of ${type} with tag '${finalTag}'`);
  const deploymentInstance: DeploymentData = {
    tag,
    address: deployment.instance.address,
    version: deployment.version,
    date: deployment.date,
    args,
    isUpgradable: deployment.isUpgradable,
    admin,
    implementation,
    metadata,
  };

  deployments.push(deploymentInstance);

  writeDeploymentData(network.name, deploymentData);
  logger.log(`Updated ${network.name} deployment file.`);
};

const checkUniqueTag = (tag: string, deployments: DeploymentData[]) => {
  const numMatches = deployments.filter((d) => {
    if (!d.tag) {
      return false;
    }
    return d.tag.toLowerCase() === tag.toLowerCase();
  }).length;

  logger.warn(
    `There are ${numMatches} deployments with the same tag of ${tag}`
  );
};

main();
