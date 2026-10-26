import { it, describe, expect, vi, beforeEach } from "vitest"
import { getCowQuote } from "./getCowQuote"
import { SupportedChainId } from "./types"

// Mock the fetchLicense function from the swaps appData module
vi.mock("../main/licensing", () => ({
  fetchLicense: vi.fn(),
  License: {
    None: 0,
    Free: 1,
    Enterprise: 2,
  },
}))

// Never call the live CoW orderbook: it rate-limits Node clients (HTTP 429),
// and the CoW SDK's retry backoff then runs past the test timeout. The mock
// answers like the real endpoint: it echoes the request back as the quote.
vi.mock("./cowOrderbookApi", () => ({
  getCowOrderbookQuote: vi.fn(async (_chainId, request) => ({
    quote: {
      sellToken: request.sellToken.toLowerCase(),
      buyToken: request.buyToken.toLowerCase(),
      receiver: request.receiver.toLowerCase(),
      sellAmount: "999966852721560360",
      buyAmount: "18487546591058794003291",
      validTo: request.validTo,
      appData: request.appData,
      feeAmount: "33147278439640",
      kind: request.kind,
      partiallyFillable: false,
      sellTokenBalance: "erc20",
      buyTokenBalance: "erc20",
      signingScheme: request.signingScheme,
    },
    from: request.from,
    expiration: "2026-01-01T00:00:00Z",
    id: 1,
    verified: true,
  })),
}))

// Import the License enum from the actual module for type safety
import { License } from "../main/licensing"
import { fetchLicense } from "../main/licensing"
import { encodeKey } from "../main/keys"
import { getCowOrderbookQuote } from "./cowOrderbookApi"
const mockFetchLicense = vi.mocked(fetchLicense)
const mockGetCowOrderbookQuote = vi.mocked(getCowOrderbookQuote)

// Token addresses on mainnet
const WETH_ADDRESS =
  "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as `0x${string}`
const COW_ADDRESS =
  "0xDEf1CA1fb7FBcDC777520aa7f396b4E015F497aB" as `0x${string}`

// RolesMod address from the user request
const ROLES_MOD_ADDRESS =
  "0x27d8bb2e33Bc38A9CE93fdD90C80677b8436aFfb" as `0x${string}`
const AVATAR_ADDRESS =
  "0x849D52316331967b6fF1198e5E32A0eB168D039d" as `0x${string}`
const OWNER_ADDRESS =
  "0x849D52316331967b6fF1198e5E32A0eB168D039d" as `0x${string}`

// 1 ETH in wei
const ONE_ETH_WEI = 1000000000000000000n

describe("getCowQuote", () => {
  beforeEach(() => {
    // Reset the mock before each test
    mockFetchLicense.mockReset()
    mockGetCowOrderbookQuote.mockClear()
  })

  it("should use 25 basis points partner fee for License.None", async () => {
    // Set up mock to return License.None
    mockFetchLicense.mockResolvedValue(License.None)

    // Calculate a valid timestamp (30 minutes from now)
    const validTo = Math.floor(Date.now() / 1000) + 30 * 60

    // Call getCowQuote
    const quote = await getCowQuote({
      kind: "sell",
      sellToken: WETH_ADDRESS,
      buyToken: COW_ADDRESS,
      sellAmountBeforeFee: ONE_ETH_WEI,
      validTo,
      chainId: SupportedChainId.MAINNET,
      rolesModifier: ROLES_MOD_ADDRESS,
      roleKey: encodeKey("test-role"),
      avatar: AVATAR_ADDRESS,
      owner: OWNER_ADDRESS,
    })

    // Verify the quote was successful
    expect(quote).toBeDefined()
    expect(quote.sellToken.toLowerCase()).toBe(WETH_ADDRESS.toLowerCase())
    expect(quote.buyToken.toLowerCase()).toBe(COW_ADDRESS.toLowerCase())

    // Parse appData to verify partner fee
    const appData = JSON.parse(quote.appData)
    expect(appData.metadata.partnerFee.bps).toBe(25)

    // and that is what went to the orderbook
    expect(mockGetCowOrderbookQuote).toHaveBeenCalledOnce()
    const [chainId, request] = mockGetCowOrderbookQuote.mock.calls[0]
    expect(chainId).toBe(SupportedChainId.MAINNET)
    expect(request).toMatchObject({
      from: AVATAR_ADDRESS,
      receiver: AVATAR_ADDRESS,
      validTo,
      kind: "sell",
      sellAmountBeforeFee: ONE_ETH_WEI.toString(),
      signingScheme: "presign",
    })
    expect(JSON.parse(request.appData as string).metadata.partnerFee.bps).toBe(
      25
    )
  })

  it("should use 0 basis points partner fee for License.Enterprise", async () => {
    // Set up mock to return License.Enterprise
    mockFetchLicense.mockResolvedValue(License.Enterprise)

    // Calculate a valid timestamp (30 minutes from now)
    const validTo = Math.floor(Date.now() / 1000) + 30 * 60

    // Call getCowQuote
    const quote = await getCowQuote({
      kind: "sell",
      sellToken: WETH_ADDRESS,
      buyToken: COW_ADDRESS,
      sellAmountBeforeFee: ONE_ETH_WEI,
      validTo,
      chainId: SupportedChainId.MAINNET,
      rolesModifier: ROLES_MOD_ADDRESS,
      roleKey: encodeKey("test-role"),
      avatar: AVATAR_ADDRESS,
      owner: OWNER_ADDRESS,
    })

    // Verify the quote was successful
    expect(quote).toBeDefined()
    expect(quote.sellToken.toLowerCase()).toBe(WETH_ADDRESS.toLowerCase())
    expect(quote.buyToken.toLowerCase()).toBe(COW_ADDRESS.toLowerCase())

    // Parse appData to verify no partner fee specified
    const appData = JSON.parse(quote.appData)
    expect(appData.metadata.partnerFee).toBe(undefined)
    const [, request] = mockGetCowOrderbookQuote.mock.calls[0]
    expect(JSON.parse(request.appData as string).metadata.partnerFee).toBe(
      undefined
    )
  })
})
