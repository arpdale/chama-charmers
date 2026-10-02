import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const FRIENDS = ["David", "Jeff", "Ernesto", "Nirav"];
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET must have at least 32 characters");
  return value;
}
export function sign(payload: Record<string, unknown>) {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${data}.${createHmac("sha256", secret()).update(data).digest("base64url")}`;
}
export function verify(token: string): Record<string, unknown> {
  const [data, signature] = token.split(".");
  if (!data || !signature) throw new ApiError(401, "Invalid session");
  const actual = Buffer.from(signature, "base64url");
  const expected = createHmac("sha256", secret()).update(data).digest();
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new ApiError(401, "Invalid session");
  const payload = JSON.parse(Buffer.from(data, "base64url").toString());
  if (typeof payload.exp !== "number" || payload.exp < Date.now()) throw new ApiError(401, "Session expired");
  return payload;
}
export function sameOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) throw new ApiError(403, "Cross-origin writes denied");
}
export async function uploader(request: Request) {
  sameOrigin(request);
  if (process.env.MIGRATION_READ_ONLY !== "false") throw new ApiError(503, "Uploads are temporarily paused for migration");
  const token = (await cookies()).get("chama-session")?.value;
  if (!token) throw new ApiError(401, "Upload link and name selection required");
  const session = verify(token);
  if (typeof session.name !== "string" || !FRIENDS.includes(session.name)) throw new ApiError(401, "Invalid uploader");
  return session.name;
}
export function failure(error: unknown) {
  if (error instanceof ApiError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof Error && error.name === "ZodError") return Response.json({ error: "Invalid request" }, { status: 400 });
  console.error("[api]", error instanceof Error ? error.message : "Unexpected error");
  return Response.json({ error: "Request failed" }, { status: 500 });
}
