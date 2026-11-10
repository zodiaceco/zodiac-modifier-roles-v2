import type { HardhatRuntimeEnvironment } from "hardhat/types";
import { ZeroHash } from "ethers";
import { predictSingletonAddress } from "@gnosis-guild/zodiac-core";

const AddressOne = "0x0000000000000000000000000000000000000001";

type ConstructorArgs = {
  types: string[];
  values: string[];
};

export type MastercopyDeployment = {
  address: string;
  bytecode: string;
  constructorArgs: ConstructorArgs;
  contract: string;
  contractName: string;
  libraries?: Record<string, string>;
  salt: string;
};

export async function buildMastercopyDeployments(
  hre: HardhatRuntimeEnvironment,
): Promise<MastercopyDeployment[]> {
  const integrity = await readArtifact({
    hre,
    contractName: "Integrity",
    contract: "contracts/Integrity.sol:Integrity",
  });
  const packer = await readArtifact({
    hre,
    contractName: "Packer",
    contract: "contracts/packers/Packer.sol:Packer",
  });
  const avatarIsOwnerOfERC721 = await readArtifact({
    hre,
    contractName: "AvatarIsOwnerOfERC721",
    contract:
      "contracts/adapters/AvatarIsOwnerOfERC721.sol:AvatarIsOwnerOfERC721",
  });
  const multiSendUnwrapper = await readArtifact({
    hre,
    contractName: "MultiSendUnwrapper",
    contract: "contracts/adapters/MultiSendUnwrapper.sol:MultiSendUnwrapper",
  });
  const morphoBundler3Unwrapper = await readArtifact({
    hre,
    contractName: "MorphoBundler3Unwrapper",
    contract:
      "contracts/periphery/MorphoBundler3Unwrapper.sol:MorphoBundler3Unwrapper",
  });

  const libraries = {
    Integrity: integrity.address,
    Packer: packer.address,
  };
  const rolesFactory = await hre.ethers.getContractFactory("Roles", {
    libraries,
  });
  const roles = buildDeployment({
    contractName: "Roles",
    contract: "contracts/Roles.sol:Roles",
    bytecode: rolesFactory.bytecode,
    constructorArgs: {
      types: ["address", "address", "address"],
      values: [AddressOne, AddressOne, AddressOne],
    },
    libraries,
  });

  return [
    integrity,
    packer,
    avatarIsOwnerOfERC721,
    multiSendUnwrapper,
    morphoBundler3Unwrapper,
    roles,
  ];
}

async function readArtifact({
  hre,
  contractName,
  contract,
}: {
  hre: HardhatRuntimeEnvironment;
  contractName: string;
  contract: string;
}) {
  const artifact = await hre.artifacts.readArtifact(contract);
  return buildDeployment({
    contractName,
    contract,
    bytecode: artifact.bytecode,
    constructorArgs: { types: [], values: [] },
  });
}

function buildDeployment({
  contractName,
  contract,
  bytecode,
  constructorArgs,
  libraries,
}: Omit<MastercopyDeployment, "address" | "salt">): MastercopyDeployment {
  const salt = ZeroHash;
  return {
    address: predictSingletonAddress({ bytecode, constructorArgs, salt }),
    bytecode,
    constructorArgs,
    contract,
    contractName,
    libraries,
    salt,
  };
}
