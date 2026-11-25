import { NextResponse } from "next/server"
import { targetIntegrity } from "zodiac-roles-sdk"
import { zPermissionsPost } from "./types"
import { withErrorHandling } from "../utils/withErrorHandling"
import { createPermissionsPost } from "./createPermissionsPost"

export const POST = withErrorHandling(async (req: Request) => {
  const json = await req.json()

  const validated = zPermissionsPost.parse(json)

  if (validated.targets) {
    try {
      targetIntegrity(validated.targets, {
        acknowledged: validated.acknowledged,
      })
    } catch (e) {
      return NextResponse.json({
        error:
          e instanceof Error
            ? `Targets integrity check failed: ${e.message}`
            : "Targets integrity check failed",
      })
    }
  }

  const hash = await createPermissionsPost(validated)
  return NextResponse.json({ hash })
})
