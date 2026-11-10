import { task } from "hardhat/config";
import type { HardhatRuntimeEnvironment } from "hardhat/types";

import {
  buildMastercopyDeployments,
  type MastercopyDeployment,
} from "./buildMastercopyDeployments";

task(
  "verify:mastercopy",
  "Verifies the current Roles release (primary mastercopy plus prerequisite singleton libraries and periphery contracts) without local metadata",
).setAction(async (_, hre) => {
  for (const deployment of await buildMastercopyDeployments(hre)) {
    await verifyOne(deployment, hre);
  }
});

async function verifyOne(
  deployment: MastercopyDeployment,
  hre: HardhatRuntimeEnvironment,
) {
  await hre.run("verify:verify", {
    address: deployment.address,
    constructorArguments: deployment.constructorArgs.values,
    contract: deployment.contract,
    libraries: deployment.libraries,
  });
}
