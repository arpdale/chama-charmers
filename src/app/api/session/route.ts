import { cookies } from "next/headers";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { FRIENDS, ApiError, failure, sameOrigin, sign } from "@/lib/server/security";

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const { key, name } = z.object({ key: z.string().max(256), name: z.string() }).parse(await request.json());
    const actual = Buffer.from(key);
    const expected = Buffer.from(process.env.UPLOAD_ACCESS_TOKEN || "");
    if (!expected.length || actual.length !== expected.length || !timingSafeEqual(actual, expected) || !FRIENDS.includes(name)) throw new ApiError(403, "Invalid upload link or name");
    (await cookies()).set("chama-session", sign({ name, exp: Date.now() + 7 * 86400000 }), { httpOnly: true, secure: new URL(request.url).protocol === "https:", sameSite: "strict", maxAge: 7 * 86400, path: "/" });
    return Response.json({ name });
  } catch (error) { return failure(error); }
}
