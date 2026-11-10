import { task } from "hardhat/config";

import { deployFactories, deployMastercopy } from "@gnosis-guild/zodiac-core";

import {
  buildMastercopyDeployments,
  type MastercopyDeployment,
} from "./buildMastercopyDeployments";
import { createEIP1193 } from "./createEIP1193";

task(
  "deploy:mastercopy",
  "Deploys the current Roles release (primary mastercopy plus prerequisite singleton libraries and periphery contracts) without persisting metadata",
).setAction(async (_, hre) => {
  const [signer] = await hre.ethers.getSigners();
  const provider = createEIP1193(
    hre.network.config.chainId,
    hre.network.provider,
    signer,
  );

  await deployFactories({ provider });

  for (const deployment of await buildMastercopyDeployments(hre)) {
    await deployOne(deployment, provider);
  }
});

async function deployOne(
  deployment: MastercopyDeployment,
  provider: Parameters<typeof deployMastercopy>[0]["provider"],
) {
  const { address, noop } = await deployMastercopy({
    bytecode: deployment.bytecode,
    constructorArgs: deployment.constructorArgs,
    salt: deployment.salt,
    provider,
    onStart: () => {
      console.log(`Deploying ${deployment.contractName}...`);
    },
  });

  console.log(
    noop
      ? `${deployment.contractName} already deployed at ${address}`
      : `${deployment.contractName} deployed at ${address}`,
  );
}
